import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { SessionStore } from "../src/store.js";
import { buildServer } from "../src/server.js";
import { BridgeHub } from "../src/bridge/hub.js";
import { ReminderHub } from "../src/reminders/hub.js";
import { LibraryHub } from "../src/library/hub.js";
import { upsertPendingReminder } from "../src/reminders/store.js";
import { saveWatchPrefs, loadWatchPrefs } from "../src/prefs.js";
import { installHooks } from "../src/hooks-install.js";
import type { SessionState } from "../src/types.js";

const homes: string[] = [];

afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

function tempHome(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "cw-server-"));
  homes.push(h);
  fs.mkdirSync(path.join(h, ".cursor"), { recursive: true });
  return h;
}

function listenPort(app: { server: { address(): string | { port: number } | null } }): number {
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("no listen port");
  return addr.port;
}

type WsMsg = { type: string; payload: unknown };

function collectWs(ws: WebSocket): {
  messages: WsMsg[];
  waitFor: (predicate: (msg: WsMsg) => boolean, timeoutMs?: number) => Promise<WsMsg>;
} {
  const messages: WsMsg[] = [];
  const waiters: Array<{
    predicate: (msg: WsMsg) => boolean;
    resolve: (msg: WsMsg) => void;
  }> = [];

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data)) as WsMsg;
    messages.push(msg);
    const idx = waiters.findIndex((w) => w.predicate(msg));
    if (idx >= 0) {
      const [w] = waiters.splice(idx, 1);
      w!.resolve(msg);
    }
  });

  return {
    messages,
    waitFor(predicate, timeoutMs = 3000) {
      const already = messages.find(predicate);
      if (already) return Promise.resolve(already);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("ws message timeout")), timeoutMs);
        waiters.push({
          predicate,
          resolve: (msg) => {
            clearTimeout(timer);
            resolve(msg);
          },
        });
      });
    },
  };
}

