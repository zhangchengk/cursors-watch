import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { liveDir } from "../src/constants.js";
import {
  applyLivePatch,
  rescanParentSession,
  rescanProjectShells,
} from "../src/incremental-scan.js";
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
      now: fx.now,
    });
    expect(result).toBe("removed");
    expect(store.getSessions().find((x) => x.id === fx.parentId)).toBeUndefined();
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
