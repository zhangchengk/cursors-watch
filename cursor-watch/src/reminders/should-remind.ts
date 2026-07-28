import { loadReminders } from "./store.js";

/**
 * Whether this `stoppedAt` still needs a Reminder.
 * Uses the reminders file (pending or acked), not session.turnEndedAt —
 * full scan often stamps turnEnded before live flush and would otherwise
 * suppress the only remind opportunity.
 */
export function shouldRemindForStoppedAt(
  homeDir: string,
  conversationId: string,
  stoppedAt: number,
): boolean {
  const last = loadReminders(homeDir).find(
    (r) => r.conversationId === conversationId,
  );
  return last?.turnedEndedAt !== stoppedAt;
}
