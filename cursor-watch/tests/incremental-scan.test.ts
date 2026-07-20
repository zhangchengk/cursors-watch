import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rescanParentSession } from "../src/incremental-scan.js";
import { ScanCaches } from "../src/scan-caches.js";
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
    projectsDir,
    projectKey,
    caches,
    parentId,
    childId,
    now: ts + 60_000,
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
