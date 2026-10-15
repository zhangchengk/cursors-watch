# 01 — cursor-watch Dual View Modes Implementation Plan

**What to build:** Implement the work described in `.scratch/view-modes/issues/00-spec-view-modes.md` and the checklist below.

**Blocked by:** None — can start immediately (or follow task order inside checklist).

**Status:** done

**Parent:** `.scratch/view-modes/issues/00-spec-view-modes.md`

- [ ] Acceptance: behavior matches spec and CONTEXT.md
- [ ] Tests updated or added at agreed seams

## Implementation checklist (migrated plan)

# cursor-watch Dual View Modes Implementation Plan

**Goal:** Add switchable attention (1–4 column grid + path bar) vs workspace-group views, persist prefs in localStorage, and make workspace paths visually obvious in attention mode.

**Architecture:** Pure front-end. Keep serving flat `SessionState[]` from the daemon. Add `prefs.js` for viewMode/columns. Restore `groupSessionsForUi` alongside existing `sortAttentionSessions`. `app.js` branches render on prefs; CSS handles attention grid and path-bar chrome.

**Tech Stack:** Existing Vitest + zero-build ESM under `cursor-watch/src/web/*`; `localStorage` in the browser.

## Global Constraints

- Spec: `.scratch/specs/2026-07-22-cursor-watch-view-modes-design.md`
- `cursor-watch.viewMode`: `attention` | `workspace`; default **`attention`**
- `cursor-watch.attentionColumns`: `"1"`…`"4"`; default **`"2"`**
- Attention grid columns: **1–4**; control `− N +` only when `viewMode === "attention"`
- Viewport width **&lt; 720px**: render attention as **1 column** without changing stored N
- Path bar: attention cards only; full `workspacePath || workspaceLabel`; prominent strip (bg and/or left accent)
- Workspace mode: restore old group wall — group header + vertical cards; **GROUP_TOP_N = 4** + `hasUnread || turnEnded` keep; **no** path bar on cards; **no** global column grid
- Do **not** change daemon / aggregator / prune / API
- Working directory: `cursor-watch/` for code; docs at repo root `.scratch/`
- Commits: English conventional + blank line + `Co-Authored-By: Cursor <zhangchengk@yonyou.com>`
- TDD per task; fold any uncommitted path-display WIP into Task 3 (do not leave orphan diffs)

---

## File Structure

```text
cursor-watch/
├── src/web/
│   ├── prefs.js              # NEW: load/save viewMode + attentionColumns
│   ├── group-sessions.js     # MODIFY: restore groupSessionsForUi (+ keep attention helpers)
│   ├── app.js                # MODIFY: topbar controls + dual render
│   ├── index.html            # MODIFY: mode + columns controls
│   └── styles.css            # MODIFY: path bar, attention grid, group wall
└── tests/
    ├── prefs.test.ts         # NEW
    └── group-sessions.test.ts # MODIFY: re-add group tests; keep attention tests
```

**Restore reference:** historical `groupSessionsForUi` at git `7418d71:cursor-watch/src/web/group-sessions.js` (or `83a00c7`). Copy that grouping logic back; keep current `urgencyBucket` / `sortAttentionSessions` / `attentionCardLines`.

---

### Task 1: Prefs module

**Files:**
- Create: `cursor-watch/src/web/prefs.js`
- Create: `cursor-watch/tests/prefs.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_VIEW_MODE = "attention"`
  - `DEFAULT_ATTENTION_COLUMNS = 2`
  - `MIN_ATTENTION_COLUMNS = 1`
  - `MAX_ATTENTION_COLUMNS = 4`
  - `NARROW_VIEWPORT_PX = 720`
  - `loadPrefs(storage?: StorageLike): { viewMode: "attention"|"workspace"; attentionColumns: number }`
  - `saveViewMode(mode, storage?): void`
  - `saveAttentionColumns(n, storage?): void`
  - `clampAttentionColumns(n: unknown): number`
  - `effectiveAttentionColumns(storedN: number, viewportWidth: number): number` — if `viewportWidth < 720` return `1`, else `clampAttentionColumns(storedN)`

