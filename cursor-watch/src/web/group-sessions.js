const STATUS_RANK = {
  waiting: 0,
  error: 1,
  running: 2,
  subagent: 2,
  idle: 3,
};

export function groupKey(session) {
  if (session.workspacePath) return session.workspacePath;
  if (session.workspaceLabel) return session.workspaceLabel;
  return session.projectKey || "";
}

export function groupLabel(session, key) {
  if (session.workspaceLabel) return session.workspaceLabel;
  return key;
}

function sessionSortKey(s) {
  const rank = STATUS_RANK[s.status] ?? 99;
  if (s.status === "waiting") {
    return [rank, s.waitingSince ?? s.lastActivityAt ?? 0];
  }
  return [rank, -(s.lastActivityAt ?? 0)];
}

function cmpSession(a, b) {
  const ka = sessionSortKey(a);
  const kb = sessionSortKey(b);
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  return ka[1] - kb[1];
}

function cmpGroup(a, b) {
  const topA = a.sessions[0];
  const topB = b.sessions[0];
  return cmpSession(topA, topB);
}

/**
 * @param {Array<Record<string, unknown>>} sessions
 * @returns {Array<{ key: string, label: string, sessions: Array<Record<string, unknown>>, statusCounts: Record<string, number> }>}
 */
export function groupSessionsForUi(sessions) {
  const map = new Map();
  for (const s of sessions || []) {
    const key = groupKey(s);
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        label: groupLabel(s, key),
        sessions: [],
        statusCounts: {},
      };
      map.set(key, g);
    }
    g.sessions.push(s);
    const st = s.status || "idle";
    g.statusCounts[st] = (g.statusCounts[st] || 0) + 1;
  }

  const groups = [...map.values()];
  for (const g of groups) {
    g.sessions.sort(cmpSession);
  }
  groups.sort(cmpGroup);
  return groups;
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
