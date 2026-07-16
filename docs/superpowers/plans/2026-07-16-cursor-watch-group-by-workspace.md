# cursor-watch 按工作区分组展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在态势面板上将扁平会话列表改为按工作区分区展示（不可折叠），组头带路径与状态摘要，组内会话卡不再重复工程路径。

**Architecture:** API 仍返回扁平 `SessionState[]`。新增纯函数 `groupSessionsForUi` 负责分组键、组内/组间排序与组头摘要；`app.js` 调用后渲染 section + 精简卡片；样式新增 `.workspace-group` / `.group-header`。不改 daemon/scanner/API。

**Tech Stack:** 现有 Vitest + 零构建静态 `src/web/*.js`（ESM）；测试用 `tests/group-sessions.test.ts` import 纯函数。

## Global Constraints

- Spec：`docs/superpowers/specs/2026-07-16-cursor-watch-group-by-workspace-design.md`
- 分组键：`workspacePath`（非空）→ 否则 `workspaceLabel` → 否则 `projectKey`
- 组头文案：优先 `workspaceLabel`，空则回退分组键
- 组内排序：waiting → error → running/subagent → idle；waiting 按 `waitingSince ?? lastActivityAt` 升序；其余 `lastActivityAt` 降序
- 组排序：按组内最紧急会话的状态（及同级时间 tie-break）
- 顶栏计数：仍按会话粒度，分组不改变计数
- 单会话工程：仍显示组头；分区**不可折叠**
- 仅前端；不改 API / daemon / scanner / aggregator / 抽屉字段语义
- 提交：英文 conventional commits + `Co-Authored-By: Cursor <zhangchengk@yonyou.com>`
- 工作目录：仓库根下 `cursor-watch/`

## File Structure

```
cursor-watch/
├── src/web/
│   ├── group-sessions.js   # NEW: groupSessionsForUi 纯函数
│   ├── app.js              # MODIFY: 分组渲染；卡片去路径
│   ├── styles.css          # MODIFY: 分区/组头样式；列表改为纵向分区
│   └── index.html          # 不变（除非需无改）
└── tests/
    └── group-sessions.test.ts  # NEW
```

---

### Task 1: groupSessionsForUi 纯函数 + 单测

**Files:**
- Create: `cursor-watch/src/web/group-sessions.js`
- Create: `cursor-watch/tests/group-sessions.test.ts`

**Interfaces:**
- Consumes: 扁平 session 对象（字段与 `SessionState` 一致，至少含 `id`, `status`, `workspacePath`, `workspaceLabel`, `projectKey`, `lastActivityAt`, `waitingSince?`）
- Produces:
  - `groupKey(session): string`
  - `groupSessionsForUi(sessions: SessionLike[]): WorkspaceGroup[]`
  - `WorkspaceGroup`: `{ key: string; label: string; sessions: SessionLike[]; statusCounts: Record<string, number> }`

- [ ] **Step 1: Write the failing test**

`tests/group-sessions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupSessionsForUi } from "../src/web/group-sessions.js";

function sess(
  over: Partial<{
    id: string;
    status: string;
    workspacePath: string;
    workspaceLabel: string;
    projectKey: string;
    lastActivityAt: number;
    waitingSince?: number;
  }> & { id: string; status: string },
) {
  return {
    workspacePath: "",
    workspaceLabel: "",
    projectKey: "p",
    lastActivityAt: 1000,
    summary: "s",
    currentAction: "a",
    subagentCount: 0,
    subagentRunning: 0,
    transcriptPath: "/t",
    recentMessages: [],
    ...over,
  };
}

describe("groupSessionsForUi", () => {
  it("groups by workspacePath then sorts groups by urgency", () => {
    const groups = groupSessionsForUi([
      sess({
        id: "r1",
        status: "running",
        workspacePath: "/Users/u/idea/A",
        workspaceLabel: "idea/A",
        lastActivityAt: 5000,
      }),
      sess({
        id: "w1",
        status: "waiting",
        workspacePath: "/Users/u/idea/B",
        workspaceLabel: "idea/B",
        lastActivityAt: 4000,
        waitingSince: 3000,
      }),
      sess({
        id: "r2",
        status: "running",
        workspacePath: "/Users/u/idea/B",
        workspaceLabel: "idea/B",
        lastActivityAt: 4500,
      }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["idea/B", "idea/A"]);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["w1", "r2"]);
    expect(groups[0].statusCounts).toEqual({ waiting: 1, running: 1 });
    expect(groups[1].sessions).toHaveLength(1);
  });

  it("falls back key path → label → projectKey; always emits group header data for singleton", () => {
    const groups = groupSessionsForUi([
      sess({ id: "1", status: "idle", projectKey: "OnlyKey", lastActivityAt: 1 }),
      sess({
        id: "2",
        status: "idle",
        workspaceLabel: "idea/L",
        projectKey: "x",
        lastActivityAt: 2,
      }),
    ]);
    expect(groups).toHaveLength(2);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
    expect(byKey["OnlyKey"].label).toBe("OnlyKey");
    expect(byKey["idea/L"].label).toBe("idea/L");
    expect(byKey["OnlyKey"].sessions).toHaveLength(1);
  });

  it("prefers workspacePath as key over label", () => {
    const groups = groupSessionsForUi([
      sess({
        id: "a",
        status: "running",
        workspacePath: "/abs/one",
        workspaceLabel: "same-label",
        lastActivityAt: 1,
      }),
      sess({
        id: "b",
        status: "running",
        workspacePath: "/abs/two",
        workspaceLabel: "same-label",
        lastActivityAt: 2,
      }),
    ]);
    expect(groups).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd cursor-watch && npm test -- tests/group-sessions.test.ts
```

