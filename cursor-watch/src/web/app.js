import {
  loadPrefs,
  saveAttentionColumns,
  clampAttentionColumns,
  effectiveAttentionColumns,
  MIN_ATTENTION_COLUMNS,
  MAX_ATTENTION_COLUMNS,
} from "./prefs.js";
import {
  attentionCardLines,
  sortAttentionSessions,
  filterRunningSessions,
} from "./group-sessions.js";
import {
  formatActionLine,
  formatStatusSentence,
  pickReadableMessages,
} from "./drawer-format.js";
import {
  fetchRemindersPayload,
  hrefWithoutDeepLinkConversationId,
  inboxViewModel,
  parseDeepLinkConversationId,
  reminderAckPath,
  shouldClearDeepLinkQuery,
} from "./inbox.js";
import {
  buildFolderTree,
  entryDisplayTitle,
  entriesInFolder,
  folderSelectOptions,
  foldersForMark,
  loadLibraryTab,
  saveLibraryTab,
} from "./library.js";
import { displayWorkspacePlace, collectKnownWorkspacePaths } from "./workspace-display.js";
import { renderMarkdown } from "./markdown.js";

function pathBasename(filePath) {
  const s = String(filePath || "").replace(/\\/g, "/");
  const parts = s.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : s;
}

const listEl = document.getElementById("list");
const countsEl = document.getElementById("counts");
const drawerEl = document.getElementById("drawer");
const toastEl = document.getElementById("toast");
const inboxBodyEl = document.getElementById("inboxBody");
const inboxCountEl = document.getElementById("inboxCount");
const ackAllBtn = document.getElementById("ackAllBtn");
const soundToggleEl = document.getElementById("soundToggle");

let prefs = loadPrefs();
let latestSessions = [];
let latestReminders = [];
let latestLibrary = { folders: [], entries: [] };
let hooksInstalled = true;
let selectedConversationId = null;
let notificationSound = false;
/** @type {Record<string, string>} */
let workspaceAliases = {};
/** @type {"phosphor"|"blueprint"|"ink"|"brass"} */
let uiTheme = "blueprint";
const UI_THEMES = ["phosphor", "blueprint", "ink", "brass"];
/** Theme shown while settings dialog is open (restore on cancel). */
let settingsThemeBaseline = null;
let resizeTimer = null;
let deepLinkHandled = false;
let ackAllInFlight = false;
/** @type {"reminder"|"todo"|"archive"} */
let activeTab = "reminder";
/** @type {{ todo: string|null, archive: string|null }} */
let libraryFolderFilter = { todo: null, archive: null };
let markDialogContext = null;

let toastTimer = null;
/** conversationIds awaiting WS open-chat-result after Phase-1 opened */
const pendingOpenChats = new Set();

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  requestAnimationFrame(() => {
    toastEl.dataset.open = "true";
  });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.dataset.open = "false";
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 200);
  }, 2200);
}

function workspacePathLeaf(absPath) {
  const p = String(absPath || "").replace(/\/+$/, "");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) || p : p;
}

async function openInCursor(session) {
  const conversationId = session?.id;
  const workspacePath = session?.workspacePath;
  if (!conversationId || !workspacePath) {
    showToast("缺少会话或工程路径");
    return;
  }
  pendingOpenChats.add(conversationId);
  try {
    const res = await fetch("/api/open-chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, workspacePath }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      showToast(
        data.stage === "opened"
          ? "已打开 Cursor，正在定位 Chat"
          : "已在 Cursor 中打开对应 Chat",
      );
      return;
    }
    pendingOpenChats.delete(conversationId);
    if (data.stage === "workspace") {
      showToast(data.error || "打开工程失败");
    } else if (data.stage === "focus") {
      showToast(data.error || "未能定位到 Chat（工程可能已打开）");
    } else {
      showToast(data.error || `打开失败 (${res.status})`);
    }
  } catch (err) {
    pendingOpenChats.delete(conversationId);
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
  const colsValue = document.getElementById("colsValue");
  if (colsValue) {
    colsValue.textContent = String(prefs.attentionColumns);
  }
  applyAttentionCols();
}

function applyAttentionCols() {
  const cols = effectiveAttentionColumns(prefs.attentionColumns, window.innerWidth);
  const css = String(cols);
  if (listEl) listEl.style.setProperty("--attention-cols", css);
  if (inboxBodyEl) inboxBodyEl.style.setProperty("--attention-cols", css);
}

/**
 * @param {object} s
 * @param {{ showPathBar?: boolean, onAck?: (() => void) | null, selected?: boolean }} [opts]
 */
