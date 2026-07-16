const listEl = document.getElementById("list");
const countsEl = document.getElementById("counts");
const drawerEl = document.getElementById("drawer");

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

function render(sessions) {
  const counts = { waiting: 0, running: 0, subagent: 0, idle: 0, error: 0 };
  for (const s of sessions) counts[s.status] = (counts[s.status] ?? 0) + 1;
  countsEl.textContent = `🟢${counts.running} 🟡${counts.waiting} 🔵${counts.subagent} ⚪${counts.idle} 🔴${counts.error}`;

  listEl.innerHTML = "";
  for (const s of sessions) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `card ${s.status}`;
    const ageBase =
      s.status === "waiting" ? s.waitingSince ?? s.lastActivityAt : s.lastActivityAt;
    const path = s.workspacePath || s.workspaceLabel;
    card.innerHTML = `
      <div class="title">${STATUS_ICON[s.status] ?? ""} ${escapeHtml(s.workspaceLabel)}</div>
      <div class="path">${escapeHtml(path)}</div>
      <div class="action">${escapeHtml(s.currentAction)} · ${formatDuration(Date.now() - ageBase)}</div>
      <div class="summary">${escapeHtml(s.summary)}</div>
    `;
    card.addEventListener("click", () => openDrawer(s));
    listEl.appendChild(card);
  }
}

function openDrawer(s) {
  drawerEl.hidden = false;
  drawerEl.classList.add("open");
  drawerEl.innerHTML = `
    <header><strong>${escapeHtml(s.workspaceLabel)}</strong>
      <button type="button" id="closeDrawer">关闭</button></header>
    <p>状态: ${STATUS_ICON[s.status]} ${s.status}</p>
    <p>路径: <code>${escapeHtml(s.workspacePath || s.workspaceLabel)}</code></p>
    <p>动作: ${escapeHtml(s.currentAction)}</p>
    <p>摘要: ${escapeHtml(s.summary)}</p>
    <p>Transcript: <code>${escapeHtml(s.transcriptPath)}</code></p>
    <p>Subagents: ${s.subagentCount} (running ${s.subagentRunning})</p>
    <h3>最近消息</h3>
    <ul>${(s.recentMessages || [])
      .map((m) => `<li><strong>${m.role}</strong>: ${escapeHtml(m.text)}</li>`)
      .join("")}</ul>
  `;
  document.getElementById("closeDrawer").onclick = () => {
    drawerEl.classList.remove("open");
    drawerEl.hidden = true;
  };
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function boot() {
  const res = await fetch("/api/sessions");
  render(await res.json());
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "sessions") render(msg.payload);
  };
}

boot();
