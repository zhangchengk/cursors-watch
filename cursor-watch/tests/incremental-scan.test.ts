import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { liveDir } from "../src/constants.js";
import {
  applyLivePatch,
  rescanParentSession,
  rescanProjectShells,
  syncComposerHeaders,
} from "../src/incremental-scan.js";
import { listPendingReminders } from "../src/reminders/store.js";
import { ScanCaches } from "../src/scan-caches.js";
import { SessionStore } from "../src/store.js";
import type { SessionState } from "../src/types.js";
import { encodeWorkspacePath } from "../src/workspace.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function line(ts: number, text: string): string {
  return `${JSON.stringify({
    role: "assistant",
    timestamp: ts,
    message: { content: [{ type: "text", text }] },
  })}\n`;
}

/** Temp home + real workspace dir so aggregator workspace filter keeps the session. */
function makeLayout(opts?: { withChildMirror?: boolean }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-inc-home-"));
  const ws = path.join(home, "ws");
  fs.mkdirSync(ws, { recursive: true });
  const projectKey = encodeWorkspacePath(ws);
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-inc-proj-"));
  const transcripts = path.join(
    projectsDir,
    projectKey,
    "agent-transcripts",
  );

  const parentId = "parent-aa";
  const childId = "child-bb";
  const ts = 1_700_000_002_000;

  fs.mkdirSync(path.join(transcripts, parentId, "subagents"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(transcripts, parentId, `${parentId}.jsonl`),
    line(ts, "parent done"),
  );
  fs.writeFileSync(
    path.join(transcripts, parentId, "subagents", `${childId}.jsonl`),
    line(ts, "child task done"),
  );

  if (opts?.withChildMirror) {
    fs.mkdirSync(path.join(transcripts, childId), { recursive: true });
    fs.writeFileSync(
      path.join(transcripts, childId, `${childId}.jsonl`),
      line(ts, "child task done"),
    );
  }

  const caches = new ScanCaches(home, {
    buildIndex: () => new Map([[projectKey, ws]]),
    loadHeaders: () => new Map(),
    dbMtimeMs: () => 0,
  });

  cleanups.push(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(projectsDir, { recursive: true, force: true });
  });

  return {
    home,
    ws,
    projectsDir,
    projectKey,
    caches,
    parentId,
    childId,
    ts,
    now: ts + 60_000,
  };
}

function baseSession(
  fx: ReturnType<typeof makeLayout>,
  over: Partial<SessionState> = {},
): SessionState {
  return {
    id: fx.parentId,
    projectKey: fx.projectKey,
    workspacePath: fx.ws,
    workspaceLabel: "ws",
    status: "idle",
    summary: "parent done",
    currentAction: "idle",
    lastActivityAt: fx.ts,
    subagentCount: 1,
    subagentRunning: 0,
    transcriptPath: path.join(
      fx.projectsDir,
      fx.projectKey,
      "agent-transcripts",
      fx.parentId,
      `${fx.parentId}.jsonl`,
    ),
    recentMessages: [],
    hasUnread: false,
    live: false,
    turnEnded: false,
    ...over,
  };
}

describe("rescanParentSession", () => {
  it("returns the parent session with recent messages", () => {
    const fx = makeLayout();
    const session = rescanParentSession({
      projectsDir: fx.projectsDir,
      homeDir: fx.home,
      projectKey: fx.projectKey,
      sessionId: fx.parentId,
      caches: fx.caches,
      now: fx.now,
    });
    expect(session).not.toBeNull();
    expect(session!.id).toBe("parent-aa");
    expect(session!.recentMessages.length).toBeGreaterThanOrEqual(1);
    expect(session!.subagentCount).toBe(1);
  });

  it("returns null for a mirrored subagent id (top-level + under parent/subagents)", () => {
    const fx = makeLayout({ withChildMirror: true });
    const session = rescanParentSession({
      projectsDir: fx.projectsDir,
      homeDir: fx.home,
      projectKey: fx.projectKey,
      sessionId: fx.childId,
      caches: fx.caches,
      now: fx.now,
    });
    expect(session).toBeNull();
  });
});

