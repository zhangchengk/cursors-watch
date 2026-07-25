import {
  loadPrefs,
  saveViewMode,
  saveAttentionColumns,
  clampAttentionColumns,
  effectiveAttentionColumns,
  MIN_ATTENTION_COLUMNS,
  MAX_ATTENTION_COLUMNS,
} from "./prefs.js";
import {
  attentionCardLines,
  sortAttentionSessions,
  groupSessionsForUi,
  formatStatusSummary,
} from "./group-sessions.js";
import {
  formatActionLine,
  formatStatusSentence,
  pickReadableMessages,
} from "./drawer-format.js";
import {
  fetchRemindersPayload,
  formatReminderEndedAt,
  hrefWithoutDeepLinkConversationId,
  inboxViewModel,
  parseDeepLinkConversationId,
  reminderAckPath,
  reminderDisplayMeta,
  reminderDisplayTitle,
  shouldClearDeepLinkQuery,
} from "./inbox.js";

const listEl = document.getElementById("list");
const countsEl = document.getElementById("counts");
const drawerEl = document.getElementById("drawer");
const toastEl = document.getElementById("toast");
const inboxBodyEl = document.getElementById("inboxBody");
const inboxCountEl = document.getElementById("inboxCount");
const soundToggleEl = document.getElementById("soundToggle");

let prefs = loadPrefs();
let latestSessions = [];
let latestReminders = [];
let hooksInstalled = true;
let selectedConversationId = null;
let notificationSound = false;
let resizeTimer = null;
let deepLinkHandled = false;

let toastTimer = null;
function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2800);
}

async function openInCursor(workspacePath) {
  try {
    const res = await fetch("/api/open-workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: workspacePath }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      showToast(data.error || `打开失败 (${res.status})`);
      return;
    }
    showToast("已请求在 Cursor 中打开");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "打开失败");
  }
}

const STATUS_ICON = {
  waiting: "🟡",
  running: "🟢",
  subagent: "🔵",
  idle: "⚪",
  error: "🔴",
};

function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  return `${Math.floor(m / 60)}h${m % 60}min`;
}

function sessionTitle(s) {
  const name = typeof s.chatName === "string" ? s.chatName.trim() : "";
  return name || s.summary || "";
}

function completionBanner(s) {
  if (s.hasUnread) return "有未读 · 请查看";
  if (s.turnEnded) return "本轮结束";
  return "";
}

function syncChrome() {
  const modeAttention = document.getElementById("modeAttention");
  const modeWorkspace = document.getElementById("modeWorkspace");
  if (modeAttention) {
    modeAttention.classList.toggle("active", prefs.viewMode === "attention");
  }
  if (modeWorkspace) {
    modeWorkspace.classList.toggle("active", prefs.viewMode === "workspace");
  }
  const colsControl = document.getElementById("colsControl");
  if (colsControl) {
    colsControl.hidden = prefs.viewMode !== "attention";
  }
  const colsValue = document.getElementById("colsValue");
  if (colsValue) {
    colsValue.textContent = String(prefs.attentionColumns);
  }
}

function mountCard(s, { showPathBar = false } = {}) {
  const card = document.createElement("div");
  card.className = `card attention ${s.status}`;
  card.tabIndex = 0;
  const lines = attentionCardLines(s);
  const banner = completionBanner(s);
  const openBtn = s.workspacePath
    ? `<button type="button" class="open-cursor" title="在 Cursor 中打开工程">↗</button>`
    : "";
  const liveBit = s.live
    ? `<span class="live-inline">LIVE</span> ${escapeHtml(s.liveHint || lines.subtitle)}`
    : escapeHtml(lines.subtitle);
  const dir =
    showPathBar && lines.workspaceDir
      ? `<div class="workspace-path" title="${escapeHtml(lines.workspacePath || lines.workspaceDir)}">${escapeHtml(lines.workspaceDir)}</div>`
      : "";
  card.innerHTML = `
    <div class="summary-row">
      <div class="summary">${STATUS_ICON[s.status] ?? ""} ${escapeHtml(lines.title)} · ${formatDuration(lines.ageMs)}</div>
      ${openBtn}
    </div>
    ${liveBit ? `<div class="action">${liveBit}</div>` : ""}
    ${dir}
    ${banner ? `<div class="completion">${escapeHtml(banner)}</div>` : ""}
  `;
  card.classList.toggle("is-live", Boolean(s.live));
  const openMain = () => openDrawer(s);
  card.addEventListener("click", (ev) => {
    if (ev.target.closest(".open-cursor")) return;
    openMain();
  });
  card.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      if (ev.target.closest(".open-cursor")) return;
      ev.preventDefault();
      openMain();
    }
  });
  const ob = card.querySelector(".open-cursor");
  if (ob) {
    ob.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void openInCursor(s.workspacePath);
    });
  }
  return card;
}

