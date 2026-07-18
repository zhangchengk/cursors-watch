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
  const pathOk = (p: string) => Boolean(p?.trim());

  it("drops sessions colder than ACTIVE_WINDOW except unread", () => {
    const out = aggregateSessions(
      [
        sess({ id: "old", status: "idle", lastActivityAt: now - 3 * 60 * 60 * 1000 }),
        sess({
          id: "wait-old",
          status: "waiting",
          lastActivityAt: now - 3 * 60 * 60 * 1000,
          waitingSince: now - 3 * 60 * 60 * 1000,
        }),
        sess({
          id: "wait-fresh",
          status: "waiting",
          lastActivityAt: now - 30 * 60 * 1000,
          waitingSince: now - 30 * 60 * 1000,
        }),
        sess({
          id: "unread-old",
          status: "waiting",
          lastActivityAt: now - 5 * 60 * 60 * 1000,
          waitingSince: now - 5 * 60 * 60 * 1000,
          hasUnread: true,
        }),
      ],
      now,
      pathOk,
    );
    expect(out.map((s) => s.id).sort()).toEqual(["unread-old", "wait-fresh"]);
  });

  it("drops unresolved or missing workspaces even when unread", () => {
    const out = aggregateSessions(
      [
        sess({
          id: "ghost",
          status: "waiting",
          workspacePath: "",
          hasUnread: true,
          lastActivityAt: now,
        }),
        sess({
          id: "gone",
          status: "waiting",
          workspacePath: "/Users/zhangcheng/idea/dbUtils",
          hasUnread: true,
          lastActivityAt: now,
        }),
        sess({
          id: "alive",
          status: "waiting",
          workspacePath: "/Users/zhangcheng/idea/Cursors",
          hasUnread: true,
          lastActivityAt: now,
        }),
      ],
      now,
      (p) => p === "/Users/zhangcheng/idea/Cursors",
    );
    expect(out.map((s) => s.id)).toEqual(["alive"]);
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
      pathOk,
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
      pathOk,
    );
    expect(out.map((s) => s.id)).toEqual(["w1", "w2", "e", "r", "i"]);
  });
});
