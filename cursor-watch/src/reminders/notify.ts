import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stateDir } from "../constants.js";
import type { ReminderRecord } from "./types.js";

/**
 * macOS delivery:
 * - Prefer vendored CursorWatchBanner HUD (top-right panel). Notification Center
 *   banners are often denied / invisible for unsigned helpers on modern macOS.
 * - Fallback: terminal-notifier, then osascript display notification.
 * - Delivery goes through notify-worker (clean FDs) via IPC + durable queue
 *   (~/.cursor-watch/notify-queue) so lost IPC after long daemon uptime still fires.
 */

export type NotifyReminderOpts = {
  record: ReminderRecord;
  sound: boolean;
  panelUrl: string;
  run?: (argv: string[]) => void;
};

const DEFAULT_TITLE = "Cursor Watch";
const MAX_NOTIFY_BODY_CHARS = 160;
const BANNER_LIFETIME_SECONDS = "5";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = fileURLToPath(
  new URL("./notify-worker.mjs", import.meta.url),
);

let worker: ChildProcess | null = null;

export function resolveBannerBin(): string | null {
  const bin = path.resolve(
    here,
    "../../vendor/mac/CursorWatchBanner.app/Contents/MacOS/CursorWatchBanner",
  );
  return existsSync(bin) ? bin : null;
}

export function resolveTerminalNotifierBin(): string | null {
  const bin = path.resolve(
    here,
    "../../vendor/mac/terminal-notifier.app/Contents/MacOS/terminal-notifier",
  );
  return existsSync(bin) ? bin : null;
}

/** HUD argv: bin title subtitle body openUrl lifetimeSeconds sound01 */
export function buildBannerArgv(opts: {
  bin: string;
  title: string;
  subtitle?: string;
  message: string;
  openUrl: string;
  sound: boolean;
  lifetimeSeconds?: string;
}): string[] {
  return [
    opts.bin,
    opts.title,
    opts.subtitle?.trim() || "",
    opts.message,
    opts.openUrl,
    opts.lifetimeSeconds ?? BANNER_LIFETIME_SECONDS,
    opts.sound ? "1" : "0",
  ];
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

export function notifyQueueDir(homeDir = stateDir()): string {
  return path.join(homeDir, "notify-queue");
}

/** Durable handoff so delivery survives dead IPC / daemon FD exhaustion. */
export function enqueueNotifyArgv(argv: string[], homeDir = stateDir()): string {
  const dir = notifyQueueDir(homeDir);
  mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}.json`,
  );
  writeFileSync(file, `${JSON.stringify({ argv })}\n`, "utf8");
  return file;
}

/** Start before chokidar so the worker inherits a small FD set. */
export function startNotifyWorker(): void {
  if (worker && !worker.killed && worker.connected) return;
  if (worker) {
    try {
      worker.kill();
    } catch {
      /* ignore */
    }
    worker = null;
  }
  try {
    worker = spawn(process.execPath, [workerPath], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      detached: false,
      env: {
        ...process.env,
        CURSOR_WATCH_STATE_DIR: stateDir(),
      },
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

  const bannerBin = resolveBannerBin();
  const tnBin = resolveTerminalNotifierBin();
  let argv: string[];
  if (bannerBin) {
    argv = buildBannerArgv({
      bin: bannerBin,
      title: DEFAULT_TITLE,
      subtitle,
      message,
      openUrl,
      sound: opts.sound,
    });
  } else if (tnBin) {
    argv = buildTerminalNotifierArgv({
      bin: tnBin,
      title: DEFAULT_TITLE,
      subtitle,
      message,
      group,
      openUrl,
      sound: opts.sound,
    });
  } else {
    console.error("[cursor-watch] banner helpers missing");
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

  // Always enqueue first — worker drains the queue even if IPC is dead.
  try {
    enqueueNotifyArgv(argv);
  } catch (err) {
    console.error("[cursor-watch] notify enqueue failed", err);
  }

  if (sendViaWorker({ type: "drain" })) return;

  // IPC dead after long uptime / EBADF: restart sidecar and nudge drain.
  startNotifyWorker();
  sendViaWorker({ type: "drain" });
}