`StorageLike`: `{ getItem(k): string|null; setItem(k,v): void }` — tests pass a memory map; browser uses `localStorage`. On storage throw / missing: return defaults, never throw to caller.

- [ ] **Step 1: Write the failing test**

`tests/prefs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  clampAttentionColumns,
  effectiveAttentionColumns,
  loadPrefs,
  saveAttentionColumns,
  saveViewMode,
} from "../src/web/prefs.js";

function memStorage(init: Record<string, string> = {}) {
  const data = { ...init };
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = String(v);
    },
    _data: data,
  };
}

describe("clampAttentionColumns", () => {
  it("clamps to 1..4 and defaults junk to 2", () => {
    expect(clampAttentionColumns(1)).toBe(1);
    expect(clampAttentionColumns(4)).toBe(4);
    expect(clampAttentionColumns(9)).toBe(2);
    expect(clampAttentionColumns("3")).toBe(3);
    expect(clampAttentionColumns("x")).toBe(2);
  });
});

describe("loadPrefs", () => {
  it("defaults when empty", () => {
    expect(loadPrefs(memStorage())).toEqual({
      viewMode: "attention",
      attentionColumns: 2,
    });
  });

  it("reads valid keys", () => {
    expect(
      loadPrefs(
        memStorage({
          "cursor-watch.viewMode": "workspace",
          "cursor-watch.attentionColumns": "3",
        }),
      ),
    ).toEqual({ viewMode: "workspace", attentionColumns: 3 });
  });

  it("rejects illegal mode/columns", () => {
    expect(
      loadPrefs(
        memStorage({
          "cursor-watch.viewMode": "nope",
          "cursor-watch.attentionColumns": "9",
        }),
      ),
    ).toEqual({ viewMode: "attention", attentionColumns: 2 });
  });
});

describe("save*", () => {
  it("writes keys", () => {
    const s = memStorage();
    saveViewMode("workspace", s);
    saveAttentionColumns(4, s);
    expect(s._data["cursor-watch.viewMode"]).toBe("workspace");
    expect(s._data["cursor-watch.attentionColumns"]).toBe("4");
  });
});

describe("effectiveAttentionColumns", () => {
  it("forces 1 under 720px without changing stored meaning", () => {
    expect(effectiveAttentionColumns(3, 719)).toBe(1);
    expect(effectiveAttentionColumns(3, 720)).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cursor-watch && npx vitest run tests/prefs.test.ts`

Expected: FAIL — module missing

- [ ] **Step 3: Minimal implementation**

`src/web/prefs.js`:

```js
export const DEFAULT_VIEW_MODE = "attention";
export const DEFAULT_ATTENTION_COLUMNS = 2;
export const MIN_ATTENTION_COLUMNS = 1;
export const MAX_ATTENTION_COLUMNS = 4;
export const NARROW_VIEWPORT_PX = 720;

const KEY_MODE = "cursor-watch.viewMode";
const KEY_COLS = "cursor-watch.attentionColumns";

function storageOrNull(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function clampAttentionColumns(n) {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return DEFAULT_ATTENTION_COLUMNS;
  const i = Math.trunc(x);
  if (i < MIN_ATTENTION_COLUMNS || i > MAX_ATTENTION_COLUMNS) {
    return DEFAULT_ATTENTION_COLUMNS;
  }
  return i;
}

export function loadPrefs(storage) {
  const s = storageOrNull(storage);
  let viewMode = DEFAULT_VIEW_MODE;
  let attentionColumns = DEFAULT_ATTENTION_COLUMNS;
  try {
    const m = s?.getItem?.(KEY_MODE);
    if (m === "attention" || m === "workspace") viewMode = m;
    const c = s?.getItem?.(KEY_COLS);
    if (c != null) attentionColumns = clampAttentionColumns(c);
  } catch {
    /* keep defaults */
  }
  return { viewMode, attentionColumns };
}

export function saveViewMode(mode, storage) {
  if (mode !== "attention" && mode !== "workspace") return;
  try {
    storageOrNull(storage)?.setItem?.(KEY_MODE, mode);
  } catch {
    /* ignore */
  }
}

export function saveAttentionColumns(n, storage) {
  const c = clampAttentionColumns(n);
  try {
    storageOrNull(storage)?.setItem?.(KEY_COLS, String(c));
  } catch {
    /* ignore */
  }
}

export function effectiveAttentionColumns(storedN, viewportWidth) {
  if (Number(viewportWidth) < NARROW_VIEWPORT_PX) return 1;
  return clampAttentionColumns(storedN);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cursor-watch && npx vitest run tests/prefs.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/web/prefs.js cursor-watch/tests/prefs.test.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): add view mode and column prefs helpers

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 2: Restore `groupSessionsForUi`

**Files:**
- Modify: `cursor-watch/src/web/group-sessions.js`
- Modify: `cursor-watch/tests/group-sessions.test.ts`

**Interfaces:**
- Keep: `urgencyBucket`, `sortAttentionSessions`, `attentionCardLines` (with `workspaceDir`)
- Restore (from `7418d71` logic):
  - `GROUP_TOP_N = 4` (module-local const is fine; no need to re-export in `constants.ts`)
  - `groupKey`, `groupLabel`, `groupSessionsForUi`, `formatStatusSummary`
- `hasReminder(s) => Boolean(s.hasUnread || s.turnEnded)`

- [ ] **Step 1: Write the failing tests**

Append to `group-sessions.test.ts` (keep existing attention tests):

```ts
import {
  groupSessionsForUi,
  formatStatusSummary,
  sortAttentionSessions,
  attentionCardLines,
} from "../src/web/group-sessions.js";