Expected: FAIL — cannot find module `../src/web/group-sessions.js`

- [ ] **Step 3: Write minimal implementation**

`src/web/group-sessions.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd cursor-watch && npm test -- tests/group-sessions.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Run full suite**

```bash
cd cursor-watch && npm test
```

Expected: all existing + new tests PASS

- [ ] **Step 6: Commit**

```bash
git add cursor-watch/src/web/group-sessions.js cursor-watch/tests/group-sessions.test.ts
git commit -m "$(cat <<'EOF'
feat: add groupSessionsForUi for workspace sections

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 2: 面板渲染分区 + 样式

**Files:**
- Modify: `cursor-watch/src/web/app.js`
- Modify: `cursor-watch/src/web/styles.css`

**Interfaces:**
- Consumes: `groupSessionsForUi`, `formatStatusSummary` from `./group-sessions.js`
- Produces: DOM 结构 `#list > .workspace-group > .group-header + .group-sessions > .card`

- [ ] **Step 1: Update app.js render**

Replace `render` in `src/web/app.js` so it:

1. 保持顶栏按会话计数（现有 counts 循环不变）
2. `const groups = groupSessionsForUi(sessions)`
3. 对每个 group：创建 `.workspace-group`，内含 `.group-header` 与 `.group-sessions`
4. 组头文本：`${label} · ${n} 会话 · ${formatStatusSummary(statusCounts)}`（summary 为空则省略最后一段）
5. 组内卡片：**不要** `.title` 里的 workspaceLabel，**不要** `.path`；title 行为：`${STATUS_ICON} ${currentAction 可缩短或不放 title}` — 按 spec：状态色标在左边框已有，卡片内容为 action·时长 + summary。用：

```js
card.innerHTML = `
  <div class="title">${STATUS_ICON[s.status] ?? ""} ${escapeHtml(s.currentAction)}</div>
  <div class="action">${formatDuration(Date.now() - ageBase)}</div>
  <div class="summary">${escapeHtml(s.summary)}</div>
`;
```

或更贴近示意「状态 + 动作 · 时长」一行：

```js
card.innerHTML = `
  <div class="action">${STATUS_ICON[s.status] ?? ""} ${escapeHtml(s.currentAction)} · ${formatDuration(Date.now() - ageBase)}</div>
  <div class="summary">${escapeHtml(s.summary)}</div>
`;
```

采用**后者**（更贴 spec 示意）。

6. `import { groupSessionsForUi, formatStatusSummary } from "./group-sessions.js";` 放在文件顶部（浏览器 type=module 已支持）

7. `openDrawer` **保持不变**（仍展示完整 path）

完整替换后的 `render` 函数：