describe("applyLivePatch", () => {
  it("returns missing when conversation is not in the store", () => {
    const fx = makeLayout();
    const store = new SessionStore();
    const result = applyLivePatch({
      conversationId: fx.parentId,
      store,
      caches: fx.caches,
      homeDir: fx.home,
      projectsDir: fx.projectsDir,
      now: fx.now,
    });
    expect(result).toBe("missing");
  });

  it("upserts live=true and running when live json has recent lastLiveAt", () => {
    const fx = makeLayout();
    const store = new SessionStore();
    store.upsert(baseSession(fx, { status: "idle", live: false }));

    const livePath = path.join(liveDir(fx.home), `${fx.parentId}.json`);
    fs.mkdirSync(path.dirname(livePath), { recursive: true });
    fs.writeFileSync(
      livePath,
      JSON.stringify({
        conversationId: fx.parentId,
        lastEvent: "preToolUse",
        lastLiveAt: fx.now - 5_000,
        stoppedAt: null,
        liveHint: "Shell",
        updatedAt: fx.now - 5_000,
      }),
    );

    const result = applyLivePatch({
      conversationId: fx.parentId,
      store,
      caches: fx.caches,
      homeDir: fx.home,
      projectsDir: fx.projectsDir,
      now: fx.now,
    });
    expect(result).toBe("upserted");
    const s = store.getSessions().find((x) => x.id === fx.parentId);
    expect(s).toBeTruthy();
    expect(s!.live).toBe(true);
    expect(s!.status).toBe("running");
    expect(s!.liveHint).toBe("Shell");
  });

  it("removes the session when merge leaves it outside display filters", () => {
    const fx = makeLayout();
    const store = new SessionStore();
    // Stale activity + no unread → invisible after merge
    store.upsert(
      baseSession(fx, {
        lastActivityAt: fx.now - 3 * 60 * 60 * 1000,
        hasUnread: false,
        status: "idle",
      }),
    );

    const result = applyLivePatch({
      conversationId: fx.parentId,
      store,
      caches: fx.caches,
      homeDir: fx.home,
      projectsDir: fx.projectsDir,
      now: fx.now,
    });
    expect(result).toBe("removed");
    expect(store.getSessions().find((x) => x.id === fx.parentId)).toBeUndefined();
  });

  it("clears live-forced running when live file is gone (re-infers from transcript)", () => {
    const fx = makeLayout();
    const store = new SessionStore();
    // Previously elevated by live; no live json on disk now
    store.upsert(
      baseSession(fx, {
        status: "running",
        live: true,
        liveHint: "Shell",
        hasUnread: false,
      }),
    );

    const result = applyLivePatch({
      conversationId: fx.parentId,
      store,
      caches: fx.caches,
      homeDir: fx.home,
      projectsDir: fx.projectsDir,
      now: fx.now,
    });
    expect(result).toBe("upserted");
    const s = store.getSessions().find((x) => x.id === fx.parentId);
    expect(s).toBeTruthy();
    expect(s!.live).toBe(false);
    expect(s!.status).not.toBe("running");
    expect(["idle", "waiting"]).toContain(s!.status);
  });

  it("clears live-forced running when lastLiveAt is past LIVE_TTL", () => {
    const fx = makeLayout();
    const store = new SessionStore();
    store.upsert(
      baseSession(fx, {
        status: "running",
        live: true,
        liveHint: "Shell",
        hasUnread: false,
      }),
    );

    const livePath = path.join(liveDir(fx.home), `${fx.parentId}.json`);
    fs.mkdirSync(path.dirname(livePath), { recursive: true });
    fs.writeFileSync(
      livePath,
      JSON.stringify({
        conversationId: fx.parentId,
        lastEvent: "preToolUse",
        lastLiveAt: fx.now - 120_000,
        stoppedAt: null,
        liveHint: "Shell",
        updatedAt: fx.now - 120_000,
      }),
    );

    const result = applyLivePatch({
      conversationId: fx.parentId,
      store,
      caches: fx.caches,
      homeDir: fx.home,
      projectsDir: fx.projectsDir,
      now: fx.now,
    });
    expect(result).toBe("upserted");
    const s = store.getSessions().find((x) => x.id === fx.parentId);
    expect(s).toBeTruthy();
    expect(s!.live).toBe(false);
    expect(s!.status).not.toBe("running");
    expect(["idle", "waiting"]).toContain(s!.status);
  });

  it("stop without active loop upserts pending reminder (side effect; still upserted)", () => {
    const fx = makeLayout();
    const store = new SessionStore();
    store.upsert(
      baseSession(fx, {
        status: "running",
        live: true,
        turnEnded: false,
        liveHint: "Shell: work",
        chatName: "Task chat",
        summary: "parent done",
      }),
    );

    const livePath = path.join(liveDir(fx.home), `${fx.parentId}.json`);
    fs.mkdirSync(path.dirname(livePath), { recursive: true });
    fs.writeFileSync(
      livePath,
      JSON.stringify({
        conversationId: fx.parentId,
        lastEvent: "stop",
        lastLiveAt: fx.now - 1_000,
        stoppedAt: fx.now,
        liveHint: "Shell: work",
        updatedAt: fx.now,
      }),
    );

    const notify = vi.fn();
    const result = applyLivePatch({
      conversationId: fx.parentId,
      store,
      caches: fx.caches,
      homeDir: fx.home,
      projectsDir: fx.projectsDir,
      now: fx.now,
      isActiveLoop: () => false,
      notify,
    });

    expect(result).toBe("upserted");
    const pending = listPendingReminders(fx.home);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      conversationId: fx.parentId,
      status: "pending",
      summary: "Shell: work",
      chatName: "Task chat",
      turnedEndedAt: fx.now,
    });
    expect(notify).toHaveBeenCalledTimes(1);
    const s = store.getSessions().find((x) => x.id === fx.parentId);
    expect(s!.turnEnded).toBe(true);
  });

  it("stop with fake active loop does not create reminder", () => {
    const fx = makeLayout();
    const store = new SessionStore();
    store.upsert(
      baseSession(fx, {
        status: "running",
        live: true,
        turnEnded: false,
        liveHint: "Shell: loop",
      }),
    );

    const livePath = path.join(liveDir(fx.home), `${fx.parentId}.json`);
    fs.mkdirSync(path.dirname(livePath), { recursive: true });
    fs.writeFileSync(
      livePath,
      JSON.stringify({
        conversationId: fx.parentId,
        lastEvent: "stop",
        lastLiveAt: fx.now - 1_000,
        stoppedAt: fx.now,
        liveHint: "Shell: loop",
        updatedAt: fx.now,
      }),
    );

    const notify = vi.fn();
    const result = applyLivePatch({
      conversationId: fx.parentId,
      store,
      caches: fx.caches,
      homeDir: fx.home,
      projectsDir: fx.projectsDir,
      now: fx.now,
      isActiveLoop: () => true,
      notify,
    });

    expect(result).toBe("upserted");
    expect(listPendingReminders(fx.home)).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
    expect(store.getSessions().find((x) => x.id === fx.parentId)!.turnEnded).toBe(
      true,
    );
  });

  it("does not re-fire reminder when session already turnEnded", () => {
    const fx = makeLayout();
    const store = new SessionStore();
    store.upsert(
      baseSession(fx, {
        status: "idle",
        live: false,
        turnEnded: true,
        turnEndedAt: fx.now - 10_000,
        liveHint: "already ended",
      }),
    );

    const livePath = path.join(liveDir(fx.home), `${fx.parentId}.json`);
    fs.mkdirSync(path.dirname(livePath), { recursive: true });
    fs.writeFileSync(
      livePath,
      JSON.stringify({
        conversationId: fx.parentId,
        lastEvent: "stop",
        lastLiveAt: fx.now - 10_000,
        stoppedAt: fx.now - 10_000,
        liveHint: "already ended",
        updatedAt: fx.now,
      }),
    );

    const notify = vi.fn();
    applyLivePatch({
      conversationId: fx.parentId,
      store,
      caches: fx.caches,
      homeDir: fx.home,
      projectsDir: fx.projectsDir,
      now: fx.now,
      isActiveLoop: () => false,
      notify,
    });
    expect(listPendingReminders(fx.home)).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("rescanProjectShells", () => {
  it("marks parent running when project terminal has no exit_code and activity is recent", () => {
    const fx = makeLayout();
    const store = new SessionStore();
    // Seed with idle; shell refresh should flip to running via rescanParentSession
    store.upsert(baseSession(fx, { status: "idle", live: false }));

    const termDir = path.join(fx.projectsDir, fx.projectKey, "terminals");
    fs.mkdirSync(termDir, { recursive: true });
    fs.writeFileSync(
      path.join(termDir, "1.txt"),
      `---\npid: 4242\ncwd: ${fx.ws}\n---\nrunning\n`,
    );

    rescanProjectShells({
      projectsDir: fx.projectsDir,
      projectKey: fx.projectKey,
      store,
      caches: fx.caches,
      homeDir: fx.home,
      now: fx.now,
    });

    const s = store.getSessions().find((x) => x.id === fx.parentId);
    expect(s).toBeTruthy();
    expect(s!.status).toBe("running");
  });
});

describe("syncComposerHeaders", () => {
  it("promotes idle→waiting when composer header becomes unread", () => {
    const store = new SessionStore();
    const wsPath = fs.mkdtempSync(path.join(os.tmpdir(), "cw-unread-ws-"));
    store.upsert({
      id: "sess-1",
      projectKey: "P",
      workspacePath: wsPath,
      workspaceLabel: "ws",
      status: "idle",
      summary: "done",
      lastActivityAt: Date.now(),
      recentMessages: [],
      hasUnread: false,
      turnEnded: true,
    } as SessionState);

    const caches = new ScanCaches("/fake", {
      dbMtimeMs: () => 1,
      loadHeaders: () =>
        new Map([
          [
            "sess-1",
            {
              hasUnread: true,
              chatName: "Bug",
              composerUpdatedAt: Date.now(),
            },
          ],
        ]),
      buildIndex: () => new Map(),
    });

    syncComposerHeaders({
      store,
      caches,
      homeDir: "/fake",
      now: Date.now(),
    });

    const s = store.getSessions().find((x) => x.id === "sess-1");
    expect(s?.hasUnread).toBe(true);
    expect(s?.status).toBe("waiting");
    expect(s?.chatName).toBe("Bug");
  });
});
