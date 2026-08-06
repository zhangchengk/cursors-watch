import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { BridgeHub } from "./bridge/hub.js";
import { hooksStatus } from "./hooks-install.js";
import { openChatInCursor } from "./open-chat.js";
import { openWorkspaceInCursor } from "./open-workspace.js";
import { loadWatchPrefs, saveWatchPrefs } from "./prefs.js";
import { ReminderHub } from "./reminders/hub.js";
import type { SessionStore } from "./store.js";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");

export type BuildServerOptions = {
  homeDir?: string;
  reminderHub?: ReminderHub;
  bridgeHub?: BridgeHub;
};

export async function buildServer(store: SessionStore, opts?: BuildServerOptions) {
  const homeDir = opts?.homeDir ?? os.homedir();
  const reminderHub = opts?.reminderHub ?? new ReminderHub(homeDir);
  const bridgeHub = opts?.bridgeHub ?? new BridgeHub();
  const panelSockets = new Set<{ send: (data: string) => void }>();

  const broadcastPanel = (msg: unknown) => {
    const raw = JSON.stringify(msg);
    for (const socket of panelSockets) {
      try {
        socket.send(raw);
      } catch {
        /* closed */
      }
    }
  };

  const app = Fastify({ logger: false });
  await app.register(websocket);
  await app.register(fastifyStatic, {
    root: webRoot,
    prefix: "/",
  });

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/sessions", async () => store.getSessions());
  app.get("/api/reminders", async () => reminderHub.listPending());
  app.get("/api/prefs", async () => loadWatchPrefs(homeDir));
  app.get("/api/hooks-status", async () => hooksStatus(homeDir));
  app.get("/api/bridge-status", async () => bridgeHub.status());

  app.put<{ Body: { notificationSound?: unknown } }>("/api/prefs", async (req, reply) => {
    if (typeof req.body?.notificationSound !== "boolean") {
      return reply.code(400).send({ ok: false, error: "notificationSound must be boolean" });
    }
    const prefs = { notificationSound: req.body.notificationSound };
    saveWatchPrefs(homeDir, prefs);
    return prefs;
  });

  app.post<{ Params: { conversationId: string } }>(
    "/api/reminders/:conversationId/ack",
    async (req, reply) => {
      const ok = reminderHub.ack(req.params.conversationId);
      if (!ok) return reply.code(404).send({ ok: false });
      return { ok: true };
    },
  );

  app.post<{ Body: { path?: string } }>("/api/open-workspace", async (req, reply) => {
    const workspacePath = typeof req.body?.path === "string" ? req.body.path : "";
    const result = await openWorkspaceInCursor({
      workspacePath,
      sessions: store.getSessions(),
      extraAllowedPaths: reminderHub
        .listPending()
        .map((r) => r.workspacePath)
        .filter((p): p is string => typeof p === "string" && p.trim().length > 0),
    });
    if (!result.ok) {
      return reply.code(result.statusCode ?? 400).send({ ok: false, error: result.error });
    }
    return { ok: true };
  });

  app.post<{ Body: { conversationId?: string; workspacePath?: string } }>(
    "/api/open-chat",
    async (req, reply) => {
      const conversationId =
        typeof req.body?.conversationId === "string" ? req.body.conversationId : "";
      const workspacePath =
        typeof req.body?.workspacePath === "string" ? req.body.workspacePath : "";
      if (!conversationId.trim() || !workspacePath.trim()) {
        return reply.code(400).send({
          ok: false,
          stage: "focus",
          error: "conversationId and workspacePath required",
        });
      }
      const result = await openChatInCursor({
        conversationId,
        workspacePath,
        sessions: store.getSessions(),
        reminders: reminderHub.listPending(),
        bridge: bridgeHub,
        onFocusResult: (focusResult) => {
          broadcastPanel({
            type: "open-chat-result",
            payload: focusResult.ok
              ? {
                  ok: true,
                  conversationId: focusResult.conversationId,
                  workspacePath: focusResult.workspacePath,
                }
              : {
                  ok: false,
                  conversationId: focusResult.conversationId,
                  workspacePath: focusResult.workspacePath,
                  error: focusResult.error,
                },
          });
        },
      });
      if (!result.ok) {
        return reply
          .code(result.statusCode ?? 400)
          .send({ ok: false, stage: result.stage, error: result.error });
      }
      return { ok: true, stage: result.stage };
    },
  );

  app.get("/ws", { websocket: true }, (socket) => {
    panelSockets.add(socket);
    const sendSessions = () => {
      socket.send(JSON.stringify({ type: "sessions", payload: store.getSessions() }));
    };
    const sendReminders = () => {
      socket.send(JSON.stringify({ type: "reminders", payload: reminderHub.listPending() }));
    };
    sendSessions();
    sendReminders();
    const unsubSessions = store.subscribe(() => sendSessions());
    const unsubReminders = reminderHub.subscribe(() => sendReminders());
    socket.on("close", () => {
      panelSockets.delete(socket);
      unsubSessions();
      unsubReminders();
    });
  });

  app.get("/ws/bridge", { websocket: true }, (socket) => {
    const clientId = randomUUID();
    const send = (msg: unknown) => {
      try {
        socket.send(JSON.stringify(msg));
      } catch {
        /* closed */
      }
    };

    socket.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      const m = msg as Record<string, unknown>;
      if (m.type === "register") {
        const extensionVersion =
          typeof m.extensionVersion === "string" ? m.extensionVersion : "0.0.0";
        const capabilities = Array.isArray(m.capabilities)
          ? m.capabilities.filter((c): c is string => typeof c === "string")
          : [];
        const workspacePaths = Array.isArray(m.workspacePaths)
          ? m.workspacePaths.filter((p): p is string => typeof p === "string")
          : [];
        const id =
          typeof m.clientId === "string" && m.clientId.trim()
            ? m.clientId.trim()
            : clientId;
        bridgeHub.register(
          id,
          { extensionVersion, capabilities, workspacePaths },
          send,
        );
        bridgeHub.heartbeat(id, workspacePaths);
        (socket as { __bridgeClientId?: string }).__bridgeClientId = id;
        return;
      }
      const id =
        (socket as { __bridgeClientId?: string }).__bridgeClientId ?? clientId;
      if (m.type === "heartbeat") {
        const workspacePaths = Array.isArray(m.workspacePaths)
          ? m.workspacePaths.filter((p): p is string => typeof p === "string")
          : undefined;
        bridgeHub.heartbeat(id, workspacePaths);
        return;
      }
      bridgeHub.onClientMessage(id, msg);
    });

    socket.on("close", () => {
      const id =
        (socket as { __bridgeClientId?: string }).__bridgeClientId ?? clientId;
      bridgeHub.unregister(id);
    });
  });

  return app;
}
