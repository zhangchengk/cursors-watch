import { existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReminderRecord } from "./types.js";

/**
 * macOS delivery:
 * - Prefer vendored terminal-notifier (Notification Center banner).
 * - Fallback: osascript display notification (may be silent on some machines).
 * - notify-worker keeps a clean FD table (daemon chokidar → spawn EBADF).
 */

export type NotifyReminderOpts = {
  record: ReminderRecord;
  sound: boolean;
  panelUrl: string;
  run?: (argv: string[]) => void;
};

const DEFAULT_TITLE = "Cursor Watch";
const MAX_NOTIFY_BODY_CHARS = 160;

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = fileURLToPath(
  new URL("./notify-worker.mjs", import.meta.url),
);

let worker: ChildProcess | null = null;

export function resolveTerminalNotifierBin(): string | null {
  const bin = path.resolve(
    here,
    "../../vendor/mac/terminal-notifier.app/Contents/MacOS/terminal-notifier",
  );
  return existsSync(bin) ? bin : null;
}

export function buildTerminalNotifierArgv(opts: {
  bin: string;
  title: string;
  subtitle?: string;
  message: string;
  group: string;
  openUrl: string;
  sound: boolean;
}): string[] {
  const argv = [
    opts.bin,
    "-title",
    opts.title,
    "-message",
    opts.message,
    "-group",
    opts.group,
    "-open",
    opts.openUrl,
  ];
  if (opts.subtitle?.trim()) {
    argv.push("-subtitle", opts.subtitle.trim());
  }
  if (opts.sound) {
    argv.push("-sound", "Glass");
  }
  return argv;
}

export function buildReminderDeepLink(
  panelUrl: string,
  conversationId: string,
): string {
  const base = panelUrl.trim();
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}conversationId=${encodeURIComponent(conversationId)}`;
}

function escapeAppleScriptString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function truncateNotifyText(
  text: string,
  max = MAX_NOTIFY_BODY_CHARS,
): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

export function buildDisplayNotificationScript(opts: {
  title: string;
  body: string;
  subtitle: string;
  sound: boolean;
}): string {
  const title = escapeAppleScriptString(opts.title);
  const body = escapeAppleScriptString(opts.body);
  const subtitle = escapeAppleScriptString(opts.subtitle);
  let script = `display notification "${body}" with title "${title}" subtitle "${subtitle}"`;
  if (opts.sound) {
    script += ` sound name "Glass"`;
  }
  return script;
}

/** Start before chokidar so the worker inherits a small FD set. */
export function startNotifyWorker(): void {
  if (worker && !worker.killed) return;
  try {
    worker = spawn(process.execPath, [workerPath], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      detached: false,
    });
    worker.on("error", (err) => {
      console.error("[cursor-watch] notify worker error", err);
      worker = null;
    });
    worker.on("exit", () => {
      worker = null;
    });
  } catch (err) {
    console.error("[cursor-watch] notify worker start failed", err);
    worker = null;
  }
}

export function stopNotifyWorker(): void {
  if (!worker) return;
  try {
    worker.kill();
  } catch {
    /* ignore */
  }
  worker = null;
}

function sendViaWorker(msg: Record<string, unknown>): boolean {
  if (!worker || !worker.connected) return false;
  try {
    worker.send(msg);
    return true;
  } catch (err) {
    console.error("[cursor-watch] notify worker send failed", err);
    return false;
  }
}

function defaultRun(argv: string[]): void {
  try {
    const child = spawn(argv[0]!, argv.slice(1), {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", (err) => {
      console.error("[cursor-watch] notify spawn error", err);
    });
    child.unref();
  } catch (err) {
    console.error("[cursor-watch] notify spawn threw", err);
  }
}

export function notifyReminder(opts: NotifyReminderOpts): void {
  const chatName = opts.record.chatName?.trim();
  const subtitle = chatName
    ? truncateNotifyText(chatName, 80)
    : undefined;
  const message = truncateNotifyText(
    opts.record.summary?.trim() || "本轮结束",
    120,
  );
  const openUrl = buildReminderDeepLink(
    opts.panelUrl,
    opts.record.conversationId,
  );
  const group = opts.record.notifyId;

  const bin = resolveTerminalNotifierBin();
  let argv: string[];
  if (bin) {
    argv = buildTerminalNotifierArgv({
      bin,
      title: DEFAULT_TITLE,
      subtitle,
      message,
      group,
      openUrl,
      sound: opts.sound,
    });
  } else {
    console.error("[cursor-watch] terminal-notifier missing");
    const script = buildDisplayNotificationScript({
      title: DEFAULT_TITLE,
      body: message,
      subtitle: subtitle || DEFAULT_TITLE,
      sound: opts.sound,
    });
    argv = ["/usr/bin/osascript", "-e", script];
  }

  if (opts.run) {
    opts.run(argv);
    return;
  }

  if (!sendViaWorker({ type: "notify", argv })) {
    defaultRun(argv);
  }
}
