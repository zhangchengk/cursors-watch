import { describe, expect, it } from "vitest";
import type { ComposerHeaderMeta } from "../src/chat-names.js";
import { mergeSessionExtras, type LiveSnapshot } from "../src/live-state.js";
import type { SessionState } from "../src/types.js";

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

describe("mergeSessionExtras", () => {
  it("applies unread and live from extras", () => {
    const s = mergeSessionExtras(
      baseSession({ status: "idle" }),
      {
        chatName: "N",
        hasUnread: true,
        composerUpdatedAt: 9,
        subtitle: "sub",
      } satisfies ComposerHeaderMeta,
      {
        conversationId: "c1",
        lastEvent: "preToolUse",
        lastLiveAt: 100,
        stoppedAt: null,
        liveHint: "Shell",
        updatedAt: 100,
      } satisfies LiveSnapshot,
      150,
    );
    expect(s.chatName).toBe("N");
    expect(s.hasUnread).toBe(true);
    expect(s.live).toBe(true);
    expect(s.status).toBe("running");
    expect(s.liveHint).toBe("Shell");
  });

  it("falls back liveHint to meta.subtitle when snap has none", () => {
    const s = mergeSessionExtras(
      baseSession({ status: "idle" }),
      { hasUnread: false, subtitle: "from-meta" },
      {
        conversationId: "c1",
        lastEvent: "preToolUse",
        lastLiveAt: 100,
        stoppedAt: null,
        liveHint: "",
        updatedAt: 100,
      },
      150,
    );
    expect(s.liveHint).toBe("from-meta");
  });
});
