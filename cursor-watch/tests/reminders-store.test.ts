import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REMINDER_NOTIFY_ID_PREFIX, remindersFile } from "../src/constants.js";
import {
  ackReminder,
  listPendingReminders,
  loadReminders,
  upsertPendingReminder,
} from "../src/reminders/store.js";

const homes: string[] = [];

afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

function tempHome(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "cw-reminder-"));
  homes.push(h);
  return h;
}

describe("remindersFile", () => {
  it("is under stateDir", () => {
    const home = "/tmp/fake-home";
    expect(remindersFile(home)).toBe(
      path.join(home, ".cursor-watch", "reminders.json"),
    );
  });
});

describe("reminder store", () => {
  it("loadReminders returns [] when file missing", () => {
    const home = tempHome();
    expect(loadReminders(home)).toEqual([]);
  });

  it("coalesces two upserts for same conversationId into one pending", () => {
    const home = tempHome();
    upsertPendingReminder(home, {
      conversationId: "c1",
      turnedEndedAt: 1000,
      summary: "first",
      projectKey: "p1",
      chatName: "Chat A",
    });
    const second = upsertPendingReminder(home, {
      conversationId: "c1",
      turnedEndedAt: 2000,
      summary: "second",
      workspacePath: "/ws",
      workspaceLabel: "WS",
      chatName: "Chat B",
    });

    const pending = listPendingReminders(home);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      conversationId: "c1",
      turnedEndedAt: 2000,
      summary: "second",
      status: "pending",
      workspacePath: "/ws",
      workspaceLabel: "WS",
      chatName: "Chat B",
    });
    expect(second.notifyId).toBe(`${REMINDER_NOTIFY_ID_PREFIX}c1`);
    expect(loadReminders(home)).toHaveLength(1);
  });

  it("keeps notifyId stable across coalesce", () => {
    const home = tempHome();
    const a = upsertPendingReminder(home, {
      conversationId: "conv-x",
      turnedEndedAt: 1,
      summary: "a",
    });
    const b = upsertPendingReminder(home, {
      conversationId: "conv-x",
      turnedEndedAt: 2,
      summary: "b",
    });
    expect(a.notifyId).toBe(`${REMINDER_NOTIFY_ID_PREFIX}conv-x`);
    expect(b.notifyId).toBe(a.notifyId);
  });

  it("ack removes reminder from pending list", () => {
    const home = tempHome();
    upsertPendingReminder(home, {
      conversationId: "c1",
      turnedEndedAt: 1000,
      summary: "done",
    });
    upsertPendingReminder(home, {
      conversationId: "c2",
      turnedEndedAt: 1100,
      summary: "other",
    });

    const acked = ackReminder(home, "c1", 5000);
    expect(acked).toMatchObject({
      conversationId: "c1",
      status: "acked",
      ackedAt: 5000,
    });

    const pending = listPendingReminders(home);
    expect(pending.map((r) => r.conversationId)).toEqual(["c2"]);
    expect(pending.every((r) => r.status === "pending")).toBe(true);
  });

  it("ack returns null when conversationId not pending", () => {
    const home = tempHome();
    expect(ackReminder(home, "missing")).toBeNull();
  });

  it("upsert after ack creates a new pending for same conversationId", () => {
    const home = tempHome();
    upsertPendingReminder(home, {
      conversationId: "c1",
      turnedEndedAt: 1,
      summary: "old",
    });
    ackReminder(home, "c1", 2);
    const again = upsertPendingReminder(home, {
      conversationId: "c1",
      turnedEndedAt: 3,
      summary: "new",
    });
    expect(again.status).toBe("pending");
    expect(listPendingReminders(home)).toHaveLength(1);
    expect(listPendingReminders(home)[0]?.summary).toBe("new");
  });
});