function sess(partial) {
  return {
    id: "x",
    status: "idle",
    hasUnread: false,
    turnEnded: false,
    live: false,
    lastActivityAt: 0,
    workspacePath: "/w",
    workspaceLabel: "w",
    projectKey: "p",
    ...partial,
  };
}

describe("groupSessionsForUi restored", () => {
  it("groups by workspacePath and limits to top 4 plus unread reminder", () => {
    const sessions = [];
    for (let i = 0; i < 5; i++) {
      sessions.push(
        sess({
          id: `i${i}`,
          workspacePath: "/a",
          workspaceLabel: "a",
          lastActivityAt: 100 - i,
          status: "idle",
        }),
      );
    }
    sessions.push(
      sess({
        id: "unread-old",
        workspacePath: "/a",
        workspaceLabel: "a",
        hasUnread: true,
        status: "waiting",
        lastActivityAt: 1,
      }),
    );
    const groups = groupSessionsForUi(sessions);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalCount).toBe(6);
    const ids = groups[0].sessions.map((s) => s.id);
    expect(ids).toContain("unread-old");
    expect(ids.length).toBeGreaterThanOrEqual(5);
    expect(ids.length).toBeLessThanOrEqual(6);
  });

  it("formatStatusSummary skips zero counts", () => {
    expect(formatStatusSummary({ waiting: 1, idle: 2 })).toContain("🟡1");
    expect(formatStatusSummary({ waiting: 1, idle: 2 })).toContain("⚪2");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cursor-watch && npx vitest run tests/group-sessions.test.ts`

Expected: FAIL — `groupSessionsForUi` missing

- [ ] **Step 3: Minimal implementation**

In `group-sessions.js`, **append** (do not delete attention helpers) the grouping code from `7418d71` / `83a00c7` (`GROUP_TOP_N`, `groupKey`, `groupLabel`, `hasReminder`, `cardBucket`, `cmpCard`, `limitGroupSessions`, `recountStatuses`, `groupSessionsForUi`, `formatStatusSummary`). Share one `activityAt` helper (already present).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cursor-watch && npx vitest run tests/group-sessions.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/web/group-sessions.js cursor-watch/tests/group-sessions.test.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): restore workspace groupSessionsForUi helper

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 3: Path bar styles (attention only)

**Files:**
- Modify: `cursor-watch/src/web/styles.css`
- Modify: `cursor-watch/src/web/app.js` (ensure attention cards use `.workspace-path` strip; workspace cards do not)
- Include any uncommitted `attentionCardLines` / path WIP already in the tree

**Interfaces:**
- CSS class `.workspace-path` = path strip with background + left border accent
- Attention render includes the strip; workspace-group card template omits it

- [ ] **Step 1: Assert helper still prefers absolute path**

Already covered by existing `attentionCardLines` tests — re-run:

Run: `cd cursor-watch && npx vitest run tests/group-sessions.test.ts -t attentionCardLines`

Expected: PASS (if red, fix `workspaceDir` first)

- [ ] **Step 2: Update CSS for prominent strip**

Replace/extend `.workspace-path` in `styles.css`:

```css
.workspace-path {
  margin-top: 0.35rem;
  padding: 0.28rem 0.45rem;
  border-left: 3px solid var(--accent, #5b9fd4);
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.06);
  opacity: 1;
  font-size: 0.78em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  word-break: break-all;
  line-height: 1.35;
  color: var(--text, #e6e6e6);
}
```

- [ ] **Step 3: Confirm app.js attention card markup**

Attention cards must include (already partially present — finish if needed):

```js
const dir = lines.workspaceDir
  ? `<div class="workspace-path" title="${escapeHtml(lines.workspacePath || lines.workspaceDir)}">${escapeHtml(lines.workspaceDir)}</div>`
  : "";
```

Do **not** add this in the upcoming workspace-group card HTML (Task 4).

- [ ] **Step 4: Run unit tests**

Run: `cd cursor-watch && npx vitest run tests/group-sessions.test.ts tests/prefs.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/web/styles.css cursor-watch/src/web/app.js cursor-watch/src/web/group-sessions.js cursor-watch/tests/group-sessions.test.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): emphasize workspace path bar on attention cards

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 4: Dual render + topbar controls

**Files:**
- Modify: `cursor-watch/src/web/index.html`
- Modify: `cursor-watch/src/web/app.js`
- Modify: `cursor-watch/src/web/styles.css`

**Interfaces:**
- Consumes: `loadPrefs`, `saveViewMode`, `saveAttentionColumns`, `effectiveAttentionColumns` from `./prefs.js`
- Consumes: `sortAttentionSessions`, `attentionCardLines`, `groupSessionsForUi`, `formatStatusSummary` from `./group-sessions.js`
- `#list` gets class `list-attention` or `list-workspace`
- Attention: `style="--attention-cols: N"` or `grid-template-columns: repeat(N, minmax(0, 1fr))`

- [ ] **Step 1: Update `index.html` topbar**

Inside `.topbar-right`, **before** `#counts`:

```html
        <div class="view-controls" role="group" aria-label="视图">
          <div class="seg" id="viewModeSeg">
            <button type="button" data-mode="attention" class="seg-btn" id="modeAttention">注意力</button>
            <button type="button" data-mode="workspace" class="seg-btn" id="modeWorkspace">按工程</button>
          </div>
          <div class="cols-control" id="colsControl" hidden>
            <button type="button" id="colsDec" aria-label="减少列数">−</button>
            <span id="colsValue">2</span>
            <button type="button" id="colsInc" aria-label="增加列数">+</button>
          </div>
        </div>
```

- [ ] **Step 2: Wire state + render in `app.js`**

Outline (implement fully — no stubs):

```js
import {
  loadPrefs,
  saveViewMode,
  saveAttentionColumns,
  clampAttentionColumns,
  effectiveAttentionColumns,
} from "./prefs.js";
import {
  attentionCardLines,
  sortAttentionSessions,
  groupSessionsForUi,
  formatStatusSummary,
} from "./group-sessions.js";

let prefs = loadPrefs();
let latestSessions = [];

function syncChrome() {
  document.getElementById("modeAttention").classList.toggle("active", prefs.viewMode === "attention");
  document.getElementById("modeWorkspace").classList.toggle("active", prefs.viewMode === "workspace");
  const colsControl = document.getElementById("colsControl");
  colsControl.hidden = prefs.viewMode !== "attention";
  document.getElementById("colsValue").textContent = String(prefs.attentionColumns);
}

function renderAttention(sessions) {
  const cols = effectiveAttentionColumns(prefs.attentionColumns, window.innerWidth);
  listEl.className = "list-attention";
  listEl.style.setProperty("--attention-cols", String(cols));
  // empty state + sortAttentionSessions + card HTML WITH workspace-path
  // reuse existing attention card builder
}

function renderWorkspace(sessions) {
  listEl.className = "list-workspace";
  listEl.style.removeProperty("--attention-cols");
  const groups = groupSessionsForUi(sessions);
  // for each group: section.workspace-group > .group-header + .group-sessions
  // cards WITHOUT workspace-path (title/summary/LIVE/banner/↗ only)
}

function render(sessions) {
  latestSessions = sessions || [];
  // counts unchanged
  listEl.innerHTML = "";
  if (prefs.viewMode === "workspace") renderWorkspace(latestSessions);
  else renderAttention(latestSessions);
  syncChrome();
}

// bind mode buttons → saveViewMode + prefs.viewMode = … + render(latestSessions)
// colsDec/colsInc → clamp 1..4, saveAttentionColumns, render
// window.resize (debounced ~100ms) → if attention, re-render for narrow breakpoint
```

Extract a shared `mountCard(s, { showPathBar: boolean })` to avoid duplicating click handlers.

- [ ] **Step 3: CSS for grid + group wall + chrome**

```css
.view-controls { display: flex; align-items: center; gap: 0.5rem; }
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
.seg-btn { background: transparent; color: inherit; border: 0; padding: 0.25rem 0.55rem; cursor: pointer; }
.seg-btn.active { background: rgba(255,255,255,0.12); }
.cols-control { display: inline-flex; align-items: center; gap: 0.35rem; }
.cols-control[hidden] { display: none !important; }

.list-attention {
  display: grid;
  grid-template-columns: repeat(var(--attention-cols, 2), minmax(0, 1fr));
  gap: 0.6rem;
  align-items: start;
}
.list-attention .empty-state { grid-column: 1 / -1; }

.list-workspace { display: flex; flex-direction: column; gap: 1rem; }
.workspace-group { /* restore prior spacing */ }
.group-header { /* restore prior look from pre-attention styles if removed */ }
.group-sessions { display: flex; flex-direction: column; gap: 0.45rem; }
```

If old `.workspace-group` / `.group-header` rules were deleted, restore from `git show a9f06e5^:cursor-watch/src/web/styles.css` (or nearest commit that still had them).

- [ ] **Step 4: Run full unit tests**

Run: `cd cursor-watch && npm test`

Expected: PASS

Manual smoke: open panel → toggle 注意力/按工程 → change columns 1–4 → refresh → prefs persist; &lt;720px width forces 1 col visually.

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/web/index.html cursor-watch/src/web/app.js cursor-watch/src/web/styles.css
git commit -m "$(cat <<'EOF'
feat(cursor-watch): dual attention/workspace views with column prefs

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 5: Spec status + README

**Files:**
- Modify: `.scratch/specs/2026-07-22-cursor-watch-view-modes-design.md` — status → `已实现`
- Modify: `README.md` / `README.en.md` — document dual views, default attention 2-col, path bar, localStorage prefs; remove any claim that grouping is gone forever

- [ ] **Step 1: Update docs**

Chinese panel section bullet examples:

- 顶栏可切换 **注意力** / **按工程**；注意力默认 2 列，可调 1–4，偏好记在本机  
- 注意力卡片有工程路径条；按工程模式恢复分组墙（组内 Top4 + 提醒）

- [ ] **Step 2: Commit**

```bash
git add .scratch/specs/2026-07-22-cursor-watch-view-modes-design.md README.md README.en.md
git commit -m "$(cat <<'EOF'
docs: mark view-modes spec implemented and refresh README

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

## Self-Review (plan vs spec)

| Spec item | Task |
|-----------|------|
| localStorage prefs + defaults | Task 1 |
| Restore group wall Top4 + reminders | Task 2 |
| Path bar prominence (attention only) | Task 3–4 |
| 1–4 columns + − N + | Task 1 + 4 |
| Narrow &lt;720 → 1 col | Task 1 `effectiveAttentionColumns` + Task 4 |
| Mode segmented control | Task 4 |
| No server changes | all tasks |
| README / spec status | Task 5 |

**Placeholder scan:** none.  
**Type consistency:** prefs keys and mode strings match throughout.

---

## Execution Handoff

Plan complete and saved to `.scratch/plans/2026-07-22-cursor-watch-view-modes.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute in this session with executing-plans checkpoints  

Which approach?

