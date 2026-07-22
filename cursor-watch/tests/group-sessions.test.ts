import { describe, expect, it } from "vitest";
import {
  attentionCardLines,
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
  it("attentionCardLines prefers chatName and exposes workspaceLabel", () => {
    const lines = attentionCardLines(
      {
        chatName: "T",
        summary: "sum",
        workspaceLabel: "idea/X",
        status: "idle",
        lastActivityAt: 1_000,
      },
      1_060_000,
    );
    expect(lines.title).toBe("T");
    expect(lines.workspaceLabel).toBe("idea/X");
    expect(lines.ageMs).toBe(1_059_000);
  });
});
