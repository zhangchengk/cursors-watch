import { describe, expect, it } from "vitest";
import {
  fetchRemindersPayload,
  filterRemindersByWorkspacePaths,
  formatReminderEndedAt,
  hrefWithoutDeepLinkConversationId,
  inboxViewModel,
  parseDeepLinkConversationId,
  pruneReminderWorkspaceFilterSelection,
  reminderAckPath,
  reminderDisplayMeta,
  reminderDisplayTitle,
  reminderWorkspaceFilterChips,
  resolveInboxCardAction,
  sameConversationOrder,
  shouldClearDeepLinkQuery,
  shouldShowReminderWorkspaceFilter,
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

describe("shouldClearDeepLinkQuery", () => {
  it("clears query only after successful ack so reload can retry", () => {
    expect(shouldClearDeepLinkQuery(true)).toBe(true);
    expect(shouldClearDeepLinkQuery(false)).toBe(false);
  });
});

describe("hrefWithoutDeepLinkConversationId", () => {
  it("strips conversationId and keeps other query + hash", () => {
    expect(
      hrefWithoutDeepLinkConversationId(
        "http://127.0.0.1:8787/?conversationId=abc&foo=1#inbox",
      ),
    ).toBe("/?foo=1#inbox");
  });

  it("returns path when conversationId was the only param", () => {
    expect(hrefWithoutDeepLinkConversationId("/?conversationId=x")).toBe("/");
  });
});

describe("fetchRemindersPayload", () => {
  it("returns list on ok JSON array", async () => {
    const list = [baseReminder("c1", 1)];
    const payload = await fetchRemindersPayload(async () =>
      new Response(JSON.stringify(list), { status: 200 }),
    );
    expect(payload).toEqual(list);
  });

  it("returns empty on network/throw so boot can continue", async () => {
    await expect(
      fetchRemindersPayload(async () => {
        throw new Error("network down");
      }),
    ).resolves.toEqual([]);
  });

  it("returns empty on non-OK or non-array body", async () => {
    await expect(
      fetchRemindersPayload(async () => new Response("nope", { status: 500 })),
    ).resolves.toEqual([]);
    await expect(
      fetchRemindersPayload(
        async () => new Response(JSON.stringify({ error: "x" }), { status: 200 }),
      ),
    ).resolves.toEqual([]);
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

describe("sameConversationOrder", () => {
  it("matches identical id sequences", () => {
    expect(sameConversationOrder(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("rejects length or order mismatch", () => {
    expect(sameConversationOrder(["a"], ["a", "b"])).toBe(false);
    expect(sameConversationOrder(["a", "b"], ["b", "a"])).toBe(false);
  });
});

describe("resolveInboxCardAction", () => {
  it("resolves ack and mark from delegated click targets", () => {
    const card = {
      getAttribute: (name: string) => (name === "data-conversation-id" ? "c1" : null),
      closest(sel: string) {
        return sel === "[data-conversation-id]" ? card : null;
      },
    };
    const ackBtn = {
      closest(sel: string) {
        if (sel === ".inbox-ack") return ackBtn;
        if (sel === "[data-conversation-id]") return card;
        return null;
      },
    };
    const markBtn = {
      closest(sel: string) {
        if (sel === ".library-mark-btn") return markBtn;
        if (sel === ".inbox-ack") return null;
        if (sel === "[data-conversation-id]") return card;
        return null;
      },
    };
    const root = {
      contains(node: unknown) {
        return node === ackBtn || node === markBtn;
      },
    };

    expect(resolveInboxCardAction(ackBtn, root)).toEqual({
      action: "ack",
      conversationId: "c1",
    });
    expect(resolveInboxCardAction(markBtn, root)).toEqual({
      action: "mark",
      conversationId: "c1",
    });
  });

  it("ignores clicks outside inbox root", () => {
    const orphanAck = {
      closest(sel: string) {
        return sel === ".inbox-ack" ? orphanAck : null;
      },
    };
    const root = { contains: () => false };
    expect(resolveInboxCardAction(orphanAck, root)).toBeNull();
  });
});

describe("reminder workspace filter", () => {
  it("shows filter only when distinct paths >= 2", () => {
    expect(shouldShowReminderWorkspaceFilter(0)).toBe(false);
    expect(shouldShowReminderWorkspaceFilter(1)).toBe(false);
    expect(shouldShowReminderWorkspaceFilter(2)).toBe(true);
  });

  it("builds chips with alias labels sorted by display text", () => {
    const reminders = [
      { ...baseReminder("a", 1), workspacePath: "/z/proj" },
      { ...baseReminder("b", 2), workspacePath: "/a/ops" },
      { ...baseReminder("c", 3), workspacePath: "/a/ops" },
      { ...baseReminder("d", 4), workspacePath: "" },
    ];
    const chips = reminderWorkspaceFilterChips(reminders, {
      "/z/proj": "YonData",
      "/a/ops": "OpsTools",
    });
    expect(chips.map((c) => ({ path: c.path, label: c.label }))).toEqual([
      { path: "/a/ops", label: "OpsTools" },
      { path: "/z/proj", label: "YonData" },
    ]);
  });

  it("falls back to absolute path when no alias", () => {
    const chips = reminderWorkspaceFilterChips(
      [{ ...baseReminder("a", 1), workspacePath: "/Users/me/repo" }],
      {},
    );
    expect(chips).toEqual([
      { path: "/Users/me/repo", label: "/Users/me/repo", titlePath: "/Users/me/repo" },
    ]);
  });

  it("filters by workspacePath OR; empty selection keeps all", () => {
    const reminders = [
      { ...baseReminder("a", 1), workspacePath: "/a" },
      { ...baseReminder("b", 2), workspacePath: "/b" },
      { ...baseReminder("c", 3), workspacePath: "/a" },
      { ...baseReminder("d", 4) },
    ];
    expect(filterRemindersByWorkspacePaths(reminders, []).map((r) => r.conversationId)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(filterRemindersByWorkspacePaths(reminders, ["/a"]).map((r) => r.conversationId)).toEqual([
      "a",
      "c",
    ]);
    expect(
      filterRemindersByWorkspacePaths(reminders, ["/a", "/b"]).map((r) => r.conversationId),
    ).toEqual(["a", "b", "c"]);
  });

  it("hides pathless reminders once any workspace is selected", () => {
    const reminders = [
      { ...baseReminder("a", 1), workspacePath: "/a" },
      { ...baseReminder("ghost", 2) },
    ];
    expect(filterRemindersByWorkspacePaths(reminders, ["/a"]).map((r) => r.conversationId)).toEqual([
      "a",
    ]);
  });

  it("prunes ghost selected paths", () => {
    expect(pruneReminderWorkspaceFilterSelection(["/a", "/gone", ""], ["/a", "/b"])).toEqual([
      "/a",
    ]);
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
