import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REMINDER_NOTIFY_ID_PREFIX } from "../src/constants.js";
import { saveWatchPrefs } from "../src/prefs.js";
import { onEffectiveTurnEnd } from "../src/reminders/pipeline.js";
import type { NotifyReminderOpts } from "../src/reminders/notify.js";
import { listPendingReminders } from "../src/reminders/store.js";
import type { SessionState } from "../src/types.js";

const homes: string[] = [];

afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

function tempHome(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "cw-pipeline-"));
  homes.push(h);
  return h;
}

function session(
  over: Partial<
    Pick<
      SessionState,
      "projectKey" | "workspacePath" | "workspaceLabel" | "chatName" | "summary"
    >
  > = {},
): Pick<
  SessionState,
  "projectKey" | "workspacePath" | "workspaceLabel" | "chatName" | "summary"
> {
  return {
    projectKey: "proj",
    workspacePath: "/ws",
    workspaceLabel: "WS",
    chatName: "Chat A",
    summary: "session summary",
    ...over,
  };
}

describe("onEffectiveTurnEnd", () => {
  it("returns suppressed and skips upsert/notify when active loop", () => {
    const home = tempHome();
    const notify = vi.fn();
    const result = onEffectiveTurnEnd({
      homeDir: home,
      conversationId: "c1",
      session: session(),
      liveHint: "done",
      notify,
      isActiveLoop: () => true,
      now: 1_000,
    });

    expect(result).toBe("suppressed");
    expect(notify).not.toHaveBeenCalled();
    expect(listPendingReminders(home)).toHaveLength(0);
  });

  it("upserts pending and notifies once when not active loop", () => {
    const home = tempHome();
    saveWatchPrefs(home, { notificationSound: false });
    const notify = vi.fn();
    const result = onEffectiveTurnEnd({
      homeDir: home,
      conversationId: "c1",
      session: session(),
      liveHint: "turn done",
      notify,
      isActiveLoop: () => false,
      now: 2_000,
    });

    expect(result).toBe("upserted");
    const pending = listPendingReminders(home);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      conversationId: "c1",
      turnedEndedAt: 2_000,
      summary: "turn done",
      status: "pending",
      projectKey: "proj",
      workspacePath: "/ws",
      workspaceLabel: "WS",
      chatName: "Chat A",
      notifyId: `${REMINDER_NOTIFY_ID_PREFIX}c1`,
    });

    expect(notify).toHaveBeenCalledTimes(1);
    const opts = notify.mock.calls[0]![0] as NotifyReminderOpts;
    expect(opts.record.notifyId).toBe(`${REMINDER_NOTIFY_ID_PREFIX}c1`);
    expect(opts.record.summary).toBe("turn done");
    expect(opts.sound).toBe(false);
    expect(opts.panelUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it("second call coalesces to a single pending with stable notifyId", () => {
    const home = tempHome();
    const notify = vi.fn();
    const isActiveLoop = () => false;

    const first = onEffectiveTurnEnd({
      homeDir: home,
      conversationId: "c1",
      session: session({ summary: "first" }),
      liveHint: "first hint",
      notify,
      isActiveLoop,
      now: 1_000,
    });
    const second = onEffectiveTurnEnd({
      homeDir: home,
      conversationId: "c1",
      session: session({ chatName: "Chat B", summary: "second" }),
      liveHint: "second hint",
      notify,
      isActiveLoop,
      now: 3_000,
    });

    expect(first).toBe("upserted");
    expect(second).toBe("upserted");

    const pending = listPendingReminders(home);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      conversationId: "c1",
      turnedEndedAt: 3_000,
      summary: "second hint",
      chatName: "Chat B",
      notifyId: `${REMINDER_NOTIFY_ID_PREFIX}c1`,
    });
    expect(notify).toHaveBeenCalledTimes(2);
    const firstId = (notify.mock.calls[0]![0] as NotifyReminderOpts).record
      .notifyId;
    const secondId = (notify.mock.calls[1]![0] as NotifyReminderOpts).record
      .notifyId;
    expect(firstId).toBe(secondId);
  });

  it("uses prefs notificationSound true when notifying", () => {
    const home = tempHome();
    saveWatchPrefs(home, { notificationSound: true });
    const notify = vi.fn();
    onEffectiveTurnEnd({
      homeDir: home,
      conversationId: "c2",
      session: session(),
      notify,
      isActiveLoop: () => false,
      now: 5_000,
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect((notify.mock.calls[0]![0] as NotifyReminderOpts).sound).toBe(true);
  });

  it("falls back to session.summary when liveHint missing", () => {
    const home = tempHome();
    const notify = vi.fn();
    onEffectiveTurnEnd({
      homeDir: home,
      conversationId: "c3",
      session: session({ summary: "from session" }),
      notify,
      isActiveLoop: () => false,
      now: 6_000,
    });
    expect(listPendingReminders(home)[0]?.summary).toBe("from session");
  });

  it("invokes onReminderChanged after upsert, not when suppressed", () => {
    const home = tempHome();
    const notify = vi.fn();
    const onReminderChanged = vi.fn();

    const suppressed = onEffectiveTurnEnd({
      homeDir: home,
      conversationId: "c4",
      session: session(),
      notify,
      isActiveLoop: () => true,
      onReminderChanged,
      now: 7_000,
    });
    expect(suppressed).toBe("suppressed");
    expect(onReminderChanged).not.toHaveBeenCalled();

    const upserted = onEffectiveTurnEnd({
      homeDir: home,
      conversationId: "c4",
      session: session(),
      notify,
      isActiveLoop: () => false,
      onReminderChanged,
      now: 8_000,
    });
    expect(upserted).toBe("upserted");
    expect(onReminderChanged).toHaveBeenCalledTimes(1);
  });

  it("invokes onReminderChanged after upsert even when notify throws", () => {
    const home = tempHome();
    const onReminderChanged = vi.fn();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      onEffectiveTurnEnd({
        homeDir: home,
        conversationId: "c5",
        session: session(),
        notify: () => {
          throw new Error("os notify boom");
        },
        isActiveLoop: () => false,
        onReminderChanged,
        now: 9_000,
      }),
    ).toBe("upserted");
    expect(onReminderChanged).toHaveBeenCalledTimes(1);
    expect(listPendingReminders(home)).toHaveLength(1);
    errSpy.mockRestore();
  });
});
