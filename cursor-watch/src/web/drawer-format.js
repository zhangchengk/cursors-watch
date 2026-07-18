/**
 * Human-friendly drawer formatting (pure helpers).
 */

const STATUS_ZH = {
  waiting: "未读",
  running: "正在运行",
  subagent: "子任务进行中",
  idle: "已读",
  error: "出错",
};

export function formatRelativeTime(ts, now = Date.now()) {
  if (ts == null || !Number.isFinite(Number(ts))) return "";
  const ms = Math.max(0, now - Number(ts));
  const s = Math.floor(ms / 1000);
  if (s < 60) return "刚刚";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

/** One Chinese status sentence for the drawer hero. */
export function formatStatusSentence(s, now = Date.now()) {
  const icon = { waiting: "🟡", running: "🟢", subagent: "🔵", idle: "⚪", error: "🔴" }[
    s.status
  ];
  const base = STATUS_ZH[s.status] || s.status || "未知";
  const flags = [];
  if (s.live) flags.push("实时活跃");
  if (s.hasUnread) flags.push("有未读，请查看");
  else if (s.turnEnded) flags.push("本轮已结束");
  const ageBase =
    s.status === "waiting" ? s.waitingSince ?? s.lastActivityAt : s.lastActivityAt;
  const rel = formatRelativeTime(ageBase, now);
  const timeBit = rel ? (rel === "刚刚" ? "刚刚有活动" : `${rel}有活动`) : "";
  const mid = flags.length ? ` · ${flags.join(" · ")}` : "";
  const tail = timeBit ? ` · ${timeBit}` : "";
  return `${icon ?? ""} ${base}${mid}${tail}`.replace(/\s+/g, " ").trim();
}

export function isToolOnlyMessage(text) {
  const t = String(text || "").trim();
  return /^\[tool\]\s*\S+/i.test(t);
}

/** Cursor / Agent 内部提示，不应当作「最近进展」展示。 */
export function isNoiseProgressText(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (isToolOnlyMessage(t)) return true;
  if (/^Briefly inform the user about the task result/i.test(t)) return true;
  if (/^If there's no follow-ups needed/i.test(t)) return true;
  if (/^perform any follow-up actions \(if needed\)/i.test(t)) return true;
  return false;
}

/**
 * Prefer readable user/assistant text; skip tools and meta prompts.
 * @param {Array<{role?: string, text?: string}>} messages
 * @param {number} limit
 * @param {{ role?: string }} [opts] 若指定 role，只保留该角色
 */
export function pickReadableMessages(messages, limit = 2, opts = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const roleFilter = opts.role;
  const out = [];
  for (let i = list.length - 1; i >= 0 && out.length < limit; i--) {
    const m = list[i];
    if (!m || !m.text) continue;
    if (roleFilter && m.role !== roleFilter) continue;
    if (isNoiseProgressText(m.text)) continue;
    const text = String(m.text).replace(/\s+/g, " ").trim();
    if (!text) continue;
    out.unshift({
      role: m.role || "assistant",
      text: text.length > 160 ? `${text.slice(0, 159)}…` : text,
    });
  }
  return out;
}

export function formatActionLine(s) {
  if (s.live && s.liveHint) return String(s.liveHint);
  return s.currentAction ? String(s.currentAction) : "";
}

function clip(text, maxLen) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > maxLen ? `${t.slice(0, maxLen - 1)}…` : t;
}

/** Latest human-readable Agent progress for card subtitle (same source as drawer 最近进展). */
export function latestProgressText(s, maxLen = 120) {
  const msgs = s?.recentMessages;
  // Prefer assistant body — never surface Cursor meta user nudges as "progress".
  let picked = pickReadableMessages(msgs, 1, { role: "assistant" });
  if (!picked.length) picked = pickReadableMessages(msgs, 1);
  if (picked.length) return clip(picked[0].text, maxLen);

  if (s?.live && s?.liveHint) {
    const hint = clip(s.liveHint, maxLen);
    if (hint && !isNoiseProgressText(hint)) return hint;
  }

  const summary =
    typeof s?.summary === "string" ? s.summary.replace(/\s+/g, " ").trim() : "";
  if (summary && !/^</.test(summary) && !isNoiseProgressText(summary)) {
    return clip(summary, maxLen);
  }
  return "";
}
