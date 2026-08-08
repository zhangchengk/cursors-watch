/**
 * Pure helpers for reminder inbox + deep-link boot (tested via vitest).
 */

/**
 * @param {string | URLSearchParams | { get?: (k: string) => string | null } | null | undefined} search
 * @returns {string | null}
 */
export function parseDeepLinkConversationId(search) {
  if (search == null || search === "") return null;

  let params;
  if (typeof search === "string") {
    const q = search.startsWith("?") ? search.slice(1) : search;
    params = new URLSearchParams(q);
  } else if (typeof search.get === "function") {
    params = search;
  } else {
    return null;
  }

  const raw = params.get("conversationId");
  if (raw == null) return null;
  const id = String(raw).trim();
  return id || null;
}

/**
 * @param {string} conversationId
 * @returns {string}
 */
export function reminderAckPath(conversationId) {
  return `/api/reminders/${encodeURIComponent(conversationId)}/ack`;
}

/**
 * Deep-link `conversationId` may be stripped only after a successful ack so reload can retry.
 * @param {boolean} ackOk
 * @returns {boolean}
 */
export function shouldClearDeepLinkQuery(ackOk) {
  return Boolean(ackOk);
}

/**
 * Build pathname + search + hash with `conversationId` removed (for history.replaceState).
 * @param {string} href
 * @returns {string}
 */
export function hrefWithoutDeepLinkConversationId(href) {
  const url = new URL(href, "http://cursor-watch.local");
  url.searchParams.delete("conversationId");
  return url.pathname + url.search + url.hash;
}

/**
 * Load pending reminders for boot; never throws — empty on failure so deep-link/WS still run.
 * @param {() => Promise<Response>} fetchReminders
 * @returns {Promise<object[]>}
 */
export async function fetchRemindersPayload(fetchReminders) {
  try {
    const res = await fetchReminders();
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * @param {{ conversationId?: string, chatName?: string, summary?: string }} r
 * @returns {string}
 */
export function reminderDisplayTitle(r) {
  const name = typeof r.chatName === "string" ? r.chatName.trim() : "";
  if (name) return name;
  const summary = typeof r.summary === "string" ? r.summary.trim() : "";
  if (summary) return summary;
  return String(r.conversationId || "").trim();
}

/**
 * @param {{ workspaceLabel?: string }} r
 * @returns {string}
 */
export function reminderDisplayMeta(r) {
  return typeof r.workspaceLabel === "string" ? r.workspaceLabel.trim() : "";
}

/**
 * @param {number} turnedEndedAt
 * @param {number} [now]
 * @returns {string}
 */
export function formatReminderEndedAt(turnedEndedAt, now = Date.now()) {
  const t = Number(turnedEndedAt);
  if (!Number.isFinite(t)) return "—";
  const age = Math.max(0, Math.floor((Number(now) - t) / 1000));
  if (age < 60) return `${age}s 前`;
  const mins = Math.floor(age / 60);
  if (mins < 60) return `${mins}min 前`;
  try {
    return new Date(t).toLocaleString();
  } catch {
    return String(t);
  }
}

/**
 * @template {{ turnedEndedAt: number }} T
 * @param {T[]} reminders
 * @returns {T[]}
 */
export function sortInboxReminders(reminders) {
  return [...(reminders || [])].sort((a, b) => Number(b.turnedEndedAt) - Number(a.turnedEndedAt));
}

/**
 * @param {{ reminders?: Array<object>, hooksInstalled: boolean }} input
 * @returns {{
 *   mode: 'hooks-cta' | 'empty' | 'list',
 *   reminders: Array<object>,
 *   emptyHint: string | null,
 *   hooksCommand: string | null,
 * }}
 */
export function inboxViewModel({ reminders, hooksInstalled }) {
  if (!hooksInstalled) {
    return {
      mode: "hooks-cta",
      reminders: [],
      emptyHint: "未安装 hooks，Reminder 管线未启用",
      hooksCommand: "cursor-watch hooks install",
    };
  }

  const pending = sortInboxReminders(reminders || []);
  if (!pending.length) {
    return {
      mode: "empty",
      reminders: [],
      emptyHint: "暂无待确认 Reminder",
      hooksCommand: null,
    };
  }

  return {
    mode: "list",
    reminders: pending,
    emptyHint: null,
    hooksCommand: null,
  };
}

/**
 * True when mounted inbox cards match pending Reminder order (same ids, same sequence).
 * Used to decide in-place surface refresh vs full rebuild.
 * @param {string[]} reminderIds
 * @param {string[]} mountedCardIds
 * @returns {boolean}
 */
export function sameConversationOrder(reminderIds, mountedCardIds) {
  const a = reminderIds || [];
  const b = mountedCardIds || [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Resolve inbox delegated click: explicit Reminder acknowledgment or library mark entry.
 * @param {EventTarget | null | undefined} target
 * @param {ParentNode | null | undefined} root
 * @returns {{ action: "ack" | "mark", conversationId: string } | null}
 */
export function resolveInboxCardAction(target, root) {
  if (!target || !root || typeof target.closest !== "function") return null;
  /** @type {Element} */
  const el = /** @type {Element} */ (target);

  const ack = el.closest(".inbox-ack");
  if (ack && root.contains(ack)) {
    const host = ack.closest("[data-conversation-id]");
    const id = host?.getAttribute("data-conversation-id")?.trim();
    return id ? { action: "ack", conversationId: id } : null;
  }

  const mark = el.closest(".library-mark-btn");
  if (mark && root.contains(mark)) {
    const host = mark.closest("[data-conversation-id]");
    const id = host?.getAttribute("data-conversation-id")?.trim();
    return id ? { action: "mark", conversationId: id } : null;
  }

  return null;
}
