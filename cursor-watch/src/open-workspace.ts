import { spawn } from "node:child_process";
import fs from "node:fs";
import type { SessionState } from "./types.js";

export function isAllowedWorkspacePath(
  workspacePath: string,
  sessions: SessionState[],
): boolean {
  const p = workspacePath?.trim();
  if (!p) return false;
  return sessions.some((s) => s.workspacePath === p);
}

export type OpenWorkspaceResult =
  | { ok: true }
  | { ok: false; error: string; statusCode?: number };

export async function openWorkspaceInCursor(opts: {
  workspacePath: string;
  sessions: SessionState[];
  spawnCursor?: (args: string[]) => Promise<void>;
}): Promise<OpenWorkspaceResult> {
  const path = opts.workspacePath?.trim() ?? "";
  if (!isAllowedWorkspacePath(path, opts.sessions)) {
    return { ok: false, error: "不允许打开该路径", statusCode: 403 };
  }
  const spawnCursor = opts.spawnCursor ?? defaultSpawnCursor;
  try {
    // Pass folder path only (no -r). -r reuses the last-active window and often
    // fails to focus the already-open project window the user expects.
    await spawnCursor([path]);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      statusCode: 500,
    };
  }
}

const CURSOR_APP_BIN =
  "/Applications/Cursor.app/Contents/Resources/app/bin/cursor";

function resolveCursorBin(): string {
  if (fs.existsSync(CURSOR_APP_BIN)) return CURSOR_APP_BIN;
  return "cursor";
}

function defaultSpawnCursor(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // macOS: `open -a Cursor <folder>` activates the app and opens/focuses the
    // folder more reliably than the CLI from a detached daemon.
    const child =
      process.platform === "darwin"
        ? spawn("open", ["-a", "Cursor", ...args], {
            detached: true,
            stdio: "ignore",
            env: process.env,
          })
        : spawn(resolveCursorBin(), args, {
            detached: true,
            stdio: "ignore",
            env: process.env,
          });

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
    setTimeout(() => finish(), 1500);
  });
}
