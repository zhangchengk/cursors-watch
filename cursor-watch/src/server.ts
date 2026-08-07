import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { BridgeHub } from "./bridge/hub.js";
import { hooksStatus } from "./hooks-install.js";
import { LibraryHub } from "./library/hub.js";
import { isPathAttached, readAttachedMarkdown } from "./library/preview.js";
import type { LibraryMark } from "./library/types.js";
import { openChatInCursor } from "./open-chat.js";
import { openWorkspaceInCursor } from "./open-workspace.js";
import { loadWatchPrefs, saveWatchPrefs, applyWatchPrefsPatch } from "./prefs.js";
import { ReminderHub } from "./reminders/hub.js";
import type { SessionStore } from "./store.js";

function revealInFinder(filePath: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const child = spawn("open", ["-R", filePath], {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", (err) => {
      resolve({ ok: false, error: err.message });
    });
    child.unref();
    resolve({ ok: true });
  });
}

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");

export type BuildServerOptions = {
  homeDir?: string;
  reminderHub?: ReminderHub;
  libraryHub?: LibraryHub;
  bridgeHub?: BridgeHub;
};

function isLibraryMark(v: unknown): v is LibraryMark {
  return v === "todo" || v === "archive";
}

export async function buildServer(store: SessionStore, opts?: BuildServerOptions) {
  const homeDir = opts?.homeDir ?? os.homedir();
  const reminderHub = opts?.reminderHub ?? new ReminderHub(homeDir);
  const libraryHub = opts?.libraryHub ?? new LibraryHub(homeDir);
  libraryHub.setSessionProvider(() => store.getSessions());
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
  app.get("/api/library", async () => libraryHub.getSnapshot(store.getSessions()));
  app.get("/api/prefs", async () => loadWatchPrefs(homeDir));
  app.get("/api/hooks-status", async () => hooksStatus(homeDir));
  app.get("/api/bridge-status", async () => bridgeHub.status());

  app.put<{ Body: Record<string, unknown> }>("/api/prefs", async (req, reply) => {
    const current = loadWatchPrefs(homeDir);
    const patched = applyWatchPrefsPatch(current, req.body ?? {});
    if (!patched.ok) {
      return reply.code(400).send({ ok: false, error: patched.error });
    }
    saveWatchPrefs(homeDir, patched.prefs);
    return patched.prefs;
  });

  app.post<{ Params: { conversationId: string } }>(
    "/api/reminders/:conversationId/ack",
    async (req, reply) => {
      const ok = reminderHub.ack(req.params.conversationId);
      if (!ok) return reply.code(404).send({ ok: false });
      return { ok: true };
    },
  );

  app.post<{
    Body: {
      conversationId?: unknown;
      mark?: unknown;
      folderId?: unknown;
      title?: unknown;
      note?: unknown;
      projectKey?: unknown;
      workspacePath?: unknown;
      workspaceLabel?: unknown;
      chatName?: unknown;
      transcriptPath?: unknown;
    };
  }>("/api/library/entries", async (req, reply) => {
    const conversationId =
      typeof req.body?.conversationId === "string" ? req.body.conversationId : "";
    const mark = req.body?.mark;
    if (!conversationId.trim() || !isLibraryMark(mark)) {
      return reply.code(400).send({ ok: false, error: "conversationId and mark required" });
    }
    try {
      const entry = libraryHub.upsertEntry({
        conversationId,
        mark,
        folderId:
          req.body?.folderId === null
            ? null
            : typeof req.body?.folderId === "string"
              ? req.body.folderId
              : undefined,
        title: typeof req.body?.title === "string" ? req.body.title : undefined,
        note: typeof req.body?.note === "string" ? req.body.note : undefined,
        projectKey: typeof req.body?.projectKey === "string" ? req.body.projectKey : undefined,
        workspacePath:
          typeof req.body?.workspacePath === "string" ? req.body.workspacePath : undefined,
        workspaceLabel:
          typeof req.body?.workspaceLabel === "string" ? req.body.workspaceLabel : undefined,
        chatName: typeof req.body?.chatName === "string" ? req.body.chatName : undefined,
        transcriptPath:
          typeof req.body?.transcriptPath === "string" ? req.body.transcriptPath : undefined,
      });
      return { ok: true, entry };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = /cycle/i.test(msg) ? 409 : 400;
      return reply.code(code).send({ ok: false, error: msg });
    }
  });

  app.patch<{
    Params: { conversationId: string };
    Body: Record<string, unknown>;
  }>("/api/library/entries/:conversationId", async (req, reply) => {
    const body = req.body ?? {};
    try {
      const entry = libraryHub.patchEntry(req.params.conversationId, {
        mark: isLibraryMark(body.mark) ? body.mark : undefined,
        folderId:
          body.folderId === null
            ? null
            : typeof body.folderId === "string"
              ? body.folderId
              : undefined,
        title:
          body.title === null
            ? null
            : typeof body.title === "string"
              ? body.title
              : undefined,
        note:
          body.note === null ? null : typeof body.note === "string" ? body.note : undefined,
        projectKey: typeof body.projectKey === "string" ? body.projectKey : undefined,
        workspacePath: typeof body.workspacePath === "string" ? body.workspacePath : undefined,
        workspaceLabel:
          typeof body.workspaceLabel === "string" ? body.workspaceLabel : undefined,
        chatName: typeof body.chatName === "string" ? body.chatName : undefined,
        transcriptPath:
          typeof body.transcriptPath === "string" ? body.transcriptPath : undefined,
      });
      if (!entry) return reply.code(404).send({ ok: false });
      return { ok: true, entry };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = /cycle/i.test(msg) ? 409 : 400;
      return reply.code(code).send({ ok: false, error: msg });
    }
  });

  app.delete<{ Params: { conversationId: string } }>(
    "/api/library/entries/:conversationId",
    async (req, reply) => {
      const ok = libraryHub.deleteEntry(req.params.conversationId);
      if (!ok) return reply.code(404).send({ ok: false });
      return { ok: true };
    },
  );

  app.post<{
    Params: { conversationId: string };
    Body: { paths?: unknown };
  }>("/api/library/entries/:conversationId/attachments", async (req, reply) => {
    const paths = Array.isArray(req.body?.paths)
      ? req.body.paths.filter((p): p is string => typeof p === "string")
      : [];
    if (!paths.length) {
      return reply.code(400).send({ ok: false, error: "paths required" });
    }
    try {
      const result = libraryHub.addAttachments(req.params.conversationId, paths);
      return {
        ok: true,
        entry: result.entry,
        added: result.added,
        rejected: result.rejected,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = /not found/i.test(msg) ? 404 : 400;
      return reply.code(code).send({ ok: false, error: msg });
    }
  });

  app.delete<{
    Params: { conversationId: string };
    Body: { path?: unknown };
  }>("/api/library/entries/:conversationId/attachments", async (req, reply) => {
    const filePath = typeof req.body?.path === "string" ? req.body.path : "";
    if (!filePath.trim()) {
      return reply.code(400).send({ ok: false, error: "path required" });
    }
    const entry = libraryHub.removeAttachment(req.params.conversationId, filePath);
    if (!entry) return reply.code(404).send({ ok: false });
    return { ok: true, entry };
  });

  app.get<{
    Params: { conversationId: string };
    Querystring: { path?: string };
  }>("/api/library/entries/:conversationId/attachments/preview", async (req, reply) => {
    const filePath = typeof req.query?.path === "string" ? req.query.path : "";
    const result = readAttachedMarkdown(homeDir, req.params.conversationId, filePath);
    if (!result.ok) {
      return reply.code(result.status).send({ ok: false, error: result.error });
    }
    return { ok: true, path: result.path, content: result.content };
  });

  app.post<{
    Params: { conversationId: string };
    Body: { path?: unknown };
  }>("/api/library/entries/:conversationId/attachments/reveal", async (req, reply) => {
    const filePath = typeof req.body?.path === "string" ? req.body.path : "";
    if (!filePath.trim()) {
      return reply.code(400).send({ ok: false, error: "path required" });
    }
    if (!isPathAttached(homeDir, req.params.conversationId, filePath)) {
      return reply.code(403).send({ ok: false, error: "path is not attached to this entry" });
    }
    const revealed = await revealInFinder(path.resolve(filePath.trim()));
    if (!revealed.ok) {
      return reply.code(500).send({ ok: false, error: revealed.error });
    }
    return { ok: true };
  });

  app.post<{
    Body: { mark?: unknown; parentId?: unknown; name?: unknown; sortKey?: unknown };
  }>("/api/library/folders", async (req, reply) => {
    const mark = req.body?.mark;
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    if (!isLibraryMark(mark) || !name.trim()) {
      return reply.code(400).send({ ok: false, error: "mark and name required" });
    }
    try {
      const folder = libraryHub.createFolder({
        mark,
        name,
        parentId:
          req.body?.parentId === null
            ? null
            : typeof req.body?.parentId === "string"
              ? req.body.parentId
              : undefined,
        sortKey: typeof req.body?.sortKey === "number" ? req.body.sortKey : undefined,
      });
      return { ok: true, folder };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ ok: false, error: msg });
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/library/folders/:id",
    async (req, reply) => {
      const body = req.body ?? {};
      try {
        const folder = libraryHub.patchFolder(req.params.id, {
          name: typeof body.name === "string" ? body.name : undefined,
          parentId:
            body.parentId === null
              ? null
              : typeof body.parentId === "string"
                ? body.parentId
                : undefined,
          sortKey: typeof body.sortKey === "number" ? body.sortKey : undefined,
        });
        if (!folder) return reply.code(404).send({ ok: false });
        return { ok: true, folder };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = /cycle/i.test(msg) ? 409 : 400;
        return reply.code(code).send({ ok: false, error: msg });
      }
    },
  );

  app.delete<{ Params: { id: string } }>("/api/library/folders/:id", async (req, reply) => {
    const ok = libraryHub.deleteFolder(req.params.id);
    if (!ok) return reply.code(404).send({ ok: false });
    return { ok: true };
  });

  app.post<{ Body: { path?: string } }>("/api/open-workspace", async (req, reply) => {
    const workspacePath = typeof req.body?.path === "string" ? req.body.path : "";
    const result = await openWorkspaceInCursor({
      workspacePath,
      sessions: store.getSessions(),
      extraAllowedPaths: [
        ...reminderHub
          .listPending()
          .map((r) => r.workspacePath)
          .filter((p): p is string => typeof p === "string" && p.trim().length > 0),
        ...libraryHub
          .rawState()
          .entries.map((e) => e.workspacePath)
          .filter((p): p is string => typeof p === "string" && p.trim().length > 0),
      ],
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
        libraryEntries: libraryHub.rawState().entries,
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
    const sendLibrary = () => {
      socket.send(
        JSON.stringify({ type: "library", payload: libraryHub.getSnapshot(store.getSessions()) }),
      );
    };
    sendSessions();
    sendReminders();
    sendLibrary();
    const unsubSessions = store.subscribe(() => sendSessions());
    const unsubReminders = reminderHub.subscribe(() => sendReminders());
    const unsubLibrary = libraryHub.subscribe(() => sendLibrary());
    socket.on("close", () => {
      panelSockets.delete(socket);
      unsubSessions();
      unsubReminders();
      unsubLibrary();
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

    socket.on("message", (raw: unknown) => {
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