```js
import { formatStatusSummary, groupSessionsForUi } from "./group-sessions.js";

// ... keep STATUS_ICON, formatDuration, escapeHtml, openDrawer, boot ...

function render(sessions) {
  const counts = { waiting: 0, running: 0, subagent: 0, idle: 0, error: 0 };
  for (const s of sessions) counts[s.status] = (counts[s.status] ?? 0) + 1;
  countsEl.textContent = `🟢${counts.running} 🟡${counts.waiting} 🔵${counts.subagent} ⚪${counts.idle} 🔴${counts.error}`;

  listEl.innerHTML = "";
  const groups = groupSessionsForUi(sessions);
  for (const g of groups) {
    const section = document.createElement("section");
    section.className = "workspace-group";

    const header = document.createElement("div");
    header.className = "group-header";
    const summary = formatStatusSummary(g.statusCounts);
    header.textContent = summary
      ? `${g.label} · ${g.sessions.length} 会话 · ${summary}`
      : `${g.label} · ${g.sessions.length} 会话`;
    section.appendChild(header);

    const body = document.createElement("div");
    body.className = "group-sessions";
    for (const s of g.sessions) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `card ${s.status}`;
      const ageBase =
        s.status === "waiting" ? s.waitingSince ?? s.lastActivityAt : s.lastActivityAt;
      card.innerHTML = `
        <div class="action">${STATUS_ICON[s.status] ?? ""} ${escapeHtml(s.currentAction)} · ${formatDuration(Date.now() - ageBase)}</div>
        <div class="summary">${escapeHtml(s.summary)}</div>
      `;
      card.addEventListener("click", () => openDrawer(s));
      body.appendChild(card);
    }
    section.appendChild(body);
    listEl.appendChild(section);
  }
}
```

**注意：** 将 `import` 置于 `app.js` 最顶部；其余函数顺序可保留。若当前 `app.js` 无 import，整文件改为以 import 开头。

- [ ] **Step 2: Update styles.css**

将 `#list` 从多列 card grid 改为纵向分区；新增组样式：

```css
#list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0.75rem 1rem 2rem;
}

.workspace-group {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.group-header {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.02em;
  padding: 0.15rem 0.15rem 0.35rem;
  border-bottom: 1px solid var(--border);
  word-break: break-all;
}

.group-sessions {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.6rem;
}

/* .card .path 可保留规则但不再使用；或删除 .card .path / .card .title 若不再引用 */
```

删除或保留未用的 `.card .title` / `.card .path`：若 `app.js` 不再输出这些 class，删除对应 CSS 规则以免死代码。

- [ ] **Step 3: Manual smoke**

```bash
cd cursor-watch
npx cursor-watch stop 2>/dev/null || true
npx cursor-watch open
```

在浏览器打开 `http://127.0.0.1:7423/`（等首扫完成后）：

- 同工程多会话落在同一 `workspace-group`
- 组头含「N 会话」与状态摘要
- 卡片无重复工程路径
- 顶栏数字 = 会话总数
- 单会话工程仍有组头
- 点击卡片抽屉仍显示完整路径

- [ ] **Step 4: Run full suite again**

```bash
cd cursor-watch && npm test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/web/app.js cursor-watch/src/web/styles.css
git commit -m "$(cat <<'EOF'
feat: render session panel grouped by workspace

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 3: README 一句说明（可选但建议）

**Files:**
- Modify: `cursor-watch/README.md`

**Interfaces:**
- Consumes: 无
- Produces: 文档说明面板按工作区分区

- [ ] **Step 1: Add a short UI note under 使用 or 新小节「面板」**

在 README「使用」后追加：

```markdown
## 面板

会话按工作区（工程路径）分区展示；顶栏计数仍按会话条数。组头显示路径、会话数与状态摘要。
```

- [ ] **Step 2: Commit**

```bash
git add cursor-watch/README.md
git commit -m "$(cat <<'EOF'
docs: note workspace-grouped panel layout

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

## Self-Review

| Spec 项 | Task |
|---------|------|
| 按 workspace 分组键链 | Task 1 |
| 组内/组间紧急排序 | Task 1 |
| 不可折叠分区 + 单会话也有组头 | Task 2 |
| 组头文案与状态摘要 | Task 1 `formatStatusSummary` + Task 2 |
| 卡片去路径 | Task 2 |
| 顶栏仍按会话 | Task 2（counts 循环未改） |
| 仅前端 / API 不变 | 全计划无 server 改动 |
| 抽屉仍完整 path | Task 2 明确不改 `openDrawer` |

无 TBD/TODO 占位；函数名前后一致（`groupSessionsForUi` / `formatStatusSummary`）。
