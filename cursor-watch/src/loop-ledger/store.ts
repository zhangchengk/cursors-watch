import fs from "node:fs";
import { loopLedgerFile, stateDir } from "../constants.js";
import type { LoopLedgerEntry } from "./types.js";

function ensureStateDir(home: string): void {
  fs.mkdirSync(stateDir(home), { recursive: true });
}

function isLoopLedgerEntry(raw: unknown): raw is LoopLedgerEntry {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.conversationId !== "string" ||
    !o.conversationId ||
    typeof o.seenAt !== "number" ||
    !Number.isFinite(o.seenAt) ||
    typeof o.commandFingerprint !== "string"
  ) {
    return false;
  }
  if (
    o.markedConversationId !== undefined &&
    typeof o.markedConversationId !== "string"
  ) {
    return false;
  }
  return true;
}

function saveLoopLedger(home: string, entries: LoopLedgerEntry[]): void {
  ensureStateDir(home);
  const file = loopLedgerFile(home);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

export function listLoopLedger(home: string): LoopLedgerEntry[] {
  const file = loopLedgerFile(home);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(isLoopLedgerEntry);
  } catch {
    return [];
  }
}

export function recordLoopLedgerEntry(home: string, entry: LoopLedgerEntry): void {
  const entries = listLoopLedger(home);
  const next: LoopLedgerEntry = {
    conversationId: entry.conversationId,
    seenAt: entry.seenAt,
    commandFingerprint: entry.commandFingerprint,
  };
  if (entry.markedConversationId !== undefined) {
    next.markedConversationId = entry.markedConversationId;
  }
  const idx = entries.findIndex((e) => e.conversationId === entry.conversationId);
  if (idx >= 0) {
    entries[idx] = next;
  } else {
    entries.push(next);
  }
  saveLoopLedger(home, entries);
}

export function clearLoopLedgerEntry(home: string, conversationId: string): void {
  const entries = listLoopLedger(home);
  const next = entries.filter((e) => e.conversationId !== conversationId);
  if (next.length === entries.length) return;
  saveLoopLedger(home, next);
}
