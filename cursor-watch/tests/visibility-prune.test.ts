import { describe, expect, it, vi } from "vitest";
import { IDLE_KEEP_MS } from "../src/constants.js";
import { SessionStore } from "../src/store.js";
import type { SessionState } from "../src/types.js";
import { pruneInvisibleSessions } from "../src/visibility-prune.js";

function sess(p: Partial<SessionState> & Pick<SessionState, "id">): SessionState {
  return {
    projectKey: "p",
    workspacePath: "/w",
    workspaceLabel: "w",
    status: "idle",
    summary: "s",
    currentAction: "a",
    lastActivityAt: Date.now(),
    subagentCount: 0,
    subagentRunning: 0,
    transcriptPath: "/t",
    recentMessages: [],
    ...p,
  };
}

describe("pruneInvisibleSessions", () => {
  it("removes stale idle and keeps unread", () => {
    const now = 1_000_000;
    const store = new SessionStore();
    store.replaceAll([
      sess({ id: "old", lastActivityAt: now - IDLE_KEEP_MS - 1 }),
      sess({
        id: "unread",
        status: "waiting",
        hasUnread: true,
        lastActivityAt: now - 9e9,
      }),
    ]);
    const n = pruneInvisibleSessions({
      store,
      now,
      workspaceExists: () => true,
    });
    expect(n).toBe(1);
    expect(store.getSessions().map((s) => s.id)).toEqual(["unread"]);
  });
});