function renderAttention(sessions) {
  const cols = effectiveAttentionColumns(prefs.attentionColumns, window.innerWidth);
  listEl.className = "list-attention";
  listEl.style.setProperty("--attention-cols", String(cols));
  if (!sessions.length) {
    listEl.innerHTML = `<p class="empty-state">暂无需要关注的会话</p>`;
    return;
  }
  const ordered = sortAttentionSessions(sessions);
  for (const s of ordered) {
    listEl.appendChild(mountCard(s, { showPathBar: true }));
  }
}

function renderWorkspace(sessions) {
  listEl.className = "list-workspace";
  listEl.style.removeProperty("--attention-cols");
  if (!sessions.length) {
    listEl.innerHTML = `<p class="empty-state">暂无需要关注的会话</p>`;
    return;
  }
  const groups = groupSessionsForUi(sessions);
  for (const g of groups) {
    const section = document.createElement("section");
    section.className = "workspace-group";

    const header = document.createElement("div");
    header.className = "group-header";
    const summary = formatStatusSummary(g.statusCounts);
    header.textContent = summary
      ? `${g.label} · 显示 ${g.sessions.length} / 组内 ${g.totalCount} · ${summary}`
      : `${g.label} · 显示 ${g.sessions.length} / 组内 ${g.totalCount}`;
    section.appendChild(header);

    const body = document.createElement("div");
    body.className = "group-sessions";
    for (const s of g.sessions) {
      body.appendChild(mountCard(s, { showPathBar: false }));
    }
    section.appendChild(body);
    listEl.appendChild(section);
  }
}

function render(sessions) {
  latestSessions = sessions || [];
  const counts = { waiting: 0, running: 0, subagent: 0, idle: 0, error: 0 };
  for (const s of latestSessions) counts[s.status] = (counts[s.status] ?? 0) + 1;
  countsEl.textContent = `🟢${counts.running} 🟡${counts.waiting} 🔵${counts.subagent} ⚪${counts.idle} 🔴${counts.error}`;

  listEl.innerHTML = "";
  if (prefs.viewMode === "workspace") renderWorkspace(latestSessions);
  else renderAttention(latestSessions);
  syncChrome();
}

function renderInbox(reminders) {
  latestReminders = Array.isArray(reminders) ? reminders : [];
  if (!inboxBodyEl) return;

  const model = inboxViewModel({
    reminders: latestReminders,
    hooksInstalled,
  });

  if (inboxCountEl) {
    inboxCountEl.textContent =
      model.mode === "list" ? `${model.reminders.length}` : model.mode === "hooks-cta" ? "未安装" : "";
  }

  inboxBodyEl.innerHTML = "";

  if (model.mode === "hooks-cta") {
    const cta = document.createElement("div");
    cta.className = "inbox-cta";
    cta.innerHTML = `<div>${escapeHtml(model.emptyHint || "")}</div><code>${escapeHtml(
      model.hooksCommand || "cursor-watch hooks install",
    )}</code>`;
    inboxBodyEl.appendChild(cta);
    return;
  }

  if (model.mode === "empty") {
    const empty = document.createElement("div");
    empty.className = "inbox-empty";
    empty.textContent = model.emptyHint || "暂无待确认 Reminder";
    inboxBodyEl.appendChild(empty);
    return;
  }

  for (const r of model.reminders) {
    inboxBodyEl.appendChild(mountInboxCard(r));
  }
}

function mountInboxCard(r) {
  const card = document.createElement("div");
  card.className = "inbox-card";
  card.dataset.conversationId = r.conversationId;
  if (selectedConversationId === r.conversationId) card.classList.add("is-selected");

  const title = reminderDisplayTitle(r);
  const meta = reminderDisplayMeta(r);
  const ended = formatReminderEndedAt(r.turnedEndedAt);

  const main = document.createElement("div");
  main.className = "inbox-card-main";
  main.tabIndex = 0;
  main.setAttribute("role", "button");
  main.innerHTML = `
    <p class="title">${escapeHtml(title)}</p>
    ${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ""}
    <p class="ended">${escapeHtml(ended)}</p>
  `;
  const open = () => selectConversation(r.conversationId);
  main.addEventListener("click", open);
  main.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      open();
    }
  });

  const ackBtn = document.createElement("button");
  ackBtn.type = "button";
  ackBtn.className = "inbox-ack";
  ackBtn.textContent = "确认";
  ackBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    void ackReminder(r.conversationId);
  });

  card.appendChild(main);
  card.appendChild(ackBtn);
  return card;
}

