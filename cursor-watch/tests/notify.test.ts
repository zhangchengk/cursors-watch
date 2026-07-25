import { describe, expect, it, vi } from "vitest";
import { notifyReminder } from "../src/reminders/notify.js";
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

describe("notifyReminder", () => {
  it("calls run with osascript silent notification (sound false)", () => {
    const run = vi.fn();
    notifyReminder({
      record: record(),
      sound: false,
      panelUrl: "http://127.0.0.1:7423/",
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    const argv = run.mock.calls[0]![0] as string[];
    expect(argv[0]).toBe("osascript");
    expect(argv).toContain("-e");
    const script = argv.slice(argv.indexOf("-e") + 1).join(" ");
    expect(script).toContain("display notification");
    expect(script).toContain("My Chat");
    expect(script).toContain("turn ended");
    expect(script).toMatch(/\?conversationId=conv-42/);
    expect(script).not.toMatch(/sound name/i);
  });

  it("calls run with sound name when sound true", () => {
    const run = vi.fn();
    notifyReminder({
      record: record(),
      sound: true,
      panelUrl: "http://127.0.0.1:7423/",
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    const argv = run.mock.calls[0]![0] as string[];
    const script = argv.slice(argv.indexOf("-e") + 1).join(" ");
    expect(script).toMatch(/sound name/i);
    expect(script).toMatch(/\?conversationId=conv-42/);
  });

  it("appends conversationId when panelUrl already has a query", () => {
    const run = vi.fn();
    notifyReminder({
      record: record({ conversationId: "abc" }),
      sound: false,
      panelUrl: "http://127.0.0.1:7423/?tab=inbox",
      run,
    });
    const argv = run.mock.calls[0]![0] as string[];
    const script = argv.slice(argv.indexOf("-e") + 1).join(" ");
    expect(script).toMatch(/[?&]conversationId=abc/);
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
    const script = argv.slice(argv.indexOf("-e") + 1).join(" ");
    expect(script).toContain("Cursor Watch");
  });
});