describe("buildServer", () => {
  const store = new SessionStore();
  let app: Awaited<ReturnType<typeof buildServer>>;
  let home: string;
  let hub: ReminderHub;
  let libraryHub: LibraryHub;

  beforeAll(async () => {
    home = tempHome();
    hub = new ReminderHub(home);
    libraryHub = new LibraryHub(home);
    store.replaceAll([
      {
        id: "x",
        projectKey: "p",
        workspacePath: "",
        workspaceLabel: "idea/Demo",
        status: "waiting",
        summary: "hi",
        currentAction: "等待你回复",
        lastActivityAt: Date.now(),
        subagentCount: 0,
        subagentRunning: 0,
        transcriptPath: "/t",
        recentMessages: [],
      } satisfies SessionState,
    ]);
    app = await buildServer(store, { homeDir: home, reminderHub: hub, libraryHub });
    await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/health", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("GET /api/sessions", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].id).toBe("x");
  });

  it("GET / serves index", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/Cursors Watch/);
  });

  it("POST /api/open-workspace rejects unknown path", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/open-workspace",
      payload: { path: "/not/in/list" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().ok).toBe(false);
  });

  it("GET /api/reminders returns pending list", async () => {
    upsertPendingReminder(home, {
      conversationId: "conv-a",
      turnedEndedAt: 1000,
      summary: "done",
      chatName: "Chat A",
    });
    hub.notifyChanged();

    const res = await app.inject({ method: "GET", url: "/api/reminders" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ conversationId: string; status: string }>;
    expect(body.some((r) => r.conversationId === "conv-a" && r.status === "pending")).toBe(true);
  });

  it("POST /api/reminders/:conversationId/ack acks and returns ok", async () => {
    upsertPendingReminder(home, {
      conversationId: "conv-ack",
      turnedEndedAt: 2000,
      summary: "ack me",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/reminders/conv-ack/ack",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const list = await app.inject({ method: "GET", url: "/api/reminders" });
    const pending = list.json() as Array<{ conversationId: string }>;
    expect(pending.find((r) => r.conversationId === "conv-ack")).toBeUndefined();
  });

  it("POST /api/reminders/:conversationId/ack returns 404 when missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/reminders/no-such/ack",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false });
  });

  it("GET /api/prefs returns notificationSound", async () => {
    saveWatchPrefs(home, { notificationSound: true });
    const res = await app.inject({ method: "GET", url: "/api/prefs" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ notificationSound: true });
  });

  it("PUT /api/prefs updates notificationSound", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/prefs",
      payload: { notificationSound: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ notificationSound: true });
    expect(loadWatchPrefs(home).notificationSound).toBe(true);

    const res2 = await app.inject({
      method: "PUT",
      url: "/api/prefs",
      payload: { notificationSound: false },
    });
    expect(res2.json()).toEqual({ notificationSound: false });
  });

  it("PUT /api/prefs rejects non-boolean notificationSound", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/prefs",
      payload: { notificationSound: "loud" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
  });

  it("GET /api/hooks-status wraps hooksStatus", async () => {
    const before = await app.inject({ method: "GET", url: "/api/hooks-status" });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({ installed: false });

    installHooks(home);
    const after = await app.inject({ method: "GET", url: "/api/hooks-status" });
    expect(after.json()).toMatchObject({ installed: true });
    expect(typeof after.json().hooksJson).toBe("string");
    expect(typeof after.json().scriptPath).toBe("string");
    expect(typeof after.json().liveDirWritable).toBe("boolean");
  });

  it("WS sends sessions and reminders on connect; broadcasts on ack", async () => {
    upsertPendingReminder(home, {
      conversationId: "conv-ws",
      turnedEndedAt: 3000,
      summary: "ws pending",
    });
    hub.notifyChanged();

    const port = listenPort(app);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const inbox = collectWs(ws);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", (e) => reject(e));
    });

    const sessionsMsg = await inbox.waitFor((m) => m.type === "sessions");
    expect(Array.isArray(sessionsMsg.payload)).toBe(true);
    expect((sessionsMsg.payload as SessionState[])[0]?.id).toBe("x");

    const remindersMsg = await inbox.waitFor((m) => m.type === "reminders");
    const pending = remindersMsg.payload as Array<{ conversationId: string }>;
    expect(pending.some((r) => r.conversationId === "conv-ws")).toBe(true);

    const afterAck = inbox.waitFor(
      (m) =>
        m.type === "reminders" &&
        !(m.payload as Array<{ conversationId: string }>).some(
          (r) => r.conversationId === "conv-ws",
        ),
    );
    const ackRes = await app.inject({
      method: "POST",
      url: "/api/reminders/conv-ws/ack",
    });
    expect(ackRes.statusCode).toBe(200);
    await afterAck;

    ws.close();
  });

  it("WS receives reminders after pipeline upsert via hub.notifyChanged", async () => {
    const port = listenPort(app);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const inbox = collectWs(ws);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", (e) => reject(e));
    });

    await inbox.waitFor((m) => m.type === "reminders");

    const nextReminders = inbox.waitFor(
      (m) =>
        m.type === "reminders" &&
        (m.payload as Array<{ conversationId: string }>).some(
          (r) => r.conversationId === "conv-pipe",
        ),
    );

    // Simulate production path: pipeline file upsert + shared hub notifyChanged.
    upsertPendingReminder(home, {
      conversationId: "conv-pipe",
      turnedEndedAt: 4000,
      summary: "from pipeline",
    });
    hub.notifyChanged();

    const msg = await nextReminders;
    const pending = msg.payload as Array<{ conversationId: string; summary: string }>;
    expect(pending.some((r) => r.conversationId === "conv-pipe" && r.summary === "from pipeline")).toBe(
      true,
    );

    ws.close();
  });

  it("GET /api/library returns empty snapshot", async () => {
    const res = await app.inject({ method: "GET", url: "/api/library" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ folders: [], entries: [] });
  });

  it("POST/PATCH/DELETE library entries and folders", async () => {
    const createFolder = await app.inject({
      method: "POST",
      url: "/api/library/folders",
      payload: { mark: "todo", name: "Ideas" },
    });
    expect(createFolder.statusCode).toBe(200);
    const folderId = (createFolder.json() as { folder: { id: string } }).folder.id;

    const post = await app.inject({
      method: "POST",
      url: "/api/library/entries",
      payload: {
        conversationId: "lib-1",
        mark: "todo",
        folderId,
        title: "T1",
        workspacePath: "/Users/u/A",
        transcriptPath: "/t",
      },
    });
    expect(post.statusCode).toBe(200);

    const listed = await app.inject({ method: "GET", url: "/api/library" });
    const body = listed.json() as {
      entries: Array<{ conversationId: string; mark: string; folderId: string | null; stale: boolean }>;
    };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      conversationId: "lib-1",
      mark: "todo",
      folderId,
    });
    expect(typeof body.entries[0]!.stale).toBe("boolean");

    const moved = await app.inject({
      method: "POST",
      url: "/api/library/entries",
      payload: { conversationId: "lib-1", mark: "archive", title: "T1" },
    });
    expect(moved.statusCode).toBe(200);
    expect((moved.json() as { entry: { folderId: null; mark: string } }).entry).toMatchObject({
      mark: "archive",
      folderId: null,
    });

    const delFolder = await app.inject({
      method: "DELETE",
      url: `/api/library/folders/${folderId}`,
    });
    expect(delFolder.statusCode).toBe(200);

    const del = await app.inject({
      method: "DELETE",
      url: "/api/library/entries/lib-1",
    });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/api/library" });
    expect((after.json() as { entries: unknown[] }).entries).toEqual([]);
  });

  it("WS sends library on connect and after entry upsert", async () => {
    const port = listenPort(app);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const inbox = collectWs(ws);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", (e) => reject(e));
    });

    await inbox.waitFor((m) => m.type === "library");

    const nextLib = inbox.waitFor(
      (m) =>
        m.type === "library" &&
        (m.payload as { entries: Array<{ conversationId: string }> }).entries.some(
          (e) => e.conversationId === "lib-ws",
        ),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/library/entries",
      payload: { conversationId: "lib-ws", mark: "todo", title: "ws" },
    });
    expect(res.statusCode).toBe(200);
    await nextLib;

    await app.inject({ method: "DELETE", url: "/api/library/entries/lib-ws" });
    ws.close();
  });
});

