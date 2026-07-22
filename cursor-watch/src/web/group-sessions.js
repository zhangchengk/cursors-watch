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

/** Temporary shim until Task 6 removes group wall usage from app.js */
export function groupSessionsForUi(sessions) {
  const list = sessions || [];
  return [
    {
      key: "",
      label: "",
      sessions: sortAttentionSessions(list),
      statusCounts: {},
      totalCount: list.length,
    },
  ];
}

export function formatStatusSummary(statusCounts) {
  const order = ["waiting", "error", "running", "subagent", "idle"];
  const icons = {
    waiting: "🟡",
    error: "🔴",
    running: "🟢",
    subagent: "🔵",
    idle: "⚪",
  };
  return order
    .filter((k) => (statusCounts[k] || 0) > 0)
    .map((k) => `${icons[k]}${statusCounts[k]}`)
    .join(" ");
}
