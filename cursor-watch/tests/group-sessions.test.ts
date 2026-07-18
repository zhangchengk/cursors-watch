import { describe, expect, it } from "vitest";
import { groupSessionsForUi } from "../src/web/group-sessions.js";

function sess(
  over: Partial<{
    id: string;
    status: string;
    workspacePath: string;
    workspaceLabel: string;
    projectKey: string;
    lastActivityAt: number;
    waitingSince?: number;
    composerUpdatedAt?: number;
    hasUnread?: boolean;
    turnEnded?: boolean;
    live?: boolean;
  }> & { id: string; status: string },
) {
  return {
    workspacePath: "",
    workspaceLabel: "",
    projectKey: "p",
    lastActivityAt: 1000,
    summary: "s",
    currentAction: "a",
    subagentCount: 0,
    subagentRunning: 0,
    transcriptPath: "/t",
    recentMessages: [],
    ...over,
  };
}

describe("groupSessionsForUi", () => {
  it("groups by workspacePath; within group: running → 待查看 → 本轮结束(近→远)", () => {
    const groups = groupSessionsForUi([
      sess({
        id: "ended",
        status: "idle",
        workspacePath: "/Users/u/idea/B",
        workspaceLabel: "idea/B",
        lastActivityAt: 4000,
        turnEnded: true,
      }),
      sess({
        id: "unread",
        status: "idle",
        workspacePath: "/Users/u/idea/B",
        workspaceLabel: "idea/B",
        lastActivityAt: 1000,
        hasUnread: true,
      }),
      sess({
        id: "run",
        status: "running",
        workspacePath: "/Users/u/idea/B",
        workspaceLabel: "idea/B",
        lastActivityAt: 2000,
        live: true,
      }),
      sess({
        id: "wait",
        status: "waiting",
        workspacePath: "/Users/u/idea/B",
        workspaceLabel: "idea/B",
        lastActivityAt: 3000,
      }),
      sess({
        id: "other-run",
        status: "running",
        workspacePath: "/Users/u/idea/A",
        workspaceLabel: "idea/A",
        lastActivityAt: 5000,
        live: true,
      }),
    ]);
    // Within B: run → wait/unread → ended；组序按各组首卡（A 的 running 更新）
    expect(groups.map((g) => g.label)).toEqual(["idea/A", "idea/B"]);
    const b = groups.find((g) => g.label === "idea/B");
    expect(b.sessions.map((s) => s.id)).toEqual([
      "run",
      "wait",
      "unread",
      "ended",
    ]);
    expect(b.totalCount).toBe(4);
  });

  it("sorts 本轮结束 by most recent activity first", () => {
    const groups = groupSessionsForUi([
      sess({
        id: "old",
        status: "idle",
        workspacePath: "/A",
        workspaceLabel: "A",
        lastActivityAt: 1000,
        turnEnded: true,
      }),
      sess({
        id: "new",
        status: "idle",
        workspacePath: "/A",
        workspaceLabel: "A",
        lastActivityAt: 9000,
        turnEnded: true,
      }),
    ]);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["new", "old"]);
  });

  it("falls back key path → label → projectKey; always emits group header data for singleton", () => {
    const groups = groupSessionsForUi([
      sess({ id: "1", status: "idle", projectKey: "OnlyKey", lastActivityAt: 1 }),
      sess({
        id: "2",
        status: "idle",
        workspaceLabel: "idea/L",
        projectKey: "x",
        lastActivityAt: 2,
      }),
    ]);
    expect(groups).toHaveLength(2);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
    expect(byKey["OnlyKey"].label).toBe("OnlyKey");
    expect(byKey["idea/L"].label).toBe("idea/L");
    expect(byKey["OnlyKey"].sessions).toHaveLength(1);
  });

  it("prefers workspacePath as key over label", () => {
    const groups = groupSessionsForUi([
      sess({
        id: "a",
        status: "running",
        workspacePath: "/abs/one",
        workspaceLabel: "same-label",
        lastActivityAt: 1,
      }),
      sess({
        id: "b",
        status: "running",
        workspacePath: "/abs/two",
        workspaceLabel: "same-label",
        lastActivityAt: 2,
      }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("keeps top 4 by composerUpdatedAt and always includes unread/turnEnded", () => {
    const sessions = [];
    for (let i = 0; i < 6; i++) {
      sessions.push(
        sess({
          id: `s${i}`,
          status: "idle",
          workspacePath: "/A",
          workspaceLabel: "A",
          lastActivityAt: i,
          composerUpdatedAt: i,
        }),
      );
    }
    sessions.push(
      sess({
        id: "old-unread",
        status: "idle",
        workspacePath: "/A",
        workspaceLabel: "A",
        lastActivityAt: 0,
        composerUpdatedAt: 0,
        hasUnread: true,
      }),
    );
    const g = groupSessionsForUi(sessions)[0];
    expect(g.totalCount).toBe(7);
    expect(g.sessions.length).toBe(5); // top4 (s5..s2) + old-unread
    // 待查看(unread) before idle 本轮结束-ish; then by activity desc
    expect(g.sessions.map((s) => s.id)).toEqual([
      "old-unread",
      "s5",
      "s4",
      "s3",
      "s2",
    ]);
    expect(g.sessions.some((s) => s.id === "old-unread")).toBe(true);
    expect(g.sessions.some((s) => s.id === "s0")).toBe(false);
    expect(g.sessions.some((s) => s.id === "s1")).toBe(false);
    expect(g.statusCounts).toEqual({ idle: 5 });
  });
});
