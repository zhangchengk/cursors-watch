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
  it("groups by workspacePath then sorts groups by urgency", () => {
    const groups = groupSessionsForUi([
      sess({
        id: "r1",
        status: "running",
        workspacePath: "/Users/u/idea/A",
        workspaceLabel: "idea/A",
        lastActivityAt: 5000,
      }),
      sess({
        id: "w1",
        status: "waiting",
        workspacePath: "/Users/u/idea/B",
        workspaceLabel: "idea/B",
        lastActivityAt: 4000,
        waitingSince: 3000,
      }),
      sess({
        id: "r2",
        status: "running",
        workspacePath: "/Users/u/idea/B",
        workspaceLabel: "idea/B",
        lastActivityAt: 4500,
      }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["idea/B", "idea/A"]);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["w1", "r2"]);
    expect(groups[0].statusCounts).toEqual({ waiting: 1, running: 1 });
    expect(groups[1].sessions).toHaveLength(1);
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
});
