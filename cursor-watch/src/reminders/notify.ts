import { spawn } from "node:child_process";
import type { ReminderRecord } from "./types.js";

/**
 * macOS `display notification` cannot attach a click → open URL handler.
 * Deep link (`panelUrl?conversationId=`) is embedded in the notification body;
 * the panel should treat that query (or focus + poll) as the open/ack path.
 */

export type NotifyReminderOpts = {
  record: ReminderRecord;
  sound: boolean;
  panelUrl: string;
  run?: (argv: string[]) => void;
};

const DEFAULT_TITLE = "Cursor Watch";
const DEFAULT_SOUND_NAME = "Glass";

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

function buildDisplayNotificationScript(opts: {
  title: string;
  body: string;
  sound: boolean;
}): string {
  const title = escapeAppleScriptString(opts.title);
  const body = escapeAppleScriptString(opts.body);
  let script = `display notification "${body}" with title "${title}"`;
  if (opts.sound) {
    script += ` sound name "${DEFAULT_SOUND_NAME}"`;
  }
  return script;
}

function defaultRun(argv: string[]): void {
  const child = spawn(argv[0]!, argv.slice(1), {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export function notifyReminder(opts: NotifyReminderOpts): void {
  const run = opts.run ?? defaultRun;
  const deepLink = buildReminderDeepLink(
    opts.panelUrl,
    opts.record.conversationId,
  );
  const title = opts.record.chatName?.trim() || DEFAULT_TITLE;
  const summary = opts.record.summary?.trim() || "本轮结束";
  // Body carries deep link so users (and later panel focus handlers) can open it;
  // plain osascript cannot open on notification click.
  const body = `${summary}\n${deepLink}`;
  const script = buildDisplayNotificationScript({
    title,
    body,
    sound: opts.sound,
  });
  run(["osascript", "-e", script]);
}