function mountCard(s, { showPathBar = false, onAck = null, selected = false } = {}) {
  const card = document.createElement("div");
  card.className = `card attention ${s.status || "idle"}`;
  if (selected) card.classList.add("is-selected");
  card.tabIndex = 0;
  const lines = attentionCardLines(s);
  const banner = completionBanner(s);
  const openBtn = s.workspacePath
    ? `<button type="button" class="open-cursor" title="在 Cursor 中打开对应 Chat">↗</button>`
    : "";
  const markBtn = s.id
    ? `<button type="button" class="library-mark-btn" title="标为 Todo / Archive">馆藏</button>`
    : "";
  const liveBit = s.live
    ? `<span class="live-inline">LIVE</span> ${escapeHtml(s.liveHint || lines.subtitle)}`
    : escapeHtml(lines.subtitle);
  const place = displayWorkspacePlace(
    lines.workspacePath,
    lines.workspaceLabel,
    workspaceAliases,
  );
  const aliased = Boolean(
    lines.workspacePath &&
      workspaceAliases[lines.workspacePath] &&
      String(workspaceAliases[lines.workspacePath]).trim(),
  );
  const dir =
    showPathBar && place.text && place.text !== "—"
      ? `<div class="workspace-path${aliased ? " is-aliased" : ""}" title="${escapeHtml(place.titlePath || place.text)}">${escapeHtml(place.text)}</div>`
      : "";
  const ackRow = onAck
    ? `<div class="card-actions"><button type="button" class="inbox-ack">确认</button>${markBtn}</div>`
    : markBtn
      ? `<div class="card-actions">${markBtn}</div>`
      : "";
  card.innerHTML = `
    <div class="summary-row">
      <div class="summary">${STATUS_ICON[s.status] ?? ""} ${escapeHtml(lines.title)} · ${formatDuration(lines.ageMs)}</div>
      ${openBtn}
    </div>
    ${liveBit ? `<div class="action">${liveBit}</div>` : ""}
    ${dir}
    ${banner ? `<div class="completion">${escapeHtml(banner)}</div>` : ""}
    ${ackRow}
  `;
  card.classList.toggle("is-live", Boolean(s.live));
  const openMain = () => openDrawer(s);
  card.addEventListener("click", (ev) => {
    if (
      ev.target.closest(".open-cursor") ||
      ev.target.closest(".inbox-ack") ||
      ev.target.closest(".library-mark-btn")
    ) {
      return;
    }
    openMain();
  });
  card.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      if (
        ev.target.closest(".open-cursor") ||
        ev.target.closest(".inbox-ack") ||
        ev.target.closest(".library-mark-btn")
      ) {
        return;
      }
      ev.preventDefault();
      openMain();
    }
  });
  const ob = card.querySelector(".open-cursor");
  if (ob) {
    ob.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void openInCursor(s);
    });
  }
  const ackBtn = card.querySelector(".inbox-ack");
  if (ackBtn && onAck) {
    ackBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onAck();
    });
  }
  const markEl = card.querySelector(".library-mark-btn");
  if (markEl) {
    markEl.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openMarkDialog({
        conversationId: s.id,
        workspacePath: s.workspacePath,
        workspaceLabel: s.workspaceLabel,
        projectKey: s.projectKey,
        chatName: s.chatName,
        transcriptPath: s.transcriptPath,
        title: sessionTitle(s),
      });
    });
  }
  return card;
}

function renderRunning(sessions) {
  listEl.className = "list-attention";
  applyAttentionCols();
  const running = sortAttentionSessions(filterRunningSessions(sessions));
  if (!running.length) {
    listEl.innerHTML = `<p class="empty-state">暂无运行中的会话</p>`;
    return;
  }
  for (const s of running) {
    listEl.appendChild(mountCard(s, { showPathBar: true }));
  }
}

function render(sessions) {
  latestSessions = sessions || [];
  const counts = { waiting: 0, running: 0, subagent: 0, idle: 0, error: 0 };
  for (const s of latestSessions) counts[s.status] = (counts[s.status] ?? 0) + 1;
  countsEl.innerHTML = [
    ["running", counts.running, "运行中"],
    ["waiting", counts.waiting, "等待"],
    ["subagent", counts.subagent, "子任务"],
    ["idle", counts.idle, "空闲"],
    ["error", counts.error, "错误"],
  ]
    .map(([key, n, label]) => {
      const hot = Number(n) > 0 ? " is-hot" : "";
      return `<span class="count-led ${key}${hot}" title="${label}"><i></i>${n}</span>`;
    })
    .join("");

  listEl.innerHTML = "";
  renderRunning(latestSessions);
  syncChrome();
  // Re-render inbox so reminder cards pick up fresh session fields.
  renderInbox(latestReminders);
}

function reminderAsSession(r) {
  const existing = findSession(r.conversationId);
  if (existing) {
    return {
      ...existing,
      chatName: existing.chatName || r.chatName,
      summary: r.summary || existing.summary,
      liveHint: r.summary || existing.liveHint,
      turnEnded: true,
      lastActivityAt: r.turnedEndedAt || existing.lastActivityAt,
    };
  }
  return {
    id: r.conversationId,
    chatName: r.chatName || "",
    summary: r.summary || "",
    workspacePath: r.workspacePath || "",
    workspaceLabel: r.workspaceLabel || "",
    status: "idle",
    lastActivityAt: r.turnedEndedAt || Date.now(),
    turnEnded: true,
    hasUnread: false,
    live: false,
  };
}

function syncAckAllBtn(model) {
  if (!ackAllBtn) return;
  const show = model.mode === "list" && model.reminders.length > 0;
  ackAllBtn.hidden = !show;
  ackAllBtn.disabled = ackAllInFlight;
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
  syncAckAllBtn(model);

  inboxBodyEl.innerHTML = "";
  inboxBodyEl.className = "inbox-body list-attention";
  applyAttentionCols();

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
    const session = reminderAsSession(r);
    inboxBodyEl.appendChild(
      mountCard(session, {
        showPathBar: true,
        selected: selectedConversationId === r.conversationId,
        onAck: () => {
          void ackReminder(r.conversationId);
        },
      }),
    );
  }
}

function findSession(conversationId) {
  return latestSessions.find((s) => s.id === conversationId) || null;
}

