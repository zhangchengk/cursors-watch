import fs from "node:fs";
import { ACTIVE_WINDOW_MS } from "./constants.js";
import type { AgentStatus, SessionState } from "./types.js";

const STATUS_RANK: Record<AgentStatus, number> = {
  waiting: 0,
  error: 1,
  running: 2,
  subagent: 2,
  idle: 3,
};

export function workspaceDirExists(workspacePath: string): boolean {
  const p = workspacePath?.trim();
  if (!p) return false;
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function aggregateSessions(
  sessions: SessionState[],
  now = Date.now(),
  workspaceExists: (workspacePath: string) => boolean = workspaceDirExists,
): SessionState[] {
  const children = sessions.filter((s) => s.parentId);
  const parents = sessions.filter((s) => !s.parentId);
  const byId = new Map(parents.map((p) => [p.id, { ...p }]));

  for (const child of children) {
    const parent = byId.get(child.parentId!);
    if (!parent) continue;
    parent.subagentCount += 1;
    if (child.status === "running" || child.status === "subagent") {
      parent.subagentRunning += 1;
    }
    parent.lastActivityAt = Math.max(parent.lastActivityAt, child.lastActivityAt);
    if (parent.subagentRunning > 0 && parent.status !== "error" && parent.status !== "running") {
      parent.status = "subagent";
      parent.currentAction = `${parent.subagentRunning} 个子 Agent 运行中`;
    }
  }

  const merged = [...byId.values()].filter((s) => {
    if (!workspaceExists(s.workspacePath)) return false;
    return s.hasUnread || now - s.lastActivityAt <= ACTIVE_WINDOW_MS;
  });

  merged.sort((a, b) => {
    const rd = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rd !== 0) return rd;
    if (a.status === "waiting") {
      return (a.waitingSince ?? a.lastActivityAt) - (b.waitingSince ?? b.lastActivityAt);
    }
    return b.lastActivityAt - a.lastActivityAt;
  });

  return merged;
}
