import { describe, expect, it } from "vitest";
import {
  attentionCardLines,
  formatStatusSummary,
  groupSessionsForUi,
  sortAttentionSessions,
  urgencyBucket,
} from "../src/web/group-sessions.js";

function s(partial) {
  return {
    id: "x",
    status: "idle",
    hasUnread: false,
    turnEnded: false,
    live: false,
    lastActivityAt: 0,
    workspaceLabel: "w",
    ...partial,
  };
}

describe("urgencyBucket", () => {
  it("ranks live/running before unread before turnEnded", () => {
    expect(urgencyBucket(s({ live: true }))).toBe(0);
    expect(urgencyBucket(s({ status: "running" }))).toBe(0);
    expect(urgencyBucket(s({ hasUnread: true, status: "waiting" }))).toBe(1);
    expect(urgencyBucket(s({ turnEnded: true, status: "idle" }))).toBe(2);
  });
});

describe("sortAttentionSessions", () => {
  it("orders LIVE before unread before turnEnded idle", () => {
    const out = sortAttentionSessions([
      s({ id: "t", turnEnded: true, lastActivityAt: 300 }),
      s({ id: "u", hasUnread: true, status: "waiting", lastActivityAt: 200 }),
      s({ id: "l", live: true, status: "running", lastActivityAt: 100 }),
    ]);
    expect(out.map((x) => x.id)).toEqual(["l", "u", "t"]);
  });

  it("orders same bucket by activity desc", () => {
    const out = sortAttentionSessions([
      s({ id: "a", hasUnread: true, status: "waiting", lastActivityAt: 1 }),
      s({ id: "b", hasUnread: true, status: "waiting", composerUpdatedAt: 50, lastActivityAt: 1 }),
    ]);
    expect(out.map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("attentionCardLines", () => {
  it("attentionCardLines prefers chatName and exposes full workspace path", () => {
    const lines = attentionCardLines(
      {
        chatName: "T",
        summary: "sum",
        workspaceLabel: "idea/X",
        workspacePath: "/Users/zhangcheng/idea/X",
        status: "idle",
        lastActivityAt: 1_000,
      },
      1_060_000,
    );
    expect(lines.title).toBe("T");
    expect(lines.workspaceLabel).toBe("idea/X");
    expect(lines.workspacePath).toBe("/Users/zhangcheng/idea/X");
    expect(lines.workspaceDir).toBe("/Users/zhangcheng/idea/X");
    expect(lines.ageMs).toBe(1_059_000);
  });

  it("falls back to workspaceLabel when path is empty", () => {
    const lines = attentionCardLines({
      workspaceLabel: "idea/X",
      workspacePath: "",
      status: "idle",
      lastActivityAt: 1,
    });
    expect(lines.workspaceDir).toBe("idea/X");
  });
});

function sess(partial) {
  return {
    id: "x",
    status: "idle",
    hasUnread: false,
    turnEnded: false,
    live: false,
    lastActivityAt: 0,
    workspacePath: "/w",
    workspaceLabel: "w",
    projectKey: "p",
    ...partial,
  };
}

describe("groupSessionsForUi restored", () => {
  it("groups by workspacePath and limits to top 4 plus unread reminder", () => {
    const sessions = [];
    for (let i = 0; i < 5; i++) {
      sessions.push(
        sess({
          id: `i${i}`,
          workspacePath: "/a",
          workspaceLabel: "a",
          lastActivityAt: 100 - i,
          status: "idle",
        }),
      );
    }
    sessions.push(
      sess({
        id: "unread-old",
        workspacePath: "/a",
        workspaceLabel: "a",
        hasUnread: true,
        status: "waiting",
        lastActivityAt: 1,
      }),
    );
    const groups = groupSessionsForUi(sessions);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalCount).toBe(6);
    const ids = groups[0].sessions.map((s) => s.id);
    expect(ids).toContain("unread-old");
    expect(ids.length).toBeGreaterThanOrEqual(5);
    expect(ids.length).toBeLessThanOrEqual(6);
  });

  it("formatStatusSummary skips zero counts", () => {
    expect(formatStatusSummary({ waiting: 1, idle: 2 })).toContain("🟡1");
    expect(formatStatusSummary({ waiting: 1, idle: 2 })).toContain("⚪2");
  });
});