function selectConversation(conversationId) {
  selectedConversationId = conversationId || null;
  renderInbox(latestReminders);
  const session = findSession(conversationId);
  if (session) openDrawer(session);
  else {
    const r = latestReminders.find((x) => x.conversationId === conversationId);
    if (r) openDrawer(reminderAsSession(r));
  }
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

async function ackAllReminders() {
  if (ackAllInFlight) return;
  const ids = latestReminders.map((r) => r.conversationId).filter(Boolean);
  if (!ids.length) return;
  ackAllInFlight = true;
  syncAckAllBtn(inboxViewModel({ reminders: latestReminders, hooksInstalled }));
  try {
    const settled = await Promise.all(
      ids.map(async (conversationId) => {
        try {
          const res = await fetch(reminderAckPath(conversationId), {
            method: "POST",
          });
          const data = await res.json().catch(() => ({}));
          return res.ok && data.ok ? conversationId : null;
        } catch {
          return null;
        }
      }),
    );
    const acked = new Set(settled.filter(Boolean));
    latestReminders = latestReminders.filter(
      (r) => !acked.has(r.conversationId),
    );
    if (selectedConversationId && acked.has(selectedConversationId)) {
      selectedConversationId = null;
    }
    renderInbox(latestReminders);
    const ok = acked.size;
    if (ok === ids.length) showToast(`已确认 ${ok} 条`);
    else if (ok > 0) showToast(`已确认 ${ok}/${ids.length} 条`);
    else showToast("全部确认失败");
  } finally {
    ackAllInFlight = false;
    syncAckAllBtn(inboxViewModel({ reminders: latestReminders, hooksInstalled }));
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

/** @type {Set<string>} */
let settingsDeletedPaths = new Set();

function normalizeUiTheme(raw) {
  return UI_THEMES.includes(raw) ? raw : "blueprint";
}

function applyUiTheme(theme) {
  const next = normalizeUiTheme(theme);
  document.documentElement.dataset.theme = next;
  return next;
}

function readSettingsThemeChoice() {
  const checked = document.querySelector(
    '#settingsThemeGrid input[name="uiTheme"]:checked',
  );
  return normalizeUiTheme(checked?.value || uiTheme);
}

function syncSettingsThemeRadios(theme) {
  const t = normalizeUiTheme(theme);
  for (const input of document.querySelectorAll(
    '#settingsThemeGrid input[name="uiTheme"]',
  )) {
    input.checked = input.value === t;
  }
}

function bindPanelSettings() {
  const btn = document.getElementById("settingsBtn");
  const dialog = document.getElementById("panelSettingsDialog");
  const form = document.getElementById("panelSettingsForm");
  const cancel = document.getElementById("settingsCancel");
  const themeGrid = document.getElementById("settingsThemeGrid");
  if (!btn || !dialog || !form) return;

  const syncExpanded = () => {
    btn.setAttribute("aria-expanded", dialog.open ? "true" : "false");
  };
  dialog.addEventListener("close", () => {
    if (settingsThemeBaseline != null) {
      applyUiTheme(settingsThemeBaseline);
      settingsThemeBaseline = null;
    }
    syncExpanded();
  });
  btn.addEventListener("click", () => {
    openPanelSettings();
  });
  cancel?.addEventListener("click", () => {
    dialog.close();
  });
  themeGrid?.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t instanceof HTMLInputElement && t.name === "uiTheme" && t.checked) {
      applyUiTheme(t.value);
    }
  });
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void savePanelSettings();
  });
}

function openPanelSettings() {
  const dialog = document.getElementById("panelSettingsDialog");
  const listEl = document.getElementById("settingsAliasList");
  const emptyEl = document.getElementById("settingsAliasEmpty");
  const btn = document.getElementById("settingsBtn");
  if (!dialog || !listEl) return;

  settingsDeletedPaths = new Set();
  settingsThemeBaseline = uiTheme;
  syncSettingsThemeRadios(uiTheme);
  applyUiTheme(uiTheme);

  const paths = collectKnownWorkspacePaths({
    sessions: latestSessions,
    reminders: latestReminders,
    libraryEntries: latestLibrary.entries || [],
    aliases: workspaceAliases,
  });

  listEl.innerHTML = "";
  if (emptyEl) emptyEl.hidden = paths.length > 0;

  /** @type {HTMLInputElement|null} */
  let focusInput = null;

  for (const pathKey of paths) {
    const row = document.createElement("div");
    row.className = "settings-alias-row";
    row.dataset.path = pathKey;
    const hasAlias = Boolean(workspaceAliases[pathKey]);
    const leaf = workspacePathLeaf(pathKey);
    const nick = workspaceAliases[pathKey] || "";
    row.innerHTML = `
      <div class="settings-alias-id">
        <span class="settings-alias-name" title="${escapeHtml(pathKey)}">${escapeHtml(leaf)}</span>
        <code class="settings-alias-path" title="${escapeHtml(pathKey)}">${escapeHtml(pathKey)}</code>
      </div>
      <div class="settings-alias-edit">
        <input type="text" maxlength="80" autocomplete="off" aria-label="${escapeHtml(leaf)} 的别名"
          value="${escapeHtml(nick)}"
          placeholder="起个短名" />
        <button type="button" class="settings-alias-delete" ${hasAlias ? "" : "disabled"}>删除</button>
      </div>
    `;
    const input = row.querySelector("input");
    const del = row.querySelector(".settings-alias-delete");
    const syncDeleteAfford = () => {
      const pending = settingsDeletedPaths.has(pathKey);
      row.classList.toggle("is-pending-delete", pending);
      if (del) {
        del.disabled = pending ? true : !(input?.value.trim() || workspaceAliases[pathKey]);
      }
    };
    input?.addEventListener("input", () => {
      settingsDeletedPaths.delete(pathKey);
      syncDeleteAfford();
    });
    del?.addEventListener("click", () => {
      settingsDeletedPaths.add(pathKey);
      if (input) {
        input.value = "";
        input.placeholder = "保存后恢复全路径";
      }
      syncDeleteAfford();
    });
    if (!focusInput && !nick) focusInput = input;
    listEl.appendChild(row);
  }

  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  btn?.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    (focusInput || listEl.querySelector("input"))?.focus();
  });
}

