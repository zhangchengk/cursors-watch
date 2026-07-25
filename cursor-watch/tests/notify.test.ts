import { describe, expect, it, vi } from "vitest";
import {
  buildDisplayNotificationScript,
  buildTerminalNotifierArgv,
  notifyReminder,
  resolveTerminalNotifierBin,
} from "../src/reminders/notify.js";
import type { ReminderRecord } from "../src/reminders/types.js";

function record(over: Partial<ReminderRecord> = {}): ReminderRecord {
  return {
    conversationId: "conv-42",
    chatName: "My Chat",
    turnedEndedAt: 1_700_000_000_000,
    summary: "turn ended",
    status: "pending",
    notifyId: "cursor-watch-reminder-conv-42",
    ...over,
  };
}

describe("buildTerminalNotifierArgv", () => {
  it("includes title subtitle message group open and optional sound", () => {
    const argv = buildTerminalNotifierArgv({
      bin: "/tmp/terminal-notifier",
      title: "Cursor Watch",
      subtitle: "My Chat",
      message: "turn ended",
      group: "cursor-watch-reminder-conv-42",
      openUrl: "http://127.0.0.1:7423/?conversationId=conv-42",
      sound: true,
    });
    expect(argv[0]).toBe("/tmp/terminal-notifier");
    expect(argv).toContain("-title");
    expect(argv).toContain("Cursor Watch");
    expect(argv).toContain("-subtitle");
    expect(argv).toContain("My Chat");
    expect(argv).toContain("-message");
    expect(argv).toContain("turn ended");
    expect(argv).toContain("-group");
    expect(argv).toContain("cursor-watch-reminder-conv-42");
    expect(argv).toContain("-open");
    expect(argv).toContain("http://127.0.0.1:7423/?conversationId=conv-42");
    expect(argv).toContain("-sound");
    expect(argv).toContain("Glass");
  });

  it("omits -sound when sound false", () => {
    const argv = buildTerminalNotifierArgv({
      bin: "/tmp/terminal-notifier",
      title: "Cursor Watch",
      message: "x",
      group: "g",
      openUrl: "http://127.0.0.1:7423/",
      sound: false,
    });
    expect(argv).not.toContain("-sound");
  });
});

describe("notifyReminder", () => {
  it("calls run once with terminal-notifier argv (no afplay, no alert)", () => {
    const run = vi.fn();
    const bin = resolveTerminalNotifierBin();
    expect(bin).toBeTruthy();

    notifyReminder({
      record: record(),
      sound: false,
      panelUrl: "http://127.0.0.1:7423/",
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    const argv = run.mock.calls[0]![0] as string[];
    expect(argv[0]).toBe(bin);
    expect(argv.join(" ")).toContain("-title");
    expect(argv.join(" ")).toContain("Cursor Watch");
    expect(argv.join(" ")).toContain("-group");
    expect(argv.join(" ")).toContain("cursor-watch-reminder-conv-42");
    expect(argv.join(" ")).toContain("-open");
    expect(argv.join(" ")).toContain("conversationId=conv-42");
    expect(argv.join(" ")).not.toContain("display alert");
    expect(argv[0]).not.toBe("/usr/bin/afplay");
  });

  it("adds -sound Glass when sound true", () => {
    const run = vi.fn();
    notifyReminder({
      record: record(),
      sound: true,
      panelUrl: "http://127.0.0.1:7423/",
      run,
    });
    expect(run).toHaveBeenCalledTimes(1);
    const argv = run.mock.calls[0]![0] as string[];
    expect(argv).toContain("-sound");
    expect(argv).toContain("Glass");
  });

  it("falls back title when chatName missing", () => {
    const run = vi.fn();
    notifyReminder({
      record: record({ chatName: undefined }),
      sound: false,
      panelUrl: "http://127.0.0.1:7423/",
      run,
    });
    const argv = run.mock.calls[0]![0] as string[];
    expect(argv.join(" ")).toContain("Cursor Watch");
  });

  it("truncates long markdown summary", () => {
    const run = vi.fn();
    const long = "字".repeat(500);
    notifyReminder({
      record: record({ summary: long }),
      sound: false,
      panelUrl: "http://127.0.0.1:7423/",
      run,
    });
    const argv = run.mock.calls[0]![0] as string[];
    expect(argv.join(" ").length).toBeLessThan(2000);
    expect(argv.join(" ")).toContain("…");
  });
});

describe("buildDisplayNotificationScript", () => {
  it("builds osascript fallback without alert", () => {
    const script = buildDisplayNotificationScript({
      title: "Cursor Watch",
      body: "hi",
      subtitle: "sub",
      sound: false,
    });
    expect(script).toContain("display notification");
    expect(script).not.toContain("display alert");
  });
});
