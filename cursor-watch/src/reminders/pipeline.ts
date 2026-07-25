import { listenHost, listenPort } from "../constants.js";
import { isActiveLoop as defaultIsActiveLoop } from "../loop-ledger/active.js";
import { loadWatchPrefs } from "../prefs.js";
import type { SessionState } from "../types.js";
import { notifyReminder, type NotifyReminderOpts } from "./notify.js";
import { upsertPendingReminder } from "./store.js";

export type SessionReminderMeta = Pick<
  SessionState,
  "projectKey" | "workspacePath" | "workspaceLabel" | "chatName" | "summary"
>;

export type IsActiveLoopFn = (opts: {
  homeDir: string;
  conversationId: string;
  now?: number;
}) => boolean;

export type NotifyReminderFn = (opts: NotifyReminderOpts) => void;

export type OnEffectiveTurnEndOpts = {
  homeDir: string;
  conversationId: string;
  session?: SessionReminderMeta;
  liveHint?: string;
  notify?: NotifyReminderFn;
  isActiveLoop?: IsActiveLoopFn;
  now?: number;
};

function defaultPanelUrl(): string {
  return `http://${listenHost()}:${listenPort()}/`;
}

function reminderSummary(
  liveHint: string | undefined,
  session: SessionReminderMeta | undefined,
): string {
  const fromHint = liveHint?.trim();
  if (fromHint) return fromHint;
  const fromSession = session?.summary?.trim();
  if (fromSession) return fromSession;
  return "本轮结束";
}

/**
 * Effective turn end → Reminder pipeline.
 * Active loop suppresses; otherwise upsert pending + OS notify (coalesce by conversationId).
 */
export function onEffectiveTurnEnd(
  opts: OnEffectiveTurnEndOpts,
): "suppressed" | "upserted" {
  const {
    homeDir,
    conversationId,
    session,
    liveHint,
  } = opts;
  const now = opts.now ?? Date.now();
  const checkActive = opts.isActiveLoop ?? defaultIsActiveLoop;
  const notify = opts.notify ?? notifyReminder;

  if (checkActive({ homeDir, conversationId, now })) {
    return "suppressed";
  }

  const record = upsertPendingReminder(homeDir, {
    conversationId,
    projectKey: session?.projectKey,
    workspacePath: session?.workspacePath,
    workspaceLabel: session?.workspaceLabel,
    chatName: session?.chatName,
    turnedEndedAt: now,
    summary: reminderSummary(liveHint, session),
  });

  const prefs = loadWatchPrefs(homeDir);
  notify({
    record,
    sound: prefs.notificationSound,
    panelUrl: defaultPanelUrl(),
  });

  return "upserted";
}
