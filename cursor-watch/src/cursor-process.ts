import { spawnSync } from "node:child_process";

const WATCH_NOISE = /cursorwatch|cursor-watch|cursor watch/i;

/**
 * macOS: true when Cursor IDE appears to be running (not Watch menubar/daemon).
 * Uses `pgrep -fl Cursor`; lines matching Watch-only noise are ignored.
 */
export function isCursorRunning(
  pgrepOutput: () => string = defaultPgrepOutput,
): boolean {
  const out = pgrepOutput().trim();
  if (!out) return false;
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (WATCH_NOISE.test(trimmed)) continue;
    if (/\bCursor\b/i.test(trimmed) || /Cursor\.app/i.test(trimmed)) {
      return true;
    }
  }
  return false;
}

function defaultPgrepOutput(): string {
  if (process.platform !== "darwin") return "";
  const r = spawnSync("pgrep", ["-fl", "Cursor"], { encoding: "utf8" });
  if (r.error || (r.status !== 0 && r.status !== 1)) return "";
  return r.stdout ?? "";
}
