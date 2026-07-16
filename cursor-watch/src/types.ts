export type AgentStatus = "waiting" | "running" | "subagent" | "idle" | "error";

export interface RecentMessage {
  role: "user" | "assistant" | "system";
  text: string;
  at?: number;
}

export interface SessionState {
  id: string;
  projectKey: string;
  workspacePath: string;
  workspaceLabel: string;
  status: AgentStatus;
  summary: string;
  currentAction: string;
  lastActivityAt: number;
  waitingSince?: number;
  runningSince?: number;
  subagentCount: number;
  subagentRunning: number;
  transcriptPath: string;
  recentMessages: RecentMessage[];
  /** internal: parent session id if this row is a subagent (aggregator strips these) */
  parentId?: string;
}
