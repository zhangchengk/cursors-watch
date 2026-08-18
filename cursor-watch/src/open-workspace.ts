import { spawn } from "node:child_process";
import fs from "node:fs";
import type { SessionState } from "./types.js";

export function isAllowedWorkspacePath(
  workspacePath: string,
  sessions: SessionState[],
  /** Extra allow-listed paths (e.g. pending Reminder cards no longer in live sessions). */
  extraAllowedPaths?: Iterable<string | undefined>,
): boolean {
  const p = workspacePath?.trim();
  if (!p) return false;
  if (sessions.some((s) => s.workspacePath === p)) return true;
  for (const x of extraAllowedPaths ?? []) {
    if (typeof x === "string" && x.trim() === p) return true;
  }
  return false;
}

export type OpenWorkspaceResult =
  | { ok: true }
  | { ok: false; error: string; statusCode?: number };

export async function openWorkspaceInCursor(opts: {
  workspacePath: string;
  sessions: SessionState[];
  extraAllowedPaths?: Iterable<string | undefined>;
  /** Force a new Cursor window so we do not replace the frontmost project's folder. */
  newWindow?: boolean;
  spawnCursor?: (args: string[]) => Promise<void>;
}): Promise<OpenWorkspaceResult> {
  const path = opts.workspacePath?.trim() ?? "";
  if (!isAllowedWorkspacePath(path, opts.sessions, opts.extraAllowedPaths)) {
    return { ok: false, error: "不允许打开该路径", statusCode: 403 };
  }
  const spawnCursor = opts.spawnCursor ?? defaultSpawnCursor;
  try {
    // Prefer CLI with -n when opening a folder that is not already in a window.
    // Plain `open -a Cursor <path>` often replaces the frontmost window's workspace.
    const args = opts.newWindow ? ["-n", path] : [path];
    await spawnCursor(args);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      statusCode: 500,
    };
  }
}

/** Bring Cursor.app to the foreground (macOS). No-op elsewhere. */
export async function activateCursorApp(
  activate?: () => Promise<void>,
): Promise<void> {
  const run = activate ?? defaultActivateCursor;
  try {
    await run();
  } catch {
    /* best-effort */
  }
}

function defaultActivateCursor(): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve();
      return;
    }
    const child = spawn("open", ["-a", "Cursor"], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once("error", () => finish());
    child.once("exit", () => finish());
    child.unref();
    // Don't block Open Chat jump on activate settling — fire and continue.
    setTimeout(finish, 200);
  });
}

const CURSOR_APP_BIN =
  "/Applications/Cursor.app/Contents/Resources/app/bin/cursor";

function resolveCursorBin(): string {
  if (fs.existsSync(CURSOR_APP_BIN)) return CURSOR_APP_BIN;
  return "cursor";
}

function defaultSpawnCursor(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const newWindow = args[0] === "-n";
    const folder = newWindow ? args[1] : args[0];
    // Always use the Cursor CLI (not `open -a Cursor <path>`).
    // `open -a Cursor <folder>` often replaces the frontmost window's workspace
    // instead of raising the existing window for that folder.
    // CLI without `-n` tells the running instance to focus that folder's window.
    const child = spawn(
      resolveCursorBin(),
      newWindow ? ["-n", folder ?? ""] : [folder ?? ""],
      {
        detached: true,
        stdio: "ignore",
        env: process.env,
      },
    );

    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };
    child.once("error", (err) => finish(err));
    child.once("exit", (code, signal) => {
      if (code && code !== 0) {
        finish(new Error(`打开 Cursor 失败（退出码 ${code}）`));
        return;
      }
      if (signal) {
        finish(new Error(`打开 Cursor 被中断: ${signal}`));
        return;
      }
      finish();
    });
    child.unref();
    // Resolve quickly once the process is spawned so Open Chat Phase 1 can
    // activate Cursor within the ≤1s budget (do not wait for CLI exit).
    setTimeout(() => finish(), 200);
  });
}
