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
      title: "Cursors Watch",
      subtitle: "My Chat",
      message: "turn ended",
      openUrl: "http://127.0.0.1:7423/?conversationId=conv-42",
      sound: true,
    });
    expect(argv).toEqual([
      "/tmp/CursorWatchBanner",
      "Cursors Watch",
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
      title: "Cursors Watch",
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
      title: "Cursors Watch",
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
  it("uses terminal-notifier when shell is absent", () => {
    const run = vi.fn();
    const bin = resolveTerminalNotifierBin();
    expect(bin).toBeTruthy();
    expect(resolveBannerBin()).toBeNull();

    notifyReminder({
      record: record(),
      sound: false,
      panelUrl: "http://127.0.0.1:7423/",
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    const argv = run.mock.calls[0]![0] as string[];
    expect(argv[0]).toBe(bin);
    expect(argv).toContain("-title");
    expect(argv).toContain("Cursors Watch");
    expect(argv).toContain("-message");
    expect(argv.some((a) => a.includes("turn ended"))).toBe(true);
    expect(argv.some((a) => a.includes("conversationId=conv-42"))).toBe(true);
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
    expect(argv).toContain("Cursors Watch");
    expect(argv).not.toContain("-subtitle");
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
    const msgIdx = argv.indexOf("-message");
    expect(msgIdx).toBeGreaterThanOrEqual(0);
    const message = argv[msgIdx + 1]!;
    expect(message.length).toBeLessThanOrEqual(120);
    expect(message).toContain("…");
  });
});

describe("buildDisplayNotificationScript", () => {
  it("builds osascript fallback without alert", () => {
    const script = buildDisplayNotificationScript({
      title: "Cursors Watch",
      body: "hi",
      subtitle: "sub",
      sound: false,
    });
    expect(script).toContain("display notification");
    expect(script).not.toContain("display alert");
  });
});
