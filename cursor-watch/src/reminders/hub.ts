import type { ReminderRecord } from "./types.js";
import { ackReminder, listPendingReminders } from "./store.js";

export type RemindersListener = (reminders: ReminderRecord[]) => void;

/**
 * In-memory pub/sub over the reminders file store (mirrors SessionStore).
 * Callers that mutate via the file store (pipeline) should call `notifyChanged`.
 */
export class ReminderHub {
  private listeners = new Set<RemindersListener>();

  constructor(private readonly homeDir: string) {}

  listPending(): ReminderRecord[] {
    return listPendingReminders(this.homeDir);
  }

  ack(conversationId: string, at?: number): boolean {
    const result = ackReminder(this.homeDir, conversationId, at);
    if (!result) return false;
    this.emit();
    return true;
  }

  /** Re-read pending and notify subscribers (e.g. after pipeline upsert). */
  notifyChanged(): void {
    this.emit();
  }

  subscribe(fn: RemindersListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const pending = this.listPending();
    for (const l of this.listeners) l(pending);
  }
}
