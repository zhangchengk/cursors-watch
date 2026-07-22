import { attentionCardLines, sortAttentionSessions } from "./group-sessions.js";
import {
  formatActionLine,
  formatStatusSentence,
  pickReadableMessages,
} from "./drawer-format.js";

const listEl = document.getElementById("list");
const countsEl = document.getElementById("counts");
const drawerEl = document.getElementById("drawer");
const toastEl = document.getElementById("toast");

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

function render(sessions) {
  const counts = { waiting: 0, running: 0, subagent: 0, idle: 0, error: 0 };
  for (const s of sessions) counts[s.status] = (counts[s.status] ?? 0) + 1;
  countsEl.textContent = `🟢${counts.running} 🟡${counts.waiting} 🔵${counts.subagent} ⚪${counts.idle} 🔴${counts.error}`;

  listEl.innerHTML = "";
  if (!sessions.length) {
    listEl.innerHTML = `<p class="empty-state">暂无需要关注的会话</p>`;
    return;
  }
  const ordered = sortAttentionSessions(sessions);
  for (const s of ordered) {
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
    const dir = lines.workspaceDir
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
    listEl.appendChild(card);
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

function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "sessions") render(msg.payload);
  };
  ws.onclose = () => {
    // Daemon restarts drop the socket; without reconnect the UI freezes on the
    // last frame even while /api/sessions stays fresh.
    setTimeout(() => {
      void fetchSessions().catch(() => {});
      connectWs();
    }, 1000);
  };
}

async function boot() {
  bindFullscreen();
  await fetchSessions();
  connectWs();
}

boot();
