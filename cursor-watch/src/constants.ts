import os from "node:os";
import path from "node:path";

export const ACTIVE_WINDOW_MS = 30 * 60 * 1000;
export const RUNNING_WINDOW_MS = 2 * 60 * 1000;
export const DEFAULT_PORT = 7423;
export const SUMMARY_MAX_CHARS = 50;
export const RECENT_MESSAGE_COUNT = 3;
export const DECODE_MAX_DEPTH = 8;

export function cursorProjectsDir(home = os.homedir()): string {
  return path.join(home, ".cursor", "projects");
}

export function stateDir(home = os.homedir()): string {
  return path.join(home, ".cursor-watch");
}

export function pidFile(home = os.homedir()): string {
  return path.join(stateDir(home), "daemon.pid");
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