async function savePanelSettings() {
  const dialog = document.getElementById("panelSettingsDialog");
  const listEl = document.getElementById("settingsAliasList");
  const saveBtn = document.getElementById("settingsSave");
  if (!listEl) return;

  /** @type {Record<string, string>} */
  const next = {};
  for (const row of listEl.querySelectorAll(".settings-alias-row")) {
    const pathKey = row.getAttribute("data-path") || "";
    if (!pathKey) continue;
    if (settingsDeletedPaths.has(pathKey)) continue;
    const input = row.querySelector("input");
    const nick = (input?.value || "").trim();
    if (nick) {
      next[pathKey] = nick;
      continue;
    }
    if (workspaceAliases[pathKey]) {
      showToast("昵称不能为空；要去掉请点删除");
      row.classList.remove("is-pending-delete");
      input?.focus();
      return;
    }
  }

  const nextTheme = readSettingsThemeChoice();

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "保存中…";
  }
  try {
    const res = await fetch("/api/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceAliases: next, uiTheme: nextTheme }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || `保存失败 (${res.status})`);
      return;
    }
    workspaceAliases =
      data.workspaceAliases && typeof data.workspaceAliases === "object"
        ? data.workspaceAliases
        : next;
    uiTheme = normalizeUiTheme(data.uiTheme ?? nextTheme);
    applyUiTheme(uiTheme);
    settingsThemeBaseline = null;
    if (typeof data.notificationSound === "boolean") {
      notificationSound = data.notificationSound;
      syncSoundToggle();
    }
    refreshWorkspaceDisplays();
    showToast("设置已保存");
    dialog?.close();
  } catch (err) {
    showToast(err instanceof Error ? err.message : "保存失败");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "保存";
    }
  }
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
    if (data.workspaceAliases && typeof data.workspaceAliases === "object") {
      workspaceAliases = data.workspaceAliases;
    }
    if (data.uiTheme != null) {
      uiTheme = normalizeUiTheme(data.uiTheme);
      applyUiTheme(uiTheme);
    }
    syncSoundToggle();
  } catch (err) {
    showToast(err instanceof Error ? err.message : "保存失败");
    syncSoundToggle();
  }
}

function bindViewControls() {
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
      render(latestSessions);
    }, 100);
  });

  if (ackAllBtn) {
    ackAllBtn.addEventListener("click", () => void ackAllReminders());
  }
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
    ? `<button type="button" class="drawer-open-cursor" id="drawerOpenCursor">在 Cursor 中打开对应 Chat</button>`
    : "";

  const place = displayWorkspacePlace(s.workspacePath, s.workspaceLabel, workspaceAliases);
  drawerEl.innerHTML = `
    <header>
      <strong>${escapeHtml(title)}</strong>
      <button type="button" id="closeDrawer">关闭</button>
    </header>
    <p class="drawer-status">${escapeHtml(statusLine)}</p>
    <p class="drawer-meta"><span class="label">工程</span> <span title="${escapeHtml(place.titlePath)}">${escapeHtml(place.text)}</span></p>
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
    openCursorBtn.onclick = () => void openInCursor(s);
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

let shellFullscreen = false;

function hasNativeShell() {
  return Boolean(window.webkit?.messageHandlers?.cursorWatch);
}

function isFullscreen() {
  if (hasNativeShell()) return shellFullscreen;
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
  if (hasNativeShell()) {
    try {
      window.webkit.messageHandlers.cursorWatch.postMessage({
        type: "toggleFullscreen",
      });
    } catch (err) {
      console.error("[cursor-watch] native fullscreen failed", err);
    }
    return;
  }
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
  window.__cwSetFullscreen = (on) => {
    shellFullscreen = Boolean(on);
    syncFullscreenBtn();
  };
  if (hasNativeShell()) {
    try {
      window.webkit.messageHandlers.cursorWatch.postMessage({
        type: "queryFullscreen",
      });
    } catch {
      /* ignore */
    }
  }
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
    workspaceAliases =
      data.workspaceAliases && typeof data.workspaceAliases === "object"
        ? data.workspaceAliases
        : {};
    uiTheme = normalizeUiTheme(data.uiTheme);
  } catch {
    notificationSound = false;
    workspaceAliases = {};
    uiTheme = "blueprint";
  }
  applyUiTheme(uiTheme);
  syncSoundToggle();
  refreshWorkspaceDisplays();
}

function refreshWorkspaceDisplays() {
  renderInbox(latestReminders);
  render(latestSessions);
  if (activeTab === "todo" || activeTab === "archive") {
    renderLibraryPane(activeTab);
  }
}

function setActiveTab(tab) {
  activeTab = tab === "todo" || tab === "archive" ? tab : "reminder";
  saveLibraryTab(activeTab);
  for (const btn of document.querySelectorAll(".library-tabs [role='tab']")) {
    const t = btn.getAttribute("data-tab");
    btn.setAttribute("aria-selected", t === activeTab ? "true" : "false");
  }
  for (const pane of document.querySelectorAll("[data-pane]")) {
    const show = pane.getAttribute("data-pane") === activeTab;
    pane.hidden = !show;
  }
  if (activeTab === "todo" || activeTab === "archive") {
    renderLibraryPane(activeTab);
  }
}

function bindTabs() {
  for (const btn of document.querySelectorAll(".library-tabs [role='tab']")) {
    btn.addEventListener("click", () => {
      setActiveTab(btn.getAttribute("data-tab") || "reminder");
    });
  }
}

function fillFolderSelect(selectEl, mark, selectedId) {
  if (!selectEl) return;
  const opts = folderSelectOptions(latestLibrary.folders || [], mark);
  selectEl.innerHTML =
    `<option value="">未归组</option>` +
    opts.map((o) => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.label)}</option>`).join("");
  selectEl.value = selectedId || "";
}

function openMarkDialog(ctx) {
  const dialog = document.getElementById("libraryMarkDialog");
  const markSelect = document.getElementById("libraryMarkSelect");
  const titleInput = document.getElementById("libraryTitleInput");
  const noteInput = document.getElementById("libraryNoteInput");
  const folderSelect = document.getElementById("libraryFolderSelect");
  const convInput = document.getElementById("libraryConvId");
  if (!dialog || !markSelect || !titleInput || !noteInput || !folderSelect || !convInput) return;

  markDialogContext = ctx;
  const existing = (latestLibrary.entries || []).find(
    (e) => e.conversationId === ctx.conversationId,
  );
  markSelect.value = existing?.mark || "todo";
  titleInput.value = existing?.title || ctx.title || "";
  noteInput.value = existing?.note || "";
  convInput.value = ctx.conversationId;
  fillFolderSelect(folderSelect, markSelect.value, existing?.folderId || "");
  markSelect.onchange = () => fillFolderSelect(folderSelect, markSelect.value, "");
  if (typeof dialog.showModal === "function") dialog.showModal();
}

