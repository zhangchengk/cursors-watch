import { describe, expect, it } from "vitest";
import {
  formatReminderEndedAt,
  inboxViewModel,
  parseDeepLinkConversationId,
  reminderAckPath,
  reminderDisplayMeta,
  reminderDisplayTitle,
  sortInboxReminders,
} from "../src/web/inbox.js";

describe("parseDeepLinkConversationId", () => {
  it("reads conversationId from query string with leading ?", () => {
    expect(parseDeepLinkConversationId("?conversationId=abc-123")).toBe("abc-123");
  });

  it("reads from raw query without ?", () => {
    expect(parseDeepLinkConversationId("conversationId=xyz&foo=1")).toBe("xyz");
  });

  it("reads from URLSearchParams", () => {
    expect(parseDeepLinkConversationId(new URLSearchParams("conversationId=from-params"))).toBe(
      "from-params",
    );
  });

  it("returns null when missing or blank", () => {
    expect(parseDeepLinkConversationId("")).toBeNull();
    expect(parseDeepLinkConversationId("?foo=1")).toBeNull();
    expect(parseDeepLinkConversationId("?conversationId=")).toBeNull();
    expect(parseDeepLinkConversationId("?conversationId=%20")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(parseDeepLinkConversationId("?conversationId=%20sess-1%20")).toBe("sess-1");
  });
});

describe("reminderAckPath", () => {
  it("builds POST path with encoded conversationId", () => {
    expect(reminderAckPath("a/b")).toBe("/api/reminders/a%2Fb/ack");
    expect(reminderAckPath("plain")).toBe("/api/reminders/plain/ack");
  });
});

describe("reminderDisplayTitle / meta", () => {
  it("prefers chatName then summary then conversationId", () => {
    expect(
      reminderDisplayTitle({
        conversationId: "c1",
        summary: "sum",
        chatName: "Chat",
        turnedEndedAt: 1,
        status: "pending",
        notifyId: "n",
      }),
    ).toBe("Chat");
    expect(
      reminderDisplayTitle({
        conversationId: "c1",
        summary: "sum",
        turnedEndedAt: 1,
        status: "pending",
        notifyId: "n",
      }),
    ).toBe("sum");
    expect(
      reminderDisplayTitle({
        conversationId: "c1",
        summary: "  ",
        turnedEndedAt: 1,
        status: "pending",
        notifyId: "n",
      }),
    ).toBe("c1");
  });

  it("uses workspaceLabel for project line", () => {
    expect(
      reminderDisplayMeta({
        conversationId: "c1",
        summary: "s",
        workspaceLabel: "idea/Demo",
        turnedEndedAt: 1,
        status: "pending",
        notifyId: "n",
      }),
    ).toBe("idea/Demo");
    expect(
      reminderDisplayMeta({
        conversationId: "c1",
        summary: "s",
        turnedEndedAt: 1,
        status: "pending",
        notifyId: "n",
      }),
    ).toBe("");
  });
});

describe("formatReminderEndedAt", () => {
  it("formats relative age under an hour", () => {
    const now = 1_700_000_000_000;
    expect(formatReminderEndedAt(now - 45_000, now)).toBe("45s 前");
    expect(formatReminderEndedAt(now - thrMinutes(3), now)).toBe("3min 前");
  });

  it("falls back to locale string for older times", () => {
    const ended = Date.UTC(2026, 0, 15, 8, 30, 0);
    const text = formatReminderEndedAt(ended, ended + 2 * 60 * 60 * 1000);
    expect(text).toMatch(/2026/);
  });
});

describe("sortInboxReminders", () => {
  it("orders newest turnedEndedAt first", () => {
    const a = baseReminder("a", 100);
    const b = baseReminder("b", 300);
    const c = baseReminder("c", 200);
    expect(sortInboxReminders([a, b, c]).map((r) => r.conversationId)).toEqual(["b", "c", "a"]);
  });
});

describe("inboxViewModel", () => {
  it("shows hooks CTA when hooks are not installed", () => {
    expect(
      inboxViewModel({
        reminders: [baseReminder("x", 1)],
        hooksInstalled: false,
      }),
    ).toEqual({
      mode: "hooks-cta",
      reminders: [],
      emptyHint: "未安装 hooks，Reminder 管线未启用",
      hooksCommand: "cursor-watch hooks install",
    });
  });

  it("shows short empty state when installed and no pending", () => {
    expect(
      inboxViewModel({
        reminders: [],
        hooksInstalled: true,
      }),
    ).toEqual({
      mode: "empty",
      reminders: [],
      emptyHint: "暂无待确认 Reminder",
      hooksCommand: null,
    });
  });

  it("lists sorted pending reminders when installed", () => {
    const model = inboxViewModel({
      reminders: [baseReminder("old", 10), baseReminder("new", 99)],
      hooksInstalled: true,
    });
    expect(model.mode).toBe("list");
    expect(model.reminders.map((r) => r.conversationId)).toEqual(["new", "old"]);
    expect(model.hooksCommand).toBeNull();
  });
});

function thrMinutes(n: number): number {
  return n * 60 * 1000;
}

function baseReminder(conversationId: string, turnedEndedAt: number) {
  return {
    conversationId,
    summary: `s-${conversationId}`,
    turnedEndedAt,
    status: "pending" as const,
    notifyId: `cursor-watch-reminder-${conversationId}`,
  };
}
