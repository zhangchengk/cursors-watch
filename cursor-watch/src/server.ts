import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { hooksStatus } from "./hooks-install.js";
import { openWorkspaceInCursor } from "./open-workspace.js";
import { loadWatchPrefs, saveWatchPrefs } from "./prefs.js";
import { ReminderHub } from "./reminders/hub.js";
import type { SessionStore } from "./store.js";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");

export type BuildServerOptions = {
  homeDir?: string;
  reminderHub?: ReminderHub;
};

export async function buildServer(store: SessionStore, opts?: BuildServerOptions) {
  const homeDir = opts?.homeDir ?? os.homedir();
  const reminderHub = opts?.reminderHub ?? new ReminderHub(homeDir);

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
    });
    if (!result.ok) {
      return reply.code(result.statusCode ?? 400).send({ ok: false, error: result.error });
    }
    return { ok: true };
  });

  app.get("/ws", { websocket: true }, (socket) => {
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
      unsubSessions();
      unsubReminders();
    });
  });

  return app;
}
