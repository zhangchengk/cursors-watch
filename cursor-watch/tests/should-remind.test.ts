import { describe, expect, it } from "vitest";
import { shouldRemindForStoppedAt } from "../src/reminders/should-remind.js";
import {
  ackReminder,
  upsertPendingReminder,
} from "../src/reminders/store.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function tmpHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-should-remind-"));
  cleanups.push(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

describe("shouldRemindForStoppedAt", () => {
  it("true when no prior reminder", () => {
    const home = tmpHome();
    expect(shouldRemindForStoppedAt(home, "c1", 100)).toBe(true);
  });

  it("false when pending/acked already has same turnedEndedAt", () => {
    const home = tmpHome();
    upsertPendingReminder(home, {
      conversationId: "c1",
      turnedEndedAt: 100,
      summary: "x",
    });
    expect(shouldRemindForStoppedAt(home, "c1", 100)).toBe(false);
    ackReminder(home, "c1", 101);
    expect(shouldRemindForStoppedAt(home, "c1", 100)).toBe(false);
  });

  it("true when newer stoppedAt after ack", () => {
    const home = tmpHome();
    upsertPendingReminder(home, {
      conversationId: "c1",
      turnedEndedAt: 100,
      summary: "x",
    });
    ackReminder(home, "c1", 101);
    expect(shouldRemindForStoppedAt(home, "c1", 200)).toBe(true);
  });
});
