import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stateDir } from "../constants.js";
import type { ReminderRecord } from "./types.js";

/**
 * Reminder delivery (macOS):
 * - Prefer Menubar shell OS notification via ~/.cursor-watch/shell-notify
 *   when shell.alive heartbeat is fresh.
 * - Fallback: vendored CursorWatchBanner HUD, then terminal-notifier /
 *   osascript. HUD path uses notify-worker + durable notify-queue.
 */

export type NotifyReminderOpts = {
  record: ReminderRecord;
  sound: boolean;
  panelUrl: string;
  run?: (argv: string[]) => void;
  /** Prefer/fallback delivery adapters (shell → hud). */
  adapters?: ReminderDeliveryAdapter[];
};

export type ReminderDeliveryIntent = {
  title: string;
  subtitle?: string;
  message: string;
  openUrl: string;
  group: string;
  sound: boolean;
  conversationId: string;
  notifyId: string;
};

export type DeliveryResult =
  | { ok: true; channel: "shell" | "hud" }
  | { ok: false; channel: "shell" | "hud" | "none" };

export type ReminderDeliveryAdapter = {
  name: "shell" | "hud" | string;
  deliver: (intent: ReminderDeliveryIntent) => DeliveryResult;
};

const DEFAULT_TITLE = "Cursor Watch";
const MAX_NOTIFY_BODY_CHARS = 160;
const BANNER_LIFETIME_SECONDS = "5";
/** Shell notify bridge directory under stateDir (Menubar shell listens). */
export const SHELL_NOTIFY_DIR_NAME = "shell-notify";

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

export function shellNotifyDir(homeDir = stateDir()): string {
  return path.join(homeDir, SHELL_NOTIFY_DIR_NAME);
}

export function buildDeliveryIntent(
  opts: Pick<NotifyReminderOpts, "record" | "sound" | "panelUrl">,
): ReminderDeliveryIntent {
  const chatName = opts.record.chatName?.trim();
  const subtitle = chatName
    ? truncateNotifyText(chatName, 80)
    : undefined;
  const message = truncateNotifyText(
    opts.record.summary?.trim() || "本轮结束",
    120,
  );
  return {
    title: DEFAULT_TITLE,
    subtitle,
    message,
    openUrl: buildReminderDeepLink(
      opts.panelUrl,
      opts.record.conversationId,
    ),
    group: opts.record.notifyId,
    sound: opts.sound,
    conversationId: opts.record.conversationId,
    notifyId: opts.record.notifyId,
  };
}

/**
 * Try shell bridge first: write intent JSON for Menubar shell.
 * Returns ok only when a shell lock/heartbeat file is present (shell running).
 */
export function shellDeliveryAdapter(
  homeDir = stateDir(),
  opts?: { maxAliveAgeMs?: number; now?: () => number },
): ReminderDeliveryAdapter {
  const maxAge = opts?.maxAliveAgeMs ?? 90_000;
  const now = opts?.now ?? Date.now;
  return {
    name: "shell",
    deliver(intent) {
      const alive = path.join(shellNotifyDir(homeDir), "shell.alive");
      if (!existsSync(alive)) {
        return { ok: false, channel: "shell" };
      }
      try {
        const age = now() - statSync(alive).mtimeMs;
        if (age > maxAge) {
          return { ok: false, channel: "shell" };
        }
        const dir = shellNotifyDir(homeDir);
        mkdirSync(dir, { recursive: true });
        const file = path.join(
          dir,
          `${Date.now()}-${intent.notifyId}.json`,
        );
        writeFileSync(file, `${JSON.stringify(intent)}\n`, "utf8");
        return { ok: true, channel: "shell" };
      } catch (err) {
        console.error("[cursor-watch] shell notify enqueue failed", err);
        return { ok: false, channel: "shell" };
      }
    },
  };
}

export function hudDeliveryAdapter(opts?: {
  run?: (argv: string[]) => void;
}): ReminderDeliveryAdapter {
  return {
    name: "hud",
    deliver(intent) {
      const bannerBin = resolveBannerBin();
      const tnBin = resolveTerminalNotifierBin();
      let argv: string[];
      if (bannerBin) {
        argv = buildBannerArgv({
          bin: bannerBin,
          title: intent.title,
          subtitle: intent.subtitle,
          message: intent.message,
          openUrl: intent.openUrl,
          sound: intent.sound,
        });
      } else if (tnBin) {
        argv = buildTerminalNotifierArgv({
          bin: tnBin,
          title: intent.title,
          subtitle: intent.subtitle,
          message: intent.message,
          group: intent.group,
          openUrl: intent.openUrl,
          sound: intent.sound,
        });
      } else {
        console.error("[cursor-watch] banner helpers missing");
        const script = buildDisplayNotificationScript({
          title: intent.title,
          body: intent.message,
          subtitle: intent.subtitle || intent.title,
          sound: intent.sound,
        });
        argv = ["/usr/bin/osascript", "-e", script];
      }

      if (opts?.run) {
        try {
          opts.run(argv);
          return { ok: true, channel: "hud" };
        } catch (err) {
          console.error("[cursor-watch] hud run failed", err);
          return { ok: false, channel: "hud" };
        }
      }

      try {
        enqueueNotifyArgv(argv);
      } catch (err) {
        console.error("[cursor-watch] notify enqueue failed", err);
        return { ok: false, channel: "hud" };
      }
      if (!sendViaWorker({ type: "drain" })) {
        startNotifyWorker();
        sendViaWorker({ type: "drain" });
      }
      return { ok: true, channel: "hud" };
    },
  };
}

export function deliverReminder(opts: {
  intent: ReminderDeliveryIntent;
  adapters: ReminderDeliveryAdapter[];
}): DeliveryResult {
  for (const adapter of opts.adapters) {
    try {
      const result = adapter.deliver(opts.intent);
      if (result.ok) return result;
    } catch (err) {
      console.error(
        `[cursor-watch] delivery adapter ${adapter.name} threw`,
        err,
      );
    }
  }
  return { ok: false, channel: "none" };
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
  const intent = buildDeliveryIntent(opts);
  const adapters =
    opts.adapters ??
    [shellDeliveryAdapter(), hudDeliveryAdapter({ run: opts.run })];
  deliverReminder({ intent, adapters });
}