function findSession(conversationId) {
  return latestSessions.find((s) => s.id === conversationId) || null;
}

function selectConversation(conversationId) {
  selectedConversationId = conversationId || null;
  renderInbox(latestReminders);
  const session = findSession(conversationId);
  if (session) openDrawer(session);
}

async function ackReminder(conversationId) {
  if (!conversationId) return false;
  try {
    const res = await fetch(reminderAckPath(conversationId), { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      showToast(data.error || `确认失败 (${res.status})`);
      return false;
    }
    latestReminders = latestReminders.filter((r) => r.conversationId !== conversationId);
    if (selectedConversationId === conversationId) selectedConversationId = null;
    renderInbox(latestReminders);
    return true;
  } catch (err) {
    showToast(err instanceof Error ? err.message : "确认失败");
    return false;
  }
}

async function handleDeepLink() {
  if (deepLinkHandled) return;
  const id = parseDeepLinkConversationId(location.search);
  if (!id) return;
  selectConversation(id);
  const ackOk = await ackReminder(id);
  if (!shouldClearDeepLinkQuery(ackOk)) return;
  deepLinkHandled = true;
  try {
    history.replaceState({}, "", hrefWithoutDeepLinkConversationId(location.href));
  } catch {
    /* ignore */
  }
}

function syncSoundToggle() {
  if (soundToggleEl) soundToggleEl.checked = Boolean(notificationSound);
}

function bindSoundToggle() {
  if (!soundToggleEl) return;
  soundToggleEl.addEventListener("change", () => {
    void putNotificationSound(Boolean(soundToggleEl.checked));
  });
}

async function putNotificationSound(enabled) {
  try {
    const res = await fetch("/api/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notificationSound: enabled }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || `保存失败 (${res.status})`);
      syncSoundToggle();
      return;
    }
    notificationSound = Boolean(data.notificationSound);
    syncSoundToggle();
  } catch (err) {
    showToast(err instanceof Error ? err.message : "保存失败");
    syncSoundToggle();
  }
}

function bindViewControls() {
  const modeAttention = document.getElementById("modeAttention");
  const modeWorkspace = document.getElementById("modeWorkspace");
  const setMode = (mode) => {
    if (mode !== "attention" && mode !== "workspace") return;
    prefs.viewMode = mode;
    saveViewMode(mode);
    render(latestSessions);
  };
  if (modeAttention) {
    modeAttention.addEventListener("click", () => setMode("attention"));
  }
  if (modeWorkspace) {
    modeWorkspace.addEventListener("click", () => setMode("workspace"));
  }

  const colsDec = document.getElementById("colsDec");
  const colsInc = document.getElementById("colsInc");
  const bumpCols = (delta) => {
    const next = Math.min(
      MAX_ATTENTION_COLUMNS,
      Math.max(MIN_ATTENTION_COLUMNS, prefs.attentionColumns + delta),
    );
    prefs.attentionColumns = clampAttentionColumns(next);
    saveAttentionColumns(prefs.attentionColumns);
    render(latestSessions);
  };
  if (colsDec) colsDec.addEventListener("click", () => bumpCols(-1));
  if (colsInc) colsInc.addEventListener("click", () => bumpCols(1));

  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (prefs.viewMode === "attention") render(latestSessions);
    }, 100);
  });
}

