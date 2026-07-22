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
  const title = (s.chatName || s.summary || s.id || "").trim();
  const ageBase =
    s.status === "waiting" ? s.waitingSince ?? s.lastActivityAt : s.lastActivityAt;
  const subtitle =
    (s.live && s.liveHint) || s.summary || s.currentAction || "";
  const workspacePath = (s.workspacePath || "").trim();
  const workspaceLabel = (s.workspaceLabel || "").trim();
  // Prefer absolute path so cards stay distinguishable when labels truncate.
  const workspaceDir = workspacePath || workspaceLabel;
  return {
    title,
    ageMs: Math.max(0, now - Number(ageBase || 0)),
    subtitle,
    workspaceLabel,
    workspacePath,
    workspaceDir,
  };
}

const GROUP_TOP_N = 4;

export function groupKey(session) {
  if (session.workspacePath) return session.workspacePath;
  if (session.workspaceLabel) return session.workspaceLabel;
  return session.projectKey || "";
}

export function groupLabel(session, key) {
  if (session.workspaceLabel) return session.workspaceLabel;
  return key;
}

function hasReminder(s) {
  return Boolean(s.hasUnread || s.turnEnded);
}

/** 0 正在运行 → 1 待查看 → 2 本轮结束/其它 */
function cardBucket(s) {
  return urgencyBucket(s);
}

function cmpCard(a, b) {
  const ba = cardBucket(a);
  const bb = cardBucket(b);
  if (ba !== bb) return ba - bb;
  return activityAt(b) - activityAt(a);
}

/** Group ordering uses first-card urgency (same keys as within-group). */
function cmpSession(a, b) {
  return cmpCard(a, b);
}

function cmpGroup(a, b) {
  const topA = a.sessions[0];
  const topB = b.sessions[0];
  return cmpSession(topA, topB);
}

function limitGroupSessions(sessions) {
  const sortedByActivity = [...sessions].sort((a, b) => activityAt(b) - activityAt(a));
  const top = sortedByActivity.slice(0, GROUP_TOP_N);
  const ids = new Set(top.map((s) => s.id));
  for (const s of sessions) {
    if (hasReminder(s) && !ids.has(s.id)) {
      top.push(s);
      ids.add(s.id);
    }
  }
  return top.sort(cmpCard);
}

function recountStatuses(sessions) {
  const statusCounts = {};
  for (const s of sessions) {
    const st = s.status || "idle";
    statusCounts[st] = (statusCounts[st] || 0) + 1;
  }
  return statusCounts;
}

/**
 * @param {Array<Record<string, unknown>>} sessions
 * @returns {Array<{ key: string, label: string, sessions: Array<Record<string, unknown>>, statusCounts: Record<string, number>, totalCount: number }>}
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
        totalCount: 0,
      };
      map.set(key, g);
    }
    g.sessions.push(s);
  }

  const groups = [...map.values()];
  for (const g of groups) {
    g.totalCount = g.sessions.length;
    g.sessions = limitGroupSessions(g.sessions);
    g.statusCounts = recountStatuses(g.sessions);
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
