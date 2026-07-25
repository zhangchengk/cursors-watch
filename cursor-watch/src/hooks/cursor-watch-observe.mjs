#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EVENTS = new Set(["preToolUse", "afterAgentResponse", "stop"]);

/** Keep in sync with cursor-watch/src/constants.ts (hook must stay self-contained). */
const LOOP_SENTINEL_MARKERS = ["AGENT_LOOP_TICK_", "AGENT_LOOP_WAKE_"];
const LOOP_COMMAND_FINGERPRINT_MAX = 200;
const CURSOR_WATCH_CONVERSATION_ID_ENV = "CURSOR_WATCH_CONVERSATION_ID";

/** Basename-safe conversation id only — reject path separators / traversal. */
function isSafeConversationId(id) {
  if (typeof id !== "string" || !id) return false;
  if (id.includes("/") || id.includes("\\") || id.includes("..")) return false;
  if (path.basename(id) !== id) return false;
  return true;
}

function isLoopSentinelCommand(command) {
  if (!command) return false;
  return LOOP_SENTINEL_MARKERS.some((m) => command.includes(m));
}

function fingerprintCommand(command) {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (normalized.length <= LOOP_COMMAND_FINGERPRINT_MAX) return normalized;
  return normalized.slice(0, LOOP_COMMAND_FINGERPRINT_MAX);
}

/** Extract CURSOR_WATCH_CONVERSATION_ID=<id> with an id boundary after the value. */
function extractMarkedConversationId(command) {
  const prefix = `${CURSOR_WATCH_CONVERSATION_ID_ENV}=`;
  let from = 0;
  while (from <= command.length) {
    const idx = command.indexOf(prefix, from);
    if (idx === -1) return undefined;
    const start = idx + prefix.length;
    let end = start;
    while (end < command.length && /[A-Za-z0-9_-]/.test(command[end])) end++;
    if (end > start) return command.slice(start, end);
    from = idx + 1;
  }
  return undefined;
}

function listLoopLedger(home) {
  const file = path.join(home, ".cursor-watch", "loop-ledger.json");
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** Fail-open ledger upsert — never throws to caller. */
function recordLoopLedgerEntry(home, entry) {
  try {
    const dir = path.join(home, ".cursor-watch");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "loop-ledger.json");
    const entries = listLoopLedger(home);
    const next = {
      conversationId: entry.conversationId,
      seenAt: entry.seenAt,
      commandFingerprint: entry.commandFingerprint,
    };
    if (entry.markedConversationId !== undefined) {
      next.markedConversationId = entry.markedConversationId;
    }
    const idx = entries.findIndex(
      (e) => e && e.conversationId === entry.conversationId,
    );
    if (idx >= 0) entries[idx] = next;
    else entries.push(next);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, file);
  } catch {
    /* swallow */
  }
}

let raw = "";
try {
  raw = fs.readFileSync(0, "utf8");
} catch {
  process.exit(0);
}

try {
  const input = raw.trim() ? JSON.parse(raw) : {};
  const event = input.hook_event_name || input.event || "";
  const id =
    input.conversation_id ||
    input.session_id ||
    input.composer_id ||
    "";
  if (!id || !EVENTS.has(event) || !isSafeConversationId(id)) {
    process.exit(0);
  }
  const home = os.homedir();
  const dir = path.join(home, ".cursor-watch", "live");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.json`);
  let prev = null;
  try {
    prev = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* none */
  }
  const now = Date.now();
  const isStop = event === "stop";
  let hint = "";
  let toolCommand = "";
  if (input.tool_input && typeof input.tool_input.command === "string") {
    toolCommand = input.tool_input.command;
    const prefix =
      typeof input.tool_name === "string" ? input.tool_name : "Shell";
    hint = `${prefix}: ${toolCommand}`.slice(0, 200);
  } else if (typeof input.tool_name === "string") hint = input.tool_name;
  else if (typeof input.text === "string") hint = input.text.slice(0, 120);
  else if (prev && prev.liveHint) hint = prev.liveHint;

  if (event === "preToolUse" && isLoopSentinelCommand(toolCommand)) {
    const marked = extractMarkedConversationId(toolCommand);
    recordLoopLedgerEntry(home, {
      conversationId: id,
      seenAt: now,
      commandFingerprint: fingerprintCommand(toolCommand),
      ...(marked !== undefined ? { markedConversationId: marked } : {}),
    });
  }

  const snap = {
    conversationId: id,
    lastEvent: event,
    lastLiveAt: isStop ? (prev?.lastLiveAt ?? now) : now,
    stoppedAt: isStop ? now : null,
    liveHint: hint,
    updatedAt: now,
  };
  fs.writeFileSync(file, JSON.stringify(snap));
} catch {
  /* swallow — never block the agent */
}
process.exit(0);
