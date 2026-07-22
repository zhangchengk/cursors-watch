import os from "node:os";
import path from "node:path";

export const TURN_ENDED_KEEP_MS = 30 * 60 * 1000;
export const IDLE_KEEP_MS = 15 * 60 * 1000;
export const VISIBILITY_PRUNE_MS = 30_000;
export const RUNNING_WINDOW_MS = 2 * 60 * 1000;
/** Skip parsing transcripts older than this (mtime); waiting beyond this is dropped. */
export const SCAN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const INCREMENTAL_DEBOUNCE_MS = 80;
/** Re-read composerHeaders at least this often (WAL may not bump main db mtime). */
export const HEADERS_CACHE_TTL_MS = 2_000;
export const FULL_SCAN_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_PORT = 7423;
export const SUMMARY_MAX_CHARS = 50;
export const RECENT_MESSAGE_COUNT = 8;
export const DECODE_MAX_DEPTH = 8;

export function cursorProjectsDir(home = os.homedir()): string {
  return path.join(home, ".cursor", "projects");
}

export function stateDir(home = os.homedir()): string {
  return path.join(home, ".cursor-watch");
}

export const LIVE_TTL_MS = 60 * 1000;
export const GROUP_TOP_N = 4;

export function liveDir(home = os.homedir()): string {
  return path.join(stateDir(home), "live");
}

export function pidFile(home = os.homedir()): string {
  return path.join(stateDir(home), "daemon.pid");
}


export const HOOK_SCRIPT_NAME = "cursor-watch-observe.mjs";
export const HOOK_COMMAND_MARKER = "cursor-watch-observe";

export function cursorUserHooksDir(home = os.homedir()): string {
  return path.join(home, ".cursor", "hooks");
}

export function cursorUserHooksJson(home = os.homedir()): string {
  return path.join(home, ".cursor", "hooks.json");
}

export function listenHost(): string {
  return "127.0.0.1";
}

export function listenPort(): number {
  const raw = process.env.CURSOR_WATCH_PORT;
  if (!raw) return DEFAULT_PORT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PORT;
}
