import fs from "node:fs";
import { REMINDER_NOTIFY_ID_PREFIX, remindersFile, stateDir } from "../constants.js";
import type { ReminderRecord, UpsertPendingReminderInput } from "./types.js";

function ensureStateDir(home: string): void {
  fs.mkdirSync(stateDir(home), { recursive: true });
}

function isReminderRecord(raw: unknown): raw is ReminderRecord {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return (
    typeof o.conversationId === "string" &&
    !!o.conversationId &&
    typeof o.turnedEndedAt === "number" &&
    Number.isFinite(o.turnedEndedAt) &&
    typeof o.summary === "string" &&
    (o.status === "pending" || o.status === "acked") &&
    typeof o.notifyId === "string" &&
    !!o.notifyId
  );
}

function saveReminders(home: string, records: ReminderRecord[]): void {
  ensureStateDir(home);
  const file = remindersFile(home);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

export function loadReminders(home: string): ReminderRecord[] {
  const file = remindersFile(home);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(isReminderRecord);
  } catch {
    return [];
  }
}

export function listPendingReminders(home: string): ReminderRecord[] {
  return loadReminders(home).filter((r) => r.status === "pending");
}

export function upsertPendingReminder(
  home: string,
  partial: UpsertPendingReminderInput,
): ReminderRecord {
  const records = loadReminders(home);
  const notifyId = `${REMINDER_NOTIFY_ID_PREFIX}${partial.conversationId}`;
  const idx = records.findIndex(
    (r) => r.conversationId === partial.conversationId && r.status === "pending",
  );

  const next: ReminderRecord = {
    conversationId: partial.conversationId,
    projectKey: partial.projectKey,
    workspacePath: partial.workspacePath,
    workspaceLabel: partial.workspaceLabel,
    chatName: partial.chatName,
    turnedEndedAt: partial.turnedEndedAt,
    summary: partial.summary,
    status: "pending",
    notifyId,
  };

  if (idx >= 0) {
    const prev = records[idx]!;
    const merged: ReminderRecord = {
      ...prev,
      conversationId: partial.conversationId,
      turnedEndedAt: partial.turnedEndedAt,
      summary: partial.summary,
      status: "pending",
      notifyId: prev.notifyId || notifyId,
    };
    if (partial.projectKey !== undefined) merged.projectKey = partial.projectKey;
    if (partial.workspacePath !== undefined) merged.workspacePath = partial.workspacePath;
    if (partial.workspaceLabel !== undefined) merged.workspaceLabel = partial.workspaceLabel;
    if (partial.chatName !== undefined) merged.chatName = partial.chatName;
    delete merged.ackedAt;
    records[idx] = merged;
  } else {
    const ackedIdx = records.findIndex(
      (r) => r.conversationId === partial.conversationId,
    );
    if (ackedIdx >= 0) {
      records[ackedIdx] = next;
    } else {
      records.push(next);
    }
  }

  saveReminders(home, records);
  const pending = records.find(
    (r) => r.conversationId === partial.conversationId && r.status === "pending",
  );
  return pending!;
}

export function ackReminder(
  home: string,
  conversationId: string,
  at?: number,
): ReminderRecord | null {
  const records = loadReminders(home);
  const idx = records.findIndex(
    (r) => r.conversationId === conversationId && r.status === "pending",
  );
  if (idx < 0) return null;

  const ackedAt = at ?? Date.now();
  const acked: ReminderRecord = {
    ...records[idx]!,
    status: "acked",
    ackedAt,
  };
  // Keep acked for audit but exclude from pending getters; replace in place.
  records[idx] = acked;
  saveReminders(home, records);
  return acked;
}
