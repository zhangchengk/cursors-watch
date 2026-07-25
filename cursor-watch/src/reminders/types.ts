export type ReminderStatus = "pending" | "acked";

export interface ReminderRecord {
  conversationId: string;
  projectKey?: string;
  workspacePath?: string;
  workspaceLabel?: string;
  chatName?: string;
  turnedEndedAt: number;
  summary: string;
  status: ReminderStatus;
  ackedAt?: number;
  notifyId: string;
}

export type UpsertPendingReminderInput = {
  conversationId: string;
  projectKey?: string;
  workspacePath?: string;
  workspaceLabel?: string;
  chatName?: string;
  turnedEndedAt: number;
  summary: string;
};