describe("POST /api/open-chat", () => {
  it("rejects missing body fields", async () => {
    const store = new SessionStore();
    const home = tempHome();
    const bridgeHub = new BridgeHub();
    const app = await buildServer(store, { homeDir: home, bridgeHub });
    await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/open-chat",
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().ok).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("404 when session id unknown", async () => {
    const store = new SessionStore();
    store.replaceAll([
      {
        id: "real",
        projectKey: "p",
        workspacePath: "/Users/u/A",
        workspaceLabel: "A",
        status: "idle",
        summary: "s",
        currentAction: "a",
        lastActivityAt: 1,
        subagentCount: 0,
        subagentRunning: 0,
        transcriptPath: "/t",
        recentMessages: [],
      },
    ]);
    const home = tempHome();
    const bridgeHub = new BridgeHub();
    bridgeHub.register(
      "ext",
      { extensionVersion: "0.1.0", capabilities: ["canvas.openAgentByConversationId"] },
      () => {},
    );
    bridgeHub.heartbeat("ext");
    const app = await buildServer(store, { homeDir: home, bridgeHub });
    await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/open-chat",
        payload: { conversationId: "missing", workspacePath: "/Users/u/A" },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().stage).toBe("focus");
    } finally {
      await app.close();
    }
  });

  it("allows reminder workspacePath not in live sessions (still validates id)", async () => {
    const store = new SessionStore();
    const home = tempHome();
    upsertPendingReminder(home, {
      conversationId: "rem-1",
      workspacePath: "/Users/u/old",
      turnedEndedAt: Date.now(),
      summary: "done",
    });
    const reminderHub = new ReminderHub(home);
    const bridgeHub = new BridgeHub();
    const app = await buildServer(store, { homeDir: home, bridgeHub, reminderHub });
    await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const missing = await app.inject({
        method: "POST",
        url: "/api/open-chat",
        payload: { conversationId: "nope", workspacePath: "/Users/u/old" },
      });
      expect(missing.statusCode).toBe(404);
      const forbidden = await app.inject({
        method: "POST",
        url: "/api/open-chat",
        payload: { conversationId: "rem-1", workspacePath: "/evil" },
      });
      expect(forbidden.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("GET /api/bridge-status reflects hub", async () => {
    const store = new SessionStore();
    const home = tempHome();
    const bridgeHub = new BridgeHub();
    const app = await buildServer(store, { homeDir: home, bridgeHub });
    await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const offline = await app.inject({ method: "GET", url: "/api/bridge-status" });
      expect(offline.json()).toEqual({ online: false });
      bridgeHub.register(
        "ext",
        { extensionVersion: "0.1.0", capabilities: ["canvas.openAgentByConversationId"] },
        () => {},
      );
      bridgeHub.heartbeat("ext");
      const online = await app.inject({ method: "GET", url: "/api/bridge-status" });
      expect(online.json()).toEqual({
        online: true,
        extensionVersion: "0.1.0",
        workspaces: [],
      });
    } finally {
      await app.close();
    }
  });
});

describe("ReminderHub", () => {
  it("subscribe fires after ack and notifyChanged", () => {
    const home = tempHome();
    const hub = new ReminderHub(home);
    const seen: number[] = [];
    const unsub = hub.subscribe((list) => seen.push(list.length));

    upsertPendingReminder(home, {
      conversationId: "c1",
      turnedEndedAt: 1,
      summary: "s",
    });
    hub.notifyChanged();
    expect(seen.at(-1)).toBe(1);

    expect(hub.ack("c1")).toBe(true);
    expect(seen.at(-1)).toBe(0);
    expect(hub.ack("missing")).toBe(false);

    unsub();
  });
});
