import { describe, expect, it } from "vitest";
import { LIVE_TTL_MS } from "../src/constants.js";
import {
  applyLiveToSession,
  deriveLiveFlags,
  formatCompletionBanner,
} from "../src/live-state.js";
import type { LiveSnapshot } from "../src/live-state.js";
import type { SessionState } from "../src/types.js";

function snap(over: Partial<LiveSnapshot> & Pick<LiveSnapshot, "conversationId">): LiveSnapshot {
  return {
    lastEvent: "preToolUse",
    lastLiveAt: 1_000_000,
    stoppedAt: null,
    liveHint: "Shell: t",
    updatedAt: 1_000_000,
    ...over,
  };
}

function baseSession(over: Partial<SessionState> = {}): SessionState {
  return {
    id: "c1",
    projectKey: "p",
    workspacePath: "/w",
    workspaceLabel: "w",
    status: "idle",
    summary: "s",
    currentAction: "a",
    lastActivityAt: 1,
    subagentCount: 0,
    subagentRunning: 0,
    transcriptPath: "/t",
    recentMessages: [],
    hasUnread: false,
    turnEnded: false,
    live: false,
    ...over,
  };
}

describe("deriveLiveFlags", () => {
  it("is live within TTL when not stopped", () => {
    const f = deriveLiveFlags(snap({ lastLiveAt: 1_000_000 }), 1_000_000 + LIVE_TTL_MS);
    expect(f.live).toBe(true);
    expect(f.turnEnded).toBe(false);
  });

  it("is not live after TTL", () => {
    const f = deriveLiveFlags(snap({ lastLiveAt: 1_000_000 }), 1_000_000 + LIVE_TTL_MS + 1);
    expect(f.live).toBe(false);
  });

  it("stop clears live immediately and sets turnEnded", () => {
    const f = deriveLiveFlags(
      snap({ lastEvent: "stop", lastLiveAt: 1_000_000, stoppedAt: 1_000_050 }),
      1_000_060,
    );
    expect(f.live).toBe(false);
    expect(f.turnEnded).toBe(true);
  });
});

describe("formatCompletionBanner", () => {
  it("prefers unread over turnEnded", () => {
    expect(formatCompletionBanner(true, true)).toBe("有未读 · 请查看");
    expect(formatCompletionBanner(true, false)).toBe("有未读 · 请查看");
    expect(formatCompletionBanner(false, true)).toBe("本轮结束");
    expect(formatCompletionBanner(false, false)).toBeNull();
  });
});

describe("applyLiveToSession", () => {
  it("forces running when live unless error", () => {
    const s = applyLiveToSession(
      baseSession({ status: "waiting" }),
      snap({ lastLiveAt: 1_000_000 }),
      1_000_100,
    );
    expect(s.live).toBe(true);
    expect(s.status).toBe("running");
  });

  it("does not override error", () => {
    const s = applyLiveToSession(
      baseSession({ status: "error" }),
      snap({ lastLiveAt: 1_000_000 }),
      1_000_100,
    );
    expect(s.live).toBe(true);
    expect(s.status).toBe("error");
  });

  it("demotes turnEnded non-live from running to idle", () => {
    const s = applyLiveToSession(
      baseSession({ status: "running", hasUnread: false }),
      snap({ lastEvent: "stop", lastLiveAt: 1_000_000, stoppedAt: 1_000_050 }),
      1_000_100,
    );
    expect(s.live).toBe(false);
    expect(s.turnEnded).toBe(true);
    expect(s.status).toBe("idle");
  });

  it("demotes turnEnded with unread to waiting", () => {
    const s = applyLiveToSession(
      baseSession({ status: "running", hasUnread: true }),
      snap({ lastEvent: "stop", lastLiveAt: 1_000_000, stoppedAt: 1_000_050 }),
      1_000_100,
    );
    expect(s.status).toBe("waiting");
    expect(s.turnEnded).toBe(true);
  });

  it("after stop: unread→yellow waiting, read→white idle (even without stop hook)", () => {
    const unread = applyLiveToSession(
      baseSession({ status: "waiting", hasUnread: true }),
      undefined,
      1_000_100,
    );
    expect(unread.status).toBe("waiting");

    const read = applyLiveToSession(
      baseSession({ status: "waiting", hasUnread: false }),
      undefined,
      1_000_100,
    );
    expect(read.status).toBe("idle");

    const unreadIdle = applyLiveToSession(
      baseSession({ status: "idle", hasUnread: true }),
      undefined,
      1_000_100,
    );
    expect(unreadIdle.status).toBe("waiting");
  });

  it("keeps running/subagent when still active (not remapped by unread)", () => {
    const s = applyLiveToSession(
      baseSession({ status: "running", hasUnread: false }),
      undefined,
      1_000_100,
    );
    expect(s.status).toBe("running");
  });

  it("sets turnEndedAt from snapshot stoppedAt", () => {
    const s = applyLiveToSession(
      baseSession({ status: "running", hasUnread: false }),
      snap({ lastEvent: "stop", stoppedAt: 1_000_050, lastLiveAt: 1_000_000 }),
      1_000_100,
    );
    expect(s.turnEnded).toBe(true);
    expect(s.turnEndedAt).toBe(1_000_050);
    expect(s.status).toBe("idle");
  });

  it("clears turnEndedAt when not turnEnded", () => {
    const s = applyLiveToSession(
      baseSession({ turnEnded: true, turnEndedAt: 99, status: "idle" }),
      snap({ lastLiveAt: 1_000_000, stoppedAt: null }),
      1_000_100,
    );
    expect(s.turnEnded).toBe(false);
    expect(s.turnEndedAt).toBeUndefined();
  });
});
