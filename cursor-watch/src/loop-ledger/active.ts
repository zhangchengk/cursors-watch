import { spawnSync } from "node:child_process";
import {
  CURSOR_WATCH_CONVERSATION_ID_ENV,
  LOOP_ACTIVE_WINDOW_MS,
} from "../constants.js";
import { isLoopSentinelCommand } from "./detect.js";
import { listLoopLedger } from "./store.js";

export type ProcessRow = { pid: number; command: string };

function conversationEnvMarker(conversationId: string): string {
  return `${CURSOR_WATCH_CONVERSATION_ID_ENV}=${conversationId}`;
}

/** True when command carries `${ENV}=${id}` with an id boundary after the value. */
function commandHasConversationEnv(command: string, conversationId: string): boolean {
  const marker = conversationEnvMarker(conversationId);
  let from = 0;
  while (from <= command.length) {
    const idx = command.indexOf(marker, from);
    if (idx === -1) return false;
    const after = idx + marker.length;
    if (after >= command.length) return true;
    // Boundary: end already handled; next char must be non-identifier
    // (whitespace, shell metachar like `;|&`, quote, etc.).
    if (!/[A-Za-z0-9_-]/.test(command[after]!)) return true;
    from = idx + 1;
  }
  return false;
}

/** Default macOS process table: `ps -ax -o pid=,command=`. */
export function defaultListProcesses(): ProcessRow[] {
  try {
    const out = spawnSync("ps", ["-ax", "-o", "pid=,command="], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (out.error || out.status !== 0) return [];
    const text = out.stdout ?? "";
    const rows: ProcessRow[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const m = /^(\d+)\s+(.*)$/.exec(trimmed);
      if (!m) continue;
      rows.push({ pid: Number(m[1]), command: m[2] });
    }
    return rows;
  } catch {
    return [];
  }
}

/**
 * True when this conversationId still has a live loop sentinel in the process table.
 *
 * Matching (per conversationId only — never project-wide):
 * 1. If ledger has `markedConversationId`, or any process argv contains
 *    `CURSOR_WATCH_CONVERSATION_ID=<id>` for this conversation → match those
 *    env-tagged sentinel processes only.
 * 2. Else: sentinel marker in command AND command includes ledger fingerprint
 *    AND entry `seenAt` within {@link LOOP_ACTIVE_WINDOW_MS} (24h).
 */
export function isActiveLoop(opts: {
  homeDir: string;
  conversationId: string;
  listProcesses?: () => ProcessRow[];
  now?: number;
}): boolean {
  const { homeDir, conversationId } = opts;
  const now = opts.now ?? Date.now();
  const entry = listLoopLedger(homeDir).find(
    (e) => e.conversationId === conversationId,
  );
  if (!entry) return false;

  const processes = (opts.listProcesses ?? defaultListProcesses)();

  const markedId = entry.markedConversationId;
  const envBound =
    markedId !== undefined ||
    processes.some((p) => commandHasConversationEnv(p.command, conversationId));

  if (envBound) {
    const id = markedId ?? conversationId;
    return processes.some(
      (p) =>
        commandHasConversationEnv(p.command, id) &&
        isLoopSentinelCommand(p.command),
    );
  }

  if (now - entry.seenAt > LOOP_ACTIVE_WINDOW_MS) return false;
  if (!entry.commandFingerprint) return false;

  return processes.some(
    (p) =>
      isLoopSentinelCommand(p.command) &&
      p.command.includes(entry.commandFingerprint),
  );
}
