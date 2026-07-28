import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildBannerArgv,
  buildDisplayNotificationScript,
  buildTerminalNotifierArgv,
  enqueueNotifyArgv,
  notifyQueueDir,
  notifyReminder,
  resolveBannerBin,
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

describe("enqueueNotifyArgv", () => {
  it("writes argv json under notify-queue", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-notify-"));
    const file = enqueueNotifyArgv(["/bin/echo", "hi"], home);
    expect(file.startsWith(notifyQueueDir(home))).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(parsed.argv).toEqual(["/bin/echo", "hi"]);
  });
});

describe("buildBannerArgv", () => {
  it("orders title subtitle body openUrl lifetime sound", () => {
    const argv = buildBannerArgv({
      bin: "/tmp/CursorWatchBanner",
      title: "Cursor Watch",
      subtitle: "My Chat",
      message: "turn ended",
      openUrl: "http://127.0.0.1:7423/?conversationId=conv-42",
      sound: true,
    });
    expect(argv).toEqual([
      "/tmp/CursorWatchBanner",
      "Cursor Watch",
      "My Chat",
      "turn ended",
      "http://127.0.0.1:7423/?conversationId=conv-42",
      "5",
      "1",
    ]);
  });

  it("uses empty subtitle and sound 0 when omitted/false", () => {
    const argv = buildBannerArgv({
      bin: "/tmp/b",
      title: "Cursor Watch",
      message: "x",
      openUrl: "http://127.0.0.1:7423/",
      sound: false,
    });
    expect(argv[2]).toBe("");
    expect(argv[6]).toBe("0");
  });
});

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
    expect(argv).toContain("-group");
    expect(argv).toContain("-sound");
    expect(argv).toContain("Glass");
  });
});

describe("notifyReminder", () => {
  it("prefers CursorWatchBanner HUD argv", () => {
    const run = vi.fn();
    const bin = resolveBannerBin();
    expect(bin).toBeTruthy();
    expect(resolveTerminalNotifierBin()).toBeTruthy();

    notifyReminder({
      record: record(),
      sound: false,
      panelUrl: "http://127.0.0.1:7423/",
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    const argv = run.mock.calls[0]![0] as string[];
    expect(argv[0]).toBe(bin);
    expect(argv[1]).toBe("Cursor Watch");
    expect(argv[2]).toBe("My Chat");
    expect(argv[3]).toContain("turn ended");
    expect(argv[4]).toContain("conversationId=conv-42");
    expect(argv[6]).toBe("0");
  });

  it("sets sound flag when sound true", () => {
    const run = vi.fn();
    notifyReminder({
      record: record(),
      sound: true,
      panelUrl: "http://127.0.0.1:7423/",
      run,
    });
    const argv = run.mock.calls[0]![0] as string[];
    expect(argv[6]).toBe("1");
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
    expect(argv[1]).toBe("Cursor Watch");
    expect(argv[2]).toBe("");
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
    expect(argv[3]!.length).toBeLessThanOrEqual(120);
    expect(argv[3]).toContain("…");
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
