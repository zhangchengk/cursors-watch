import { describe, expect, it } from "vitest";
import { aggregateSessions } from "../src/aggregator.js";
import type { SessionState } from "../src/types.js";

function sess(p: Partial<SessionState> & Pick<SessionState, "id" | "status">): SessionState {
  return {
    projectKey: "p",
    workspacePath: "/Users/zhangcheng/idea/Cursors",
    workspaceLabel: "idea/Cursors",
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

describe("aggregateSessions", () => {
  const now = 1_000_000;

  it("drops cold non-waiting sessions", () => {
    const out = aggregateSessions(
      [
        sess({ id: "old", status: "idle", lastActivityAt: now - 2 * 60 * 60 * 1000 }),
        sess({
          id: "wait",
          status: "waiting",
          lastActivityAt: now - 2 * 60 * 60 * 1000,
          waitingSince: now - 2 * 60 * 60 * 1000,
        }),
      ],
      now,
    );
    expect(out.map((s) => s.id)).toEqual(["wait"]);
  });

  it("merges subagent rows into parent counts and excludes child rows", () => {
    const out = aggregateSessions(
      [
        sess({
          id: "parent",
          status: "waiting",
          lastActivityAt: now - 10_000,
        }),
        sess({
          id: "child",
          status: "running",
          parentId: "parent",
          lastActivityAt: now - 5_000,
        }),
      ],
      now,
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("parent");
    expect(out[0].subagentCount).toBe(1);
    expect(out[0].subagentRunning).toBe(1);
    expect(out[0].status).toBe("subagent");
  });

  it("sorts waiting → error → running/subagent → idle", () => {
    const out = aggregateSessions(
      [
        sess({ id: "i", status: "idle", lastActivityAt: now }),
        sess({ id: "r", status: "running", lastActivityAt: now }),
        sess({ id: "e", status: "error", lastActivityAt: now }),
        sess({
          id: "w2",
          status: "waiting",
          lastActivityAt: now - 1000,
          waitingSince: now - 1000,
        }),
        sess({
          id: "w1",
          status: "waiting",
          lastActivityAt: now - 5000,
          waitingSince: now - 5000,
        }),
      ],
      now,
    );
    expect(out.map((s) => s.id)).toEqual(["w1", "w2", "e", "r", "i"]);
  });
});