function bindMarkDialog() {
  const form = document.getElementById("libraryMarkForm");
  const dialog = document.getElementById("libraryMarkDialog");
  const saveBtn = document.getElementById("libraryMarkSave");
  if (!form || !dialog || !saveBtn) return;

  form.addEventListener("submit", (ev) => {
    const submitter = ev.submitter;
    if (submitter && submitter.value === "cancel") {
      markDialogContext = null;
      return;
    }
    ev.preventDefault();
    void submitMarkDialog();
  });
}

async function submitMarkDialog() {
  const dialog = document.getElementById("libraryMarkDialog");
  const markSelect = document.getElementById("libraryMarkSelect");
  const titleInput = document.getElementById("libraryTitleInput");
  const noteInput = document.getElementById("libraryNoteInput");
  const folderSelect = document.getElementById("libraryFolderSelect");
  const ctx = markDialogContext;
  if (!ctx || !markSelect) return;

  const payload = {
    conversationId: ctx.conversationId,
    mark: markSelect.value,
    title: titleInput?.value || "",
    note: noteInput?.value || "",
    folderId: folderSelect?.value ? folderSelect.value : null,
    workspacePath: ctx.workspacePath,
    workspaceLabel: ctx.workspaceLabel,
    projectKey: ctx.projectKey,
    chatName: ctx.chatName,
    transcriptPath: ctx.transcriptPath,
  };

  try {
    const res = await fetch("/api/library/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || `标注失败 (${res.status})`);
      return;
    }
    showToast(payload.mark === "archive" ? "已归档" : "已标为代办");
    markDialogContext = null;
    if (dialog?.open) dialog.close();
    // Stay on Reminder tab by design
  } catch (err) {
    showToast(err instanceof Error ? err.message : "标注失败");
  }
}

function closeLibraryFolderMenus(except) {
  for (const el of document.querySelectorAll(".library-folder-more.is-open")) {
    if (except && el === except) continue;
    el.classList.remove("is-open");
    const menu = el.querySelector(".library-folder-menu");
    if (menu) menu.hidden = true;
  }
}

function bindLibraryFolderMenu(moreWrap, mark, folder) {
  const btn = moreWrap.querySelector(".library-folder-more-btn");
  const menu = moreWrap.querySelector(".library-folder-menu");
  if (!btn || !menu) return;
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const open = moreWrap.classList.contains("is-open");
    closeLibraryFolderMenus();
    if (!open) {
      moreWrap.classList.add("is-open");
      menu.hidden = false;
    }
  });
  menu.querySelector('[data-folder-act="add-child"]')?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    closeLibraryFolderMenus();
    void createLibraryFolder(mark, folder.id);
  });
  menu.querySelector('[data-folder-act="rename"]')?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    closeLibraryFolderMenus();
    void renameLibraryFolder(mark, folder.id);
  });
  menu.querySelector('[data-folder-act="delete"]')?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    closeLibraryFolderMenus();
    void deleteLibraryFolder(mark, folder.id);
  });
}

