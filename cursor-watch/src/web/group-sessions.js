export function urgencyBucket(s) {
  if (
    s.live ||
    s.status === "running" ||
    s.status === "subagent" ||
    s.status === "error"
  ) {
    return 0;
  }
  if (s.hasUnread || s.status === "waiting") return 1;
  return 2;
}

function activityAt(s) {
  return s.composerUpdatedAt ?? s.lastActivityAt ?? 0;
}

export function sortAttentionSessions(sessions) {
  return [...(sessions || [])].sort((a, b) => {
    const d = urgencyBucket(a) - urgencyBucket(b);
    if (d !== 0) return d;
    return activityAt(b) - activityAt(a);
  });
}

export function attentionCardLines(s, now = Date.now()) {
  const title = s.chatName || s.summary || s.id;
  const ageBase =
    s.status === "waiting" ? s.waitingSince ?? s.lastActivityAt : s.lastActivityAt;
  const subtitle =
    (s.live && s.liveHint) || s.summary || s.currentAction || "";
  return {
    title,
    ageMs: Math.max(0, now - Number(ageBase || 0)),
    subtitle,
    workspaceLabel: s.workspaceLabel || "",
  };
}
