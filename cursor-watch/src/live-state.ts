import type { ComposerHeaderMeta } from "./chat-names.js";
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
  if (status !== "error") {
    if (flags.live) {
      status = "running";
    } else if (
      flags.turnEnded ||
      (status !== "running" && status !== "subagent")
    ) {
      // Agent 已停（或非运行态）：黄=未读，白=已读
      status = session.hasUnread ? "waiting" : "idle";
    }
  }
  return {
    ...session,
    status,
    live: flags.live,
    turnEnded: flags.turnEnded,
    liveHint: flags.liveHint ?? session.liveHint,
  };
}

/** Merge composer header meta + live snapshot onto a parent session. */
export function mergeSessionExtras(
  session: SessionState,
  meta: ComposerHeaderMeta | undefined,
  snap: LiveSnapshot | undefined,
  now: number,
): SessionState {
  const withMeta: SessionState = {
    ...session,
    chatName: meta?.chatName ?? session.chatName,
    composerUpdatedAt: meta?.composerUpdatedAt ?? session.composerUpdatedAt,
    hasUnread: meta?.hasUnread ?? session.hasUnread,
    liveHint: snap?.liveHint || meta?.subtitle || session.liveHint,
  };
  return applyLiveToSession(withMeta, snap, now);
}