function renderLibraryPane(mark) {
  const treeEl = document.getElementById(mark === "todo" ? "todoTree" : "archiveTree");
  const listElLib = document.getElementById(mark === "todo" ? "todoList" : "archiveList");
  const stageHead = document.getElementById(mark === "todo" ? "todoStageHead" : "archiveStageHead");
  if (!treeEl || !listElLib) return;

  const selectedFolder = libraryFolderFilter[mark];
  const folders = foldersForMark(latestLibrary.folders || [], mark);
  const tree = buildFolderTree(folders);
  const selectedName =
    selectedFolder == null
      ? "未归组"
      : folders.find((f) => f.id === selectedFolder)?.name || "文件夹";
  if (stageHead) {
    stageHead.innerHTML = `<strong>${escapeHtml(selectedName)}</strong>`;
  }

  function renderNodes(nodes) {
    return nodes
      .map((n) => {
        const sel = selectedFolder === n.folder.id ? " is-selected" : "";
        return `<div class="library-folder-node">
          <div class="library-folder-row">
            <button type="button" class="library-folder-btn${sel}" data-folder-id="${escapeHtml(n.folder.id)}">${escapeHtml(n.folder.name)}</button>
            <div class="library-folder-more" data-folder-id="${escapeHtml(n.folder.id)}">
              <button type="button" class="library-folder-more-btn" aria-label="文件夹操作" title="文件夹操作">
                <svg class="library-folder-more-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <circle cx="8" cy="3.5" r="1.35"/>
                  <circle cx="8" cy="8" r="1.35"/>
                  <circle cx="8" cy="12.5" r="1.35"/>
                </svg>
              </button>
              <div class="library-folder-menu" hidden>
                <button type="button" data-folder-act="add-child">新建子文件夹</button>
                <button type="button" data-folder-act="rename">重命名</button>
                <button type="button" data-folder-act="delete" class="is-danger">删除</button>
              </div>
            </div>
          </div>
          <div class="library-folder-children">${renderNodes(n.children)}</div>
        </div>`;
      })
      .join("");
  }

  treeEl.innerHTML = `
    <div class="library-tree-toolbar">
      <button type="button" class="library-add-root" data-action="add-root" title="新建根文件夹" aria-label="新建根文件夹">+</button>
    </div>
    <div class="library-unfiled-row">
      <button type="button" class="library-unfiled-btn${selectedFolder == null ? " is-selected" : ""}" data-folder-id="">未归组</button>
    </div>
    ${renderNodes(tree)}
  `;

  treeEl.querySelector('[data-action="add-root"]')?.addEventListener("click", () => {
    void createLibraryFolder(mark, null);
  });

  treeEl.querySelectorAll(".library-folder-btn, .library-unfiled-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-folder-id");
      libraryFolderFilter[mark] = id ? id : null;
      closeLibraryFolderMenus();
      renderLibraryPane(mark);
    });
  });

  treeEl.querySelectorAll(".library-folder-more").forEach((wrap) => {
    const id = wrap.getAttribute("data-folder-id");
    const folder = folders.find((f) => f.id === id);
    if (folder) bindLibraryFolderMenu(wrap, mark, folder);
  });

  const entries = entriesInFolder(
    latestLibrary.entries || [],
    mark,
    selectedFolder,
    folders,
  );
  if (!entries.length) {
    listElLib.innerHTML = `<div class="library-empty"><strong>这里还没有条目</strong>在 Reminder 列表点「馆藏」标注；点左上角 + 建根文件夹，悬停目录右侧三点可建子文件夹。</div>`;
    return;
  }

  listElLib.innerHTML = "";
  for (const entry of entries) {
    const card = document.createElement("article");
    card.className = `library-entry${entry.stale ? " is-stale" : ""}`;
    const title = entryDisplayTitle(entry);
    const placeInfo = displayWorkspacePlace(
      entry.workspacePath,
      entry.workspaceLabel,
      workspaceAliases,
    );
    const entryFolder =
      entry.folderId && entry.folderId !== selectedFolder
        ? folders.find((f) => f.id === entry.folderId)
        : null;
    const folderHint = entryFolder ? ` · ${entryFolder.name}` : "";
    const place = `${placeInfo.text}${folderHint}`;
    const attachmentViews = Array.isArray(entry.attachmentViews)
      ? entry.attachmentViews
      : (entry.attachments || []).map((p) => ({ path: p, available: true }));
    const attachmentsHtml = `
      <div class="library-attachments">
        <div class="library-attachments-head">
          <span>附件 MD</span>
          <button type="button" data-act="attach-add">+ 绑定</button>
        </div>
        ${
          attachmentViews.length
            ? `<ul class="library-attachment-list">${attachmentViews
                .map(
                  (a) => `
              <li class="library-attachment-row${a.available ? "" : " is-unavailable"}" data-path="${escapeHtml(a.path)}" title="${escapeHtml(a.path)}">
                <span class="library-attachment-name">${escapeHtml(pathBasename(a.path))}${
                    a.available ? "" : `<em class="library-attachment-stale">不可用</em>`
                  }</span>
                <span class="library-attachment-actions">
                  <button type="button" data-act="attach-preview">预览</button>
                  <button type="button" data-act="attach-reveal">Finder</button>
                  <button type="button" data-act="attach-remove">解绑</button>
                </span>
              </li>`,
                )
                .join("")}</ul>`
            : `<p class="library-attachments-empty">尚未绑定本地 .md</p>`
        }
      </div>`;
    card.innerHTML = `
      <div class="library-entry-title">${escapeHtml(title)}${
        entry.stale ? `<span class="library-stale-badge">源会话不可用</span>` : ""
      }</div>
      <div class="library-entry-meta" title="${escapeHtml(placeInfo.titlePath)}">${escapeHtml(place.trim() || "—")}</div>
      ${entry.note ? `<div class="library-entry-note">${escapeHtml(entry.note)}</div>` : ""}
      ${attachmentsHtml}
      <div class="library-entry-actions">
        <button type="button" data-act="edit">编辑</button>
        <button type="button" data-act="move">移动</button>
        <button type="button" data-act="flip">${mark === "todo" ? "归档" : "改代办"}</button>
        <button type="button" data-act="unmark">取消标注</button>
        <button type="button" data-act="open" title="在 Cursor 打开" ${entry.workspacePath ? "" : "disabled"}>↗</button>
      </div>
    `;
    card.querySelector('[data-act="edit"]')?.addEventListener("click", () => {
      openMarkDialog({
        conversationId: entry.conversationId,
        workspacePath: entry.workspacePath,
        workspaceLabel: entry.workspaceLabel,
        projectKey: entry.projectKey,
        chatName: entry.chatName,
        transcriptPath: entry.transcriptPath,
        title: entry.title || entry.chatName || "",
      });
    });
    card.querySelector('[data-act="move"]')?.addEventListener("click", () => {
      void moveLibraryEntry(entry, mark);
    });
    card.querySelector('[data-act="flip"]')?.addEventListener("click", () => {
      void patchLibraryEntry(entry.conversationId, {
        mark: mark === "todo" ? "archive" : "todo",
      });
    });
    card.querySelector('[data-act="unmark"]')?.addEventListener("click", () => {
      void unmarkLibraryEntry(entry.conversationId);
    });
    card.querySelector('[data-act="open"]')?.addEventListener("click", () => {
      void openInCursor({
        id: entry.conversationId,
        workspacePath: entry.workspacePath,
      });
    });
    card.querySelector('[data-act="attach-add"]')?.addEventListener("click", () => {
      void addLibraryAttachments(entry.conversationId);
    });
    for (const row of card.querySelectorAll(".library-attachment-row")) {
      const filePath = row.getAttribute("data-path") || "";
      row.querySelector('[data-act="attach-preview"]')?.addEventListener("click", () => {
        void openAttachmentPreview(entry.conversationId, filePath);
      });
      row.querySelector('[data-act="attach-reveal"]')?.addEventListener("click", () => {
        void revealLibraryAttachment(entry.conversationId, filePath);
      });
      row.querySelector('[data-act="attach-remove"]')?.addEventListener("click", () => {
        void removeLibraryAttachment(entry.conversationId, filePath);
      });
    }
    listElLib.appendChild(card);
  }
}

/**
 * WKWebView often ignores window.prompt/confirm — use an in-panel dialog instead.
 * @param {{
 *   title: string,
 *   hint?: string,
 *   mode?: "text"|"confirm"|"select",
 *   label?: string,
 *   defaultValue?: string,
 *   okLabel?: string,
 *   options?: Array<{ id: string, label: string }>,
 * }} opts
 * @returns {Promise<string|null>}
 */
