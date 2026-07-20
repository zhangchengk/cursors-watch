import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FULL_SCAN_INTERVAL_MS,
  INCREMENTAL_DEBOUNCE_MS,
  liveDir,
} from "../src/constants.js";
import { createRefreshController } from "../src/refresh-controller.js";
import { ScanCaches } from "../src/scan-caches.js";
import { SessionStore } from "../src/store.js";
import type { SessionState } from "../src/types.js";

const projectsDir = "/tmp/cw-projects";
const homeDir = "/tmp/cw-home";
const liveRoot = liveDir(homeDir);

function sessionStub(id: string): SessionState {
  return {
    id,
    projectKey: "proj",
    workspacePath: "/ws",
    workspaceLabel: "ws",
    status: "idle",
    summary: "",
    lastActivityAt: 0,
    recentMessages: [],
  } as SessionState;
}

describe("createRefreshController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const store = new SessionStore();
    const caches = new ScanCaches(homeDir, {
      loadHeaders: () => new Map(),
      dbMtimeMs: () => 0,
      buildIndex: () => new Map(),
    });
    const runFullScan = vi.fn();
    const applyLivePatch = vi.fn(() => "upserted" as const);
    const rescanParentSession = vi.fn(() => sessionStub("s1"));
    const rescanProjectShells = vi.fn();

    const controller = createRefreshController({
      projectsDir,
      homeDir,
      store,
      caches,
      runFullScan,
      now: () => 1_700_000_000_000,
      incremental: {
        applyLivePatch,
        rescanParentSession,
        rescanProjectShells,
      },
    });

    return {
      controller,
      store,
      runFullScan,
      applyLivePatch,
      rescanParentSession,
      rescanProjectShells,
    };
  }

  it("start runs full scan immediately and every FULL_SCAN_INTERVAL_MS", () => {
    const { controller, runFullScan } = setup();
    controller.start();
    expect(runFullScan).toHaveBeenCalledTimes(1);
    controller.notifyFullScanComplete();

    vi.advanceTimersByTime(FULL_SCAN_INTERVAL_MS - 1);
    expect(runFullScan).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(runFullScan).toHaveBeenCalledTimes(2);

    controller.close();
  });

  it("coalesces overlapping doFullScan via pendingFullScan without double-fork", () => {
    const { controller, runFullScan } = setup();
    controller.start();
    expect(runFullScan).toHaveBeenCalledTimes(1);

    // Still in flight: interval / schedule must set pending, not fork again
    vi.advanceTimersByTime(FULL_SCAN_INTERVAL_MS);
    expect(runFullScan).toHaveBeenCalledTimes(1);

    // Complete → drains pending with exactly one new fork
    controller.notifyFullScanComplete();
    expect(runFullScan).toHaveBeenCalledTimes(2);

    controller.notifyFullScanComplete();
    controller.close();
  });

  it("coalesces two live events for the same id within INCREMENTAL_DEBOUNCE_MS", () => {
    const { controller, applyLivePatch, runFullScan } = setup();
    controller.start();
    runFullScan.mockClear();
    // Complete initial full scan so incremental can run
    controller.notifyFullScanComplete();

    const livePath = path.join(liveRoot, "conv-1.json");
    controller.onFsEvent("change", livePath);
    controller.onFsEvent("change", livePath);

    expect(applyLivePatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(INCREMENTAL_DEBOUNCE_MS);
    expect(applyLivePatch).toHaveBeenCalledTimes(1);
    expect(applyLivePatch).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1" }),
    );
    expect(runFullScan).not.toHaveBeenCalled();

    controller.close();
  });

  it("routes transcript_main to rescanParentSession and upserts", () => {
    const { controller, rescanParentSession, store, runFullScan } = setup();
    controller.start();
    controller.notifyFullScanComplete();
    runFullScan.mockClear();

    const filePath = path.join(
      projectsDir,
      "my-proj",
      "agent-transcripts",
      "sess-aa",
      "sess-aa.jsonl",
    );
    controller.onFsEvent("change", filePath);
    vi.advanceTimersByTime(INCREMENTAL_DEBOUNCE_MS);

    expect(rescanParentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        projectKey: "my-proj",
        sessionId: "sess-aa",
      }),
    );
    expect(store.getSessions().some((s) => s.id === "s1")).toBe(true);

    controller.close();
  });

  it("routes transcript_subagent to parent session key", () => {
    const { controller, rescanParentSession, runFullScan } = setup();
    controller.start();
    controller.notifyFullScanComplete();
    runFullScan.mockClear();

    const filePath = path.join(
      projectsDir,
      "my-proj",
      "agent-transcripts",
      "parent-id",
      "subagents",
      "child-id.jsonl",
    );
    controller.onFsEvent("change", filePath);
    vi.advanceTimersByTime(INCREMENTAL_DEBOUNCE_MS);

    expect(rescanParentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        projectKey: "my-proj",
        sessionId: "parent-id",
      }),
    );

    controller.close();
  });

  it("routes terminal to rescanProjectShells", () => {
    const { controller, rescanProjectShells, runFullScan } = setup();
    controller.start();
    controller.notifyFullScanComplete();
    runFullScan.mockClear();

    const filePath = path.join(projectsDir, "my-proj", "terminals", "1.txt");
    controller.onFsEvent("change", filePath);
    vi.advanceTimersByTime(INCREMENTAL_DEBOUNCE_MS);

    expect(rescanProjectShells).toHaveBeenCalledWith(
      expect.objectContaining({ projectKey: "my-proj" }),
    );

    controller.close();
  });

  it("queues incremental keys while full scan in flight and flushes after complete", () => {
    const { controller, applyLivePatch, runFullScan } = setup();
    controller.start();
    // Still in flight — do not notify complete yet
    expect(runFullScan).toHaveBeenCalledTimes(1);
    runFullScan.mockClear();

    const livePath = path.join(liveRoot, "conv-q.json");
    controller.onFsEvent("change", livePath);
    vi.advanceTimersByTime(INCREMENTAL_DEBOUNCE_MS);
    expect(applyLivePatch).not.toHaveBeenCalled();

    controller.notifyFullScanComplete();
    // Re-scheduled with debounce
    expect(applyLivePatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(INCREMENTAL_DEBOUNCE_MS);
    expect(applyLivePatch).toHaveBeenCalledTimes(1);

    controller.close();
  });

  it("unknown path schedules a coalesced full scan after 300ms", () => {
    const { controller, runFullScan } = setup();
    controller.start();
    controller.notifyFullScanComplete();
    runFullScan.mockClear();

    controller.onFsEvent("change", "/unrelated/file.txt");
    controller.onFsEvent("change", "/another/unknown.bin");
    expect(runFullScan).not.toHaveBeenCalled();

    vi.advanceTimersByTime(299);
    expect(runFullScan).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(runFullScan).toHaveBeenCalledTimes(1);

    controller.close();
  });

  it("addDir/unlinkDir do not schedule a full scan (directory noise)", () => {
    const { controller, runFullScan } = setup();
    controller.start();
    controller.notifyFullScanComplete();
    runFullScan.mockClear();

    const sessionDir = path.join(
      projectsDir,
      "my-proj",
      "agent-transcripts",
      "sess-new",
    );
    const subagentsDir = path.join(sessionDir, "subagents");
    const terminalsDir = path.join(projectsDir, "my-proj", "terminals");

    controller.onFsEvent("addDir", sessionDir);
    controller.onFsEvent("addDir", subagentsDir);
    controller.onFsEvent("addDir", terminalsDir);
    controller.onFsEvent("unlinkDir", subagentsDir);

    vi.advanceTimersByTime(300);
    expect(runFullScan).not.toHaveBeenCalled();

    controller.close();
  });

  it("file add/change/unlink for transcripts still incremental after dir noise", () => {
    const { controller, rescanParentSession, runFullScan } = setup();
    controller.start();
    controller.notifyFullScanComplete();
    runFullScan.mockClear();

    const sessionDir = path.join(
      projectsDir,
      "my-proj",
      "agent-transcripts",
      "sess-aa",
    );
    const filePath = path.join(sessionDir, "sess-aa.jsonl");

    controller.onFsEvent("addDir", sessionDir);
    controller.onFsEvent("add", filePath);
    vi.advanceTimersByTime(INCREMENTAL_DEBOUNCE_MS);

    expect(rescanParentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        projectKey: "my-proj",
        sessionId: "sess-aa",
      }),
    );
    // Also past full-scan debounce — dir noise must not have queued one
    vi.advanceTimersByTime(300);
    expect(runFullScan).not.toHaveBeenCalled();

    controller.close();
  });

  it("incremental errors schedule a full scan", () => {
    const { controller, applyLivePatch, runFullScan } = setup();
    applyLivePatch.mockImplementation(() => {
      throw new Error("boom");
    });
    controller.start();
    controller.notifyFullScanComplete();
    runFullScan.mockClear();

    controller.onFsEvent("change", path.join(liveRoot, "err.json"));
    vi.advanceTimersByTime(INCREMENTAL_DEBOUNCE_MS);
    expect(runFullScan).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(runFullScan).toHaveBeenCalledTimes(1);

    controller.close();
  });

  it("removes session when rescanParentSession returns null", () => {
    const { controller, rescanParentSession, store, runFullScan } = setup();
    store.upsert(sessionStub("gone-id"));
    rescanParentSession.mockReturnValue(null);

    controller.start();
    controller.notifyFullScanComplete();
    runFullScan.mockClear();

    const filePath = path.join(
      projectsDir,
      "my-proj",
      "agent-transcripts",
      "gone-id",
      "gone-id.jsonl",
    );
    controller.onFsEvent("change", filePath);
    vi.advanceTimersByTime(INCREMENTAL_DEBOUNCE_MS);

    expect(store.getSessions().some((s) => s.id === "gone-id")).toBe(false);

    controller.close();
  });

  it("aborts upsert when generation changes mid-flight", () => {
    const { controller, rescanParentSession, store, runFullScan } = setup();
    rescanParentSession.mockImplementation(() => {
      // Full scan completes during incremental work → generation bumps
      controller.notifyFullScanComplete();
      return sessionStub("stale");
    });

    controller.start();
    controller.notifyFullScanComplete();
    runFullScan.mockClear();

    const filePath = path.join(
      projectsDir,
      "my-proj",
      "agent-transcripts",
      "stale",
      "stale.jsonl",
    );
    controller.onFsEvent("change", filePath);
    vi.advanceTimersByTime(INCREMENTAL_DEBOUNCE_MS);

    expect(store.getSessions().some((s) => s.id === "stale")).toBe(false);

    controller.close();
  });
});
