import { LIVE_TTL_MS } from "./constants.js";
import type { AgentStatus, SessionState } from "./types.js";

export type LiveEvent = "preToolUse" | "afterAgentResponse" | "stop";

export interface LiveSnapshot {
  conversationId: string;
  lastEvent: LiveEvent;
  lastLiveAt: number;
  stoppedAt: number | null;
  liveHint: string;
  updatedAt: number;
}

export function deriveLiveFlags(
  snap: LiveSnapshot | undefined,
  now: number,
): { live: boolean; turnEnded: boolean; liveHint?: string } {
  if (!snap) return { live: false, turnEnded: false };
  const turnEnded = snap.stoppedAt != null;
  if (turnEnded) {
    return { live: false, turnEnded: true, liveHint: snap.liveHint || undefined };
  }
  const live = now - snap.lastLiveAt <= LIVE_TTL_MS;
  return { live, turnEnded: false, liveHint: snap.liveHint || undefined };
}

export function formatCompletionBanner(
  hasUnread: boolean,
  turnEnded: boolean,
): string | null {
  if (hasUnread) return "有未读 · 请查看";
  if (turnEnded) return "本轮结束";
  return null;
}

export function applyLiveToSession(
  session: SessionState,
  snap: LiveSnapshot | undefined,
  now: number,
): SessionState {
  const flags = deriveLiveFlags(snap, now);
  let status: AgentStatus = session.status;
  if (flags.live && status !== "error") status = "running";
  return {
    ...session,
    status,
    live: flags.live,
    turnEnded: flags.turnEnded,
    liveHint: flags.liveHint ?? session.liveHint,
  };
}