function openLibraryPrompt(opts) {
  const dialog = document.getElementById("libraryPromptDialog");
  const form = document.getElementById("libraryPromptForm");
  const titleEl = document.getElementById("libraryPromptTitle");
  const hintEl = document.getElementById("libraryPromptHint");
  const textLabel = document.getElementById("libraryPromptTextLabel");
  const textCaption = document.getElementById("libraryPromptTextCaption");
  const textInput = document.getElementById("libraryPromptText");
  const selectLabel = document.getElementById("libraryPromptSelectLabel");
  const selectCaption = document.getElementById("libraryPromptSelectCaption");
  const selectEl = document.getElementById("libraryPromptSelect");
  const cancelBtn = document.getElementById("libraryPromptCancel");
  const okBtn = document.getElementById("libraryPromptOk");
  if (!dialog || !form || !textInput || !selectEl || !cancelBtn || !okBtn) {
    return Promise.resolve(null);
  }

  const mode = opts.mode || "text";
  titleEl.textContent = opts.title || "输入";
  if (opts.hint) {
    hintEl.hidden = false;
    hintEl.textContent = opts.hint;
  } else {
    hintEl.hidden = true;
    hintEl.textContent = "";
  }
  okBtn.textContent = opts.okLabel || (mode === "confirm" ? "确认" : "确定");

  const showText = mode === "text";
  const showSelect = mode === "select";
  textLabel.hidden = !showText;
  textLabel.style.display = showText ? "" : "none";
  selectLabel.hidden = !showSelect;
  selectLabel.style.display = showSelect ? "" : "none";

  if (showSelect) {
    selectCaption.textContent = opts.label || "文件夹";
    selectEl.innerHTML = (opts.options || [])
      .map(
        (o) =>
          `<option value="${escapeHtml(o.id)}">${escapeHtml(o.label)}</option>`,
      )
      .join("");
    selectEl.value = opts.defaultValue ?? (opts.options?.[0]?.id ?? "");
  } else if (showText) {
    textCaption.textContent = opts.label || "名称";
    textInput.value = opts.defaultValue || "";
  } else {
    textInput.value = "";
  }

  return new Promise((resolve) => {
    const finish = (value) => {
      form.removeEventListener("submit", onSubmit);
      cancelBtn.removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onCancel = (ev) => {
      ev.preventDefault();
      finish(null);
    };
    const onSubmit = (ev) => {
      ev.preventDefault();
      if (mode === "confirm") {
        finish("ok");
        return;
      }
      if (mode === "select") {
        finish(selectEl.value);
        return;
      }
      const v = textInput.value.trim();
      if (!v) {
        textInput.focus();
        return;
      }
      finish(v);
    };
    form.addEventListener("submit", onSubmit);
    cancelBtn.addEventListener("click", onCancel);
    dialog.addEventListener("cancel", onCancel);
    if (typeof dialog.showModal === "function") dialog.showModal();
    if (mode === "text") {
      queueMicrotask(() => {
        textInput.focus();
        textInput.select();
      });
    }
  });
}

async function createLibraryFolder(mark, parentId = null) {
  const name = await openLibraryPrompt({
    title: parentId ? "新建子文件夹" : "新建根文件夹",
    label: "名称",
    hint: parentId ? "创建在当前目录下" : "创建在根级",
    defaultValue: "",
    okLabel: "创建",
  });
  if (!name) return;
  try {
    const res = await fetch("/api/library/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mark, name, parentId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || "创建失败");
      return;
    }
    showToast("已创建文件夹");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "创建失败");
  }
}

async function renameLibraryFolder(mark, folderId) {
  const id = folderId || libraryFolderFilter[mark];
  if (!id) {
    showToast("请先选中文件夹");
    return;
  }
  const folder = (latestLibrary.folders || []).find((f) => f.id === id);
  const name = await openLibraryPrompt({
    title: "重命名文件夹",
    label: "新名称",
    defaultValue: folder?.name || "",
    okLabel: "保存",
  });
  if (!name) return;
  try {
    const res = await fetch(`/api/library/folders/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) showToast(data.error || "重命名失败");
    else showToast("已重命名");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "重命名失败");
  }
}

async function deleteLibraryFolder(mark, folderId) {
  const id = folderId || libraryFolderFilter[mark];
  if (!id) {
    showToast("请先选中文件夹");
    return;
  }
  const folder = (latestLibrary.folders || []).find((f) => f.id === id);
  const ok = await openLibraryPrompt({
    title: "删除文件夹",
    mode: "confirm",
    hint: `删除「${folder?.name || "文件夹"}」后，子文件夹与其中的条目会上移到上一级。此操作不可撤销。`,
    okLabel: "删除",
  });
  if (!ok) return;
  try {
    const res = await fetch(`/api/library/folders/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || "删除失败");
      return;
    }
    if (libraryFolderFilter[mark] === id) libraryFolderFilter[mark] = null;
    showToast("已删除文件夹");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "删除失败");
  }
}

async function moveLibraryEntry(entry, mark) {
  const opts = folderSelectOptions(latestLibrary.folders || [], mark);
  const options = [{ id: "", label: "未归组" }, ...opts];
  const picked = await openLibraryPrompt({
    title: "移动到文件夹",
    mode: "select",
    label: "目标",
    options,
    defaultValue: entry.folderId || "",
    okLabel: "移动",
  });
  if (picked == null) return;
  await patchLibraryEntry(entry.conversationId, {
    folderId: picked === "" ? null : picked,
  });
}