function openDrawer(s) {
  drawerEl.hidden = false;
  drawerEl.classList.add("open");
  const title = sessionTitle(s);
  const statusLine = formatStatusSentence(s);
  const action = formatActionLine(s);
  const readable = pickReadableMessages(s.recentMessages, 2);
  const subN = Number(s.subagentCount) || 0;
  const subRun = Number(s.subagentRunning) || 0;
  const composerAt =
    s.composerUpdatedAt != null
      ? new Date(s.composerUpdatedAt).toISOString()
      : "—";
  const openBtn = s.workspacePath
    ? `<button type="button" class="drawer-open-cursor" id="drawerOpenCursor">在 Cursor 中打开</button>`
    : "";

  drawerEl.innerHTML = `
    <header>
      <strong>${escapeHtml(title)}</strong>
      <button type="button" id="closeDrawer">关闭</button>
    </header>
    <p class="drawer-status">${escapeHtml(statusLine)}</p>
    <p class="drawer-meta"><span class="label">工程</span> ${escapeHtml(s.workspaceLabel || "—")}</p>
    ${action ? `<p class="drawer-meta"><span class="label">当前</span> ${escapeHtml(action)}</p>` : ""}
    ${
      subN > 0
        ? `<p class="drawer-meta"><span class="label">子任务</span> ${subN} 个${subRun > 0 ? `（进行中 ${subRun}）` : ""}</p>`
        : ""
    }
    ${openBtn}
    ${
      readable.length
        ? `<div class="drawer-section"><h3>最近进展</h3><ul class="drawer-msgs">${readable
            .map(
              (m) =>
                `<li><span class="role">${m.role === "user" ? "你" : "Agent"}</span> ${escapeHtml(m.text)}</li>`,
            )
            .join("")}</ul></div>`
        : ""
    }
    <details class="drawer-tech">
      <summary>技术细节</summary>
      <p><span class="label">状态枚举</span> <code>${escapeHtml(s.status)}</code>
        · live=${s.live ? "是" : "否"}
        · turnEnded=${s.turnEnded ? "是" : "否"}
        · hasUnread=${s.hasUnread ? "是" : "否"}</p>
      <p><span class="label">路径</span> <code>${escapeHtml(s.workspacePath || "—")}</code></p>
      <p><span class="label">更新时间</span> <code>${escapeHtml(composerAt)}</code></p>
      <p><span class="label">首条消息</span> ${escapeHtml(s.summary || "—")}</p>
      <p><span class="label">Transcript</span> <code>${escapeHtml(s.transcriptPath || "—")}</code></p>
      <p><span class="label">Subagents</span> ${subN} (running ${subRun})</p>
      <h4>原始最近消息</h4>
      <ul>${(s.recentMessages || [])
        .map((m) => `<li><strong>${escapeHtml(m.role)}</strong>: ${escapeHtml(m.text)}</li>`)
        .join("")}</ul>
    </details>
  `;
  document.getElementById("closeDrawer").onclick = () => {
    drawerEl.classList.remove("open");
    drawerEl.hidden = true;
  };
  const openCursorBtn = document.getElementById("drawerOpenCursor");
  if (openCursorBtn && s.workspacePath) {
    openCursorBtn.onclick = () => void openInCursor(s.workspacePath);
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isFullscreen() {
  return Boolean(document.fullscreenElement);
}

function syncFullscreenBtn() {
  const btn = document.getElementById("fullscreenBtn");
  if (!btn) return;
  const on = isFullscreen();
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.textContent = on ? "退出全屏" : "全屏";
  btn.title = on ? "退出全屏 (Esc / F)" : "全屏 (F)";
}

async function toggleFullscreen() {
  try {
    if (isFullscreen()) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch (err) {
    console.error("[cursor-watch] fullscreen failed", err);
  }
}

function bindFullscreen() {
  const btn = document.getElementById("fullscreenBtn");
  if (btn) btn.addEventListener("click", () => void toggleFullscreen());
  document.addEventListener("fullscreenchange", syncFullscreenBtn);
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "f" && ev.key !== "F") return;
    const t = ev.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
      return;
    }
    ev.preventDefault();
    void toggleFullscreen();
  });
  syncFullscreenBtn();
}

async function fetchSessions() {
  const res = await fetch("/api/sessions");
  render(await res.json());
}

async function fetchReminders() {
  const reminders = await fetchRemindersPayload(() => fetch("/api/reminders"));
  renderInbox(reminders);
}

async function fetchHooksStatus() {
  try {
    const res = await fetch("/api/hooks-status");
    const data = await res.json();
    hooksInstalled = Boolean(data.installed);
  } catch {
    hooksInstalled = true;
  }
  renderInbox(latestReminders);
}

async function fetchDaemonPrefs() {
  try {
    const res = await fetch("/api/prefs");
    const data = await res.json();
    notificationSound = Boolean(data.notificationSound);
  } catch {
    notificationSound = false;
  }
  syncSoundToggle();
}

function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "sessions") {
      render(msg.payload);
    } else if (msg.type === "reminders") {
      renderInbox(msg.payload);
    }
  };
  ws.onclose = () => {
    // Daemon restarts drop the socket; without reconnect the UI freezes on the
    // last frame even while /api/sessions stays fresh.
    setTimeout(() => {
      void fetchSessions().catch(() => {});
      void fetchReminders().catch(() => {});
      connectWs();
    }, 1000);
  };
}

async function boot() {
  bindFullscreen();
  bindViewControls();
  bindSoundToggle();
  syncChrome();
  await Promise.all([fetchSessions(), fetchHooksStatus(), fetchDaemonPrefs(), fetchReminders()]);
  await handleDeepLink();
  connectWs();
}

boot();