async function patchLibraryEntry(conversationId, patch) {
  try {
    const res = await fetch(`/api/library/entries/${encodeURIComponent(conversationId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) showToast(data.error || "更新失败");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "更新失败");
  }
}

/**
 * @returns {Promise<string[]>}
 */
function pickMarkdownPaths() {
  if (hasNativeShell()) {
    return new Promise((resolve) => {
      const prev = window.__cwPickedMarkdown;
      window.__cwPickedMarkdown = (paths) => {
        window.__cwPickedMarkdown = prev;
        resolve(Array.isArray(paths) ? paths.filter((p) => typeof p === "string") : []);
      };
      try {
        window.webkit.messageHandlers.cursorWatch.postMessage({
          type: "pickMarkdownFiles",
        });
      } catch (err) {
        window.__cwPickedMarkdown = prev;
        console.error("[cursor-watch] pickMarkdownFiles failed", err);
        resolve([]);
      }
    });
  }
  return openLibraryPrompt({
    title: "绑定 Markdown",
    hint: "粘贴本机绝对路径，多个路径用换行分隔（App 内请用系统选文件）。",
    label: "路径",
    defaultValue: "",
    okLabel: "绑定",
  }).then((raw) => {
    if (!raw) return [];
    return String(raw)
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  });
}

async function addLibraryAttachments(conversationId) {
  const paths = await pickMarkdownPaths();
  if (!paths.length) return;
  try {
    const res = await fetch(
      `/api/library/entries/${encodeURIComponent(conversationId)}/attachments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paths }),
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || "绑定失败");
      return;
    }
    const rejected = Array.isArray(data.rejected) ? data.rejected : [];
    const added = Array.isArray(data.added) ? data.added : [];
    if (rejected.length && !added.length) {
      showToast(rejected[0]?.reason || "未能绑定");
    } else if (rejected.length) {
      showToast(`已绑定 ${added.length} 个；${rejected.length} 个被拒绝`);
    } else if (added.length) {
      showToast(`已绑定 ${added.length} 个附件`);
    } else {
      showToast("已在列表中");
    }
  } catch (err) {
    showToast(err instanceof Error ? err.message : "绑定失败");
  }
}

async function removeLibraryAttachment(conversationId, filePath) {
  try {
    const res = await fetch(
      `/api/library/entries/${encodeURIComponent(conversationId)}/attachments`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || "解绑失败");
    }
  } catch (err) {
    showToast(err instanceof Error ? err.message : "解绑失败");
  }
}

async function revealLibraryAttachment(conversationId, filePath) {
  try {
    const res = await fetch(
      `/api/library/entries/${encodeURIComponent(conversationId)}/attachments/reveal`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) showToast(data.error || "无法在 Finder 中显示");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "无法在 Finder 中显示");
  }
}

async function openAttachmentPreview(conversationId, filePath) {
  const dialog = document.getElementById("attachmentPreviewDialog");
  const titleEl = document.getElementById("attachmentPreviewTitle");
  const pathEl = document.getElementById("attachmentPreviewPath");
  const bodyEl = document.getElementById("attachmentPreviewBody");
  if (!dialog || !bodyEl) return;
  if (titleEl) titleEl.textContent = pathBasename(filePath) || "预览";
  if (pathEl) pathEl.textContent = filePath;
  bodyEl.innerHTML = `<p class="attachment-preview-loading">加载中…</p>`;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  try {
    const res = await fetch(
      `/api/library/entries/${encodeURIComponent(conversationId)}/attachments/preview?path=${encodeURIComponent(filePath)}`,
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      bodyEl.innerHTML = `<p class="attachment-preview-error">${escapeHtml(data.error || "无法读取附件")}</p>`;
      return;
    }
    bodyEl.innerHTML = renderMarkdown(data.content || "");
  } catch (err) {
    bodyEl.innerHTML = `<p class="attachment-preview-error">${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`;
  }
}

async function unmarkLibraryEntry(conversationId) {
  const ok = await openLibraryPrompt({
    title: "取消标注",
    mode: "confirm",
    hint: "取消后标题、备注与附件会丢弃，条目从 Todo / Archive 中移除。",
    okLabel: "取消标注",
  });
  if (!ok) return;
  try {
    const res = await fetch(`/api/library/entries/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || "取消失败");
    } else {
      showToast("已取消标注");
    }
  } catch (err) {
    showToast(err instanceof Error ? err.message : "取消失败");
  }
}

function applyLibrarySnapshot(payload) {
  latestLibrary = payload && typeof payload === "object"
    ? {
        folders: Array.isArray(payload.folders) ? payload.folders : [],
        entries: Array.isArray(payload.entries) ? payload.entries : [],
      }
    : { folders: [], entries: [] };
  if (activeTab === "todo" || activeTab === "archive") {
    renderLibraryPane(activeTab);
  }
}

async function fetchLibrary() {
  try {
    const res = await fetch("/api/library");
    applyLibrarySnapshot(await res.json());
  } catch {
    applyLibrarySnapshot({ folders: [], entries: [] });
  }
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
    } else if (msg.type === "library") {
      applyLibrarySnapshot(msg.payload);
    } else if (msg.type === "open-chat-result") {
      const p = msg.payload || {};
      const id = typeof p.conversationId === "string" ? p.conversationId : "";
      if (id && !pendingOpenChats.has(id)) return;
      if (id) pendingOpenChats.delete(id);
      if (p.ok) {
        showToast("已定位到对应 Chat");
      } else {
        showToast(p.error || "已打开工程，未能定位 Chat");
      }
    }
  };
  ws.onclose = () => {
    setTimeout(() => {
      void fetchSessions().catch(() => {});
      void fetchReminders().catch(() => {});
      void fetchLibrary().catch(() => {});
      connectWs();
    }, 1000);
  };
}

async function boot() {
  bindFullscreen();
  bindViewControls();
  bindSoundToggle();
  bindPanelSettings();
  bindTabs();
  bindMarkDialog();
  document.addEventListener("click", (ev) => {
    if (!ev.target.closest(".library-folder-more")) closeLibraryFolderMenus();
  });
  syncChrome();
  setActiveTab(loadLibraryTab());
  await Promise.all([
    fetchSessions(),
    fetchHooksStatus(),
    fetchDaemonPrefs(),
    fetchReminders(),
    fetchLibrary(),
  ]);
  await handleDeepLink();
  connectWs();
}

boot();
