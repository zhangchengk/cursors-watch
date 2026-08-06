# Chat library（代办 / 归档）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Cursors Watch 面板增加与 Reminder 并列的 Chat library：Todo / Archive 互斥标注、本机全局任意深度文件夹、标题/备注、三 Tab UI，以及失效条目与 Open Chat 白名单。

**Architecture:** `~/.cursor-watch/library.json` 文件存储 + `LibraryHub` 订阅；Fastify `/api/library*`；`isLibraryEntryStale` 在 GET 时计算；面板三 Tab（Reminder 默认）；标注仅从 Reminder 可见列表发起且不跳 Tab；`open-chat` 将 library entries 与 reminders 同等视为已知目标。

**Tech Stack:** TypeScript (Vitest) + Fastify + 零构建静态 `src/web/*.js`；工作目录 `cursor-watch/`。

## Global Constraints

- Spec：`docs/superpowers/specs/2026-08-06-chat-library-design.md`
- Glossary / ADR：`CONTEXT.md`、`docs/adr/0004-reminder-and-chat-library-dual-primary.md`
- 互斥 mark：`todo` | `archive`；互迁保留 title/note、默认 `folderId=null`；unmark 删除整条 entry
- 两套文件夹树（按 mark）；任意深度；本机全局；删文件夹时子节点升到 parent
- 标注入口：仅 Reminder Tab；标完不跳 Tab；不做历史搜索添加
- stale：有 `transcriptPath` 则看文件是否存在；否则 session 命中则不 stale；否则 stale。不得因 visibility prune 误杀（path 仍在即不 stale）
- 提交：英文 conventional commits + 空行 + `Co-Authored-By: Cursor <zhangchengk@yonyou.com>`
- 工作目录：仓库根下 `cursor-watch/`（测命令：`npm test`）
- Node ≥ 20；不引入 SQLite / 新依赖

## File Structure

```
cursor-watch/
├── src/
│   ├── constants.ts              # MODIFY: libraryFile()
│   ├── server.ts                 # MODIFY: library routes + WS + open-chat library
│   ├── open-chat.ts              # MODIFY: libraryEntries as known targets
│   ├── library/
│   │   ├── types.ts              # NEW
│   │   ├── store.ts              # NEW
│   │   ├── stale.ts              # NEW
│   │   └── hub.ts                # NEW
│   └── web/
│       ├── index.html            # MODIFY: tablist + panes
│       ├── styles.css            # MODIFY: tabs / library layout
│       ├── library.js            # NEW: view-model pure helpers
│       ├── app.js                # MODIFY: tabs, mark dialog, library panes
│       └── prefs.js              # MODIFY (optional): last tab key helper
└── tests/
    ├── library-store.test.ts     # NEW
    ├── library-stale.test.ts     # NEW
    ├── library-web.test.ts       # NEW
    ├── open-chat.test.ts         # MODIFY
    └── server.test.ts            # MODIFY
```

---

### Task 1: library types + store + unit tests

**Files:**
- Create: `cursor-watch/src/library/types.ts`
- Create: `cursor-watch/src/library/store.ts`
- Create: `cursor-watch/tests/library-store.test.ts`
- Modify: `cursor-watch/src/constants.ts` (add `libraryFile`)

**Interfaces:**
- Consumes: `node:fs`, `node:crypto` `randomUUID`, `libraryFile(home)`
- Produces:
  - Types: `LibraryMark`, `LibraryFolder`, `LibraryEntry`, `LibraryState`, `UpsertLibraryEntryInput`
  - `loadLibrary(home): LibraryState`
  - `upsertEntry(home, input): LibraryEntry` — 互斥；mark 变更且未显式给合法目标 folderId → `folderId=null`；保留 title/note
  - `patchEntry(home, conversationId, patch): LibraryEntry | null`
  - `deleteEntry(home, conversationId): boolean`
  - `createFolder(home, { mark, parentId?, name, sortKey? }): LibraryFolder`
  - `patchFolder(home, id, patch): LibraryFolder | null` — 同树；成环 → throw 或返回错误结果
  - `deleteFolder(home, id): boolean` — 子 folder 的 parentId 与 entry 的 folderId 升到被删节点的 parentId

- [ ] **Step 1: Add `libraryFile` and write failing store tests**

In `constants.ts` add:

```ts
export function libraryFile(home = os.homedir()): string {
  return path.join(stateDir(home), "library.json");
}
```

Create `tests/library-store.test.ts` (temp home pattern like `reminders-store.test.ts`):

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { libraryFile } from "../src/constants.js";
import {
  createFolder,
  deleteEntry,
  deleteFolder,
  loadLibrary,
  patchEntry,
  upsertEntry,
} from "../src/library/store.js";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});
function tempHome(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "cw-lib-"));
  homes.push(h);
  return h;
}

describe("libraryFile", () => {
  it("is under stateDir", () => {
    expect(libraryFile("/tmp/fake-home")).toBe(
      path.join("/tmp/fake-home", ".cursor-watch", "library.json"),
    );
  });
});

describe("library store", () => {
  it("loadLibrary empty when missing", () => {
    expect(loadLibrary(tempHome())).toEqual({ version: 1, folders: [], entries: [] });
  });

  it("upsertEntry is mutually exclusive per conversationId", () => {
    const home = tempHome();
    upsertEntry(home, { conversationId: "c1", mark: "todo", title: "A" });
    upsertEntry(home, { conversationId: "c1", mark: "archive", title: "A2", note: "n" });
    const lib = loadLibrary(home);
    expect(lib.entries).toHaveLength(1);
    expect(lib.entries[0]).toMatchObject({
      conversationId: "c1",
      mark: "archive",
      title: "A2",
      note: "n",
      folderId: null,
    });
  });

  it("mark change clears folderId but keeps title/note", () => {
    const home = tempHome();
    const folder = createFolder(home, { mark: "todo", name: "Ideas" });
    upsertEntry(home, {
      conversationId: "c1",
      mark: "todo",
      folderId: folder.id,
      title: "T",
      note: "N",
    });
    upsertEntry(home, { conversationId: "c1", mark: "archive" });
    const e = loadLibrary(home).entries[0]!;
    expect(e.mark).toBe("archive");
    expect(e.folderId).toBeNull();
    expect(e.title).toBe("T");
    expect(e.note).toBe("N");
  });

  it("deleteEntry removes metadata", () => {
    const home = tempHome();
    upsertEntry(home, { conversationId: "c1", mark: "todo", title: "x" });
    expect(deleteEntry(home, "c1")).toBe(true);
    expect(loadLibrary(home).entries).toEqual([]);
  });

  it("rejects cross-mark folderId", () => {
    const home = tempHome();
    const archiveFolder = createFolder(home, { mark: "archive", name: "Talks" });
    expect(() =>
      upsertEntry(home, {
        conversationId: "c1",
        mark: "todo",
        folderId: archiveFolder.id,
      }),
    ).toThrow(/folder/i);
  });

  it("deleteFolder reparents children and entries", () => {
    const home = tempHome();
    const parent = createFolder(home, { mark: "todo", name: "P" });
    const child = createFolder(home, { mark: "todo", name: "C", parentId: parent.id });
    upsertEntry(home, {
      conversationId: "c1",
      mark: "todo",
      folderId: parent.id,
      title: "in-p",
    });
    expect(deleteFolder(home, parent.id)).toBe(true);
    const lib = loadLibrary(home);
    expect(lib.folders.find((f) => f.id === parent.id)).toBeUndefined();
    expect(lib.folders.find((f) => f.id === child.id)?.parentId).toBeNull();
    expect(lib.entries[0]?.folderId).toBeNull();
  });

  it("patchEntry can set folder within same mark", () => {
    const home = tempHome();
    const f = createFolder(home, { mark: "todo", name: "F" });
    upsertEntry(home, { conversationId: "c1", mark: "todo" });
    const e = patchEntry(home, "c1", { folderId: f.id, title: "Hi" });
    expect(e).toMatchObject({ folderId: f.id, title: "Hi", mark: "todo" });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd cursor-watch && npx vitest run tests/library-store.test.ts`

Expected: FAIL (module not found / libraryFile missing)

- [ ] **Step 3: Implement types + store**

`src/library/types.ts`:

```ts
export type LibraryMark = "todo" | "archive";

export interface LibraryFolder {
  id: string;
  mark: LibraryMark;
  parentId: string | null;
  name: string;
  sortKey: number;
}

export interface LibraryEntry {
  conversationId: string;
  mark: LibraryMark;
  folderId: string | null;
  title?: string;
  note?: string;
  projectKey?: string;
  workspacePath?: string;
  workspaceLabel?: string;
  chatName?: string;
  transcriptPath?: string;
  updatedAt: number;
}

export interface LibraryState {
  version: 1;
  folders: LibraryFolder[];
  entries: LibraryEntry[];
}

export type UpsertLibraryEntryInput = {
  conversationId: string;
  mark: LibraryMark;
  folderId?: string | null;
  title?: string;
  note?: string;
  projectKey?: string;
  workspacePath?: string;
  workspaceLabel?: string;
  chatName?: string;
  transcriptPath?: string;
  /** When true and folderId provided, keep folder on mark change if valid for new mark */
  keepFolderIfValid?: boolean;
};
```

`src/library/store.ts`: implement load/save (empty default `{ version: 1, folders: [], entries: [] }`), validation helpers (`assertNoCycle`, `folderById`), and all CRUD above. On `upsertEntry` when existing mark ≠ new mark: set `folderId` to `input.folderId` only if that folder exists and `folder.mark === newMark`; else `null`. Merge optional snapshot fields like reminders store. Use `randomUUID()` for folder ids. `updatedAt: Date.now()`.

Throw `Error` with clear message for invalid folder / cycle (server maps to 400/409 later).

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd cursor-watch && npx vitest run tests/library-store.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangcheng/idea/Cursors
git add cursor-watch/src/constants.ts cursor-watch/src/library/types.ts cursor-watch/src/library/store.ts cursor-watch/tests/library-store.test.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): add chat library JSON store

Persist todo/archive entries and per-mark folder trees under ~/.cursor-watch/library.json.

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 2: stale + LibraryHub + open-chat whitelist

**Files:**
- Create: `cursor-watch/src/library/stale.ts`
- Create: `cursor-watch/src/library/hub.ts`
- Create: `cursor-watch/tests/library-stale.test.ts`
- Modify: `cursor-watch/src/open-chat.ts`
- Modify: `cursor-watch/tests/open-chat.test.ts`

**Interfaces:**
- Consumes: `LibraryEntry`, `SessionState`, store functions
- Produces:
  - `isLibraryEntryStale(entry, sessions, existsFn?): boolean`
  - `class LibraryHub` — `getSnapshot(sessions)`, mutate wrappers that `emit`, `subscribe`
  - `OpenChatDeps.libraryEntries?: Array<{ conversationId: string; workspacePath?: string }>` — same role as reminders

- [ ] **Step 1: Write failing stale + open-chat tests**

`tests/library-stale.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isLibraryEntryStale } from "../src/library/stale.js";
import type { LibraryEntry } from "../src/library/types.js";
import type { SessionState } from "../src/types.js";

function entry(over: Partial<LibraryEntry> & Pick<LibraryEntry, "conversationId" | "mark">): LibraryEntry {
  return {
    folderId: null,
    updatedAt: 1,
    ...over,
  };
}

describe("isLibraryEntryStale", () => {
  it("stale when transcriptPath missing on disk", () => {
    expect(
      isLibraryEntryStale(
        entry({ conversationId: "c1", mark: "todo", transcriptPath: "/no/such/file.jsonl" }),
        [],
        () => false,
      ),
    ).toBe(true);
  });

  it("not stale when transcriptPath exists even if not in sessions", () => {
    expect(
      isLibraryEntryStale(
        entry({
          conversationId: "c1",
          mark: "archive",
          transcriptPath: "/exists.jsonl",
          workspacePath: "/ws",
        }),
        [],
        () => true,
      ),
    ).toBe(false);
  });

  it("not stale when session matches and no transcriptPath", () => {
    const sessions = [
      {
        id: "c1",
        workspacePath: "/ws",
        projectKey: "p",
        workspaceLabel: "ws",
        status: "idle",
        summary: "s",
        currentAction: "",
        lastActivityAt: 1,
        subagentCount: 0,
        subagentRunning: 0,
        transcriptPath: "/t",
        recentMessages: [],
      } satisfies SessionState,
    ];
    expect(
      isLibraryEntryStale(
        entry({ conversationId: "c1", mark: "todo", workspacePath: "/ws" }),
        sessions,
      ),
    ).toBe(false);
  });

  it("stale when no path and no session", () => {
    expect(isLibraryEntryStale(entry({ conversationId: "c1", mark: "todo" }), [])).toBe(true);
  });
});
```

Extend `open-chat.test.ts`: add case where session absent but `libraryEntries` contains matching conversationId+workspacePath → open succeeds (mock bridge like existing reminder case). Mirror the reminder test pattern already in that file.

- [ ] **Step 2: Run — expect FAIL**

Run: `cd cursor-watch && npx vitest run tests/library-stale.test.ts tests/open-chat.test.ts`

- [ ] **Step 3: Implement stale + hub + open-chat**

`stale.ts`:

```ts
import fs from "node:fs";
import type { LibraryEntry } from "./types.js";
import type { SessionState } from "../types.js";

export function isLibraryEntryStale(
  entry: LibraryEntry,
  sessions: SessionState[],
  exists: (p: string) => boolean = (p) => fs.existsSync(p),
): boolean {
  const path = entry.transcriptPath?.trim();
  if (path) return !exists(path);
  const wp = entry.workspacePath?.trim() ?? "";
  if (
    wp &&
    sessions.some((s) => s.id === entry.conversationId && s.workspacePath === wp)
  ) {
    return false;
  }
  return true;
}
```

`hub.ts`: wrap store; `getSnapshot(sessions)` returns `{ folders, entries: entries.map(e => ({...e, stale: isLibraryEntryStale(e, sessions)})) }`; after each mutation call listeners with latest snapshot (sessions arg: hub can accept `getSessions: () => SessionState[]` in constructor, or emit raw state and let server attach stale — prefer hub holds `getSessions` callback set by server, or server computes stale on GET and hub only notifies void/raw. **Simplest:** Hub emits `LibraryState` after mutations; server `GET` and WS handler attach stale via `isLibraryEntryStale`.

Update `assertOpenChatTarget` / `OpenChatDeps` to accept `libraryEntries` like reminders (path allowlist + existence check). Update `openChatInCursor` call sites in `server.ts` in Task 3; in this task update function signatures + tests that call open-chat directly.

- [ ] **Step 4: Run — expect PASS**

Run: `cd cursor-watch && npx vitest run tests/library-stale.test.ts tests/open-chat.test.ts`

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/library/stale.ts cursor-watch/src/library/hub.ts cursor-watch/src/open-chat.ts cursor-watch/tests/library-stale.test.ts cursor-watch/tests/open-chat.test.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): library stale detection and open-chat targets

Treat library entries as known open-chat targets; compute stale from transcript path or session hit.

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 3: HTTP API + WebSocket library channel

**Files:**
- Modify: `cursor-watch/src/server.ts`
- Modify: `cursor-watch/tests/server.test.ts`

**Interfaces:**
- Consumes: `LibraryHub`, `isLibraryEntryStale`, store via hub
- Produces: routes in design §6.2; WS `{ type: "library", payload }` on connect + on change; pass `libraryEntries` into `openChatInCursor` / `open-workspace` extra paths

- [ ] **Step 1: Write failing server tests**

In `server.test.ts`, create LibraryHub with temp home; add cases:

1. `GET /api/library` → empty folders/entries  
2. `POST /api/library/entries` with mark todo + conversationId → 200; GET shows entry  
3. `POST` mark archive for same id → folderId null if was set  
4. `DELETE /api/library/entries/:id` → gone  
5. `POST /api/library/folders` + delete folder reparent (via API)  
6. WS receives `type: "library"` after POST entry  

Wire `buildServer(store, { homeDir, reminderHub, libraryHub })`.

- [ ] **Step 2: Run — expect FAIL**

Run: `cd cursor-watch && npx vitest run tests/server.test.ts`

- [ ] **Step 3: Implement server routes**

- Construct `libraryHub = opts?.libraryHub ?? new LibraryHub(homeDir)`  
- `GET /api/library` → hub load + map stale with `store.getSessions()`  
- POST/PATCH/DELETE entries & folders → validate body; catch store errors → 400/409; on success `libraryHub.notifyChanged()`  
- `/ws`: initial send library snapshot; `libraryHub.subscribe` → push updates  
- `open-chat` / `open-workspace`: `extraAllowedPaths` / known targets include library entry workspace paths and conversation matches  

- [ ] **Step 4: Run — expect PASS**

Run: `cd cursor-watch && npx vitest run tests/server.test.ts`

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/server.ts cursor-watch/tests/server.test.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): expose chat library REST and WS APIs

Add /api/library* CRUD and push library snapshots on the panel websocket.

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 4: Web view-model + three tabs + Reminder mark entry

**Files:**
- Create: `cursor-watch/src/web/library.js`
- Create: `cursor-watch/tests/library-web.test.ts`
- Modify: `cursor-watch/src/web/index.html`
- Modify: `cursor-watch/src/web/styles.css`
- Modify: `cursor-watch/src/web/app.js`

**Interfaces:**
- Consumes: library API JSON shape
- Produces (in `library.js`):
  - `LIBRARY_TAB_KEY = "cursor-watch-library-tab"`
  - `loadLibraryTab(): "reminder"|"todo"|"archive"` — invalid/missing → `"reminder"`
  - `saveLibraryTab(tab)`
  - `entryDisplayTitle(entry): string` — title → chatName → conversationId
  - `foldersForMark(folders, mark)`
  - `buildFolderTree(foldersForMark): tree nodes { folder, children[] }`
  - `entriesInFolder(entries, mark, folderId)` — folderId null = unfiled
  - `folderSelectOptions(folders, mark): { id, label }[]` — indented labels for `<select>`

- [ ] **Step 1: Write failing `library-web` tests**

```ts
import { describe, expect, it } from "vitest";
import {
  buildFolderTree,
  entryDisplayTitle,
  entriesInFolder,
  foldersForMark,
} from "../src/web/library.js";

describe("library web helpers", () => {
  it("entryDisplayTitle prefers title then chatName", () => {
    expect(entryDisplayTitle({ conversationId: "c", title: "T", chatName: "N" })).toBe("T");
    expect(entryDisplayTitle({ conversationId: "c", chatName: "N" })).toBe("N");
    expect(entryDisplayTitle({ conversationId: "c" })).toBe("c");
  });

  it("buildFolderTree nests by parentId", () => {
    const folders = [
      { id: "a", mark: "todo", parentId: null, name: "A", sortKey: 0 },
      { id: "b", mark: "todo", parentId: "a", name: "B", sortKey: 0 },
    ];
    const tree = buildFolderTree(foldersForMark(folders, "todo"));
    expect(tree).toHaveLength(1);
    expect(tree[0].folder.id).toBe("a");
    expect(tree[0].children[0].folder.id).toBe("b");
  });

  it("entriesInFolder filters unfiled", () => {
    const entries = [
      { conversationId: "1", mark: "todo", folderId: null },
      { conversationId: "2", mark: "todo", folderId: "a" },
      { conversationId: "3", mark: "archive", folderId: null },
    ];
    expect(entriesInFolder(entries, "todo", null).map((e) => e.conversationId)).toEqual(["1"]);
    expect(entriesInFolder(entries, "todo", "a").map((e) => e.conversationId)).toEqual(["2"]);
  });
});
```

- [ ] **Step 2: Implement `library.js` + HTML tab shell**

`index.html`: after `<header class="topbar">…</header>`, add:

```html
<nav class="library-tabs" role="tablist" aria-label="主视图">
  <button type="button" role="tab" id="tabReminder" aria-selected="true" data-tab="reminder">Reminder</button>
  <button type="button" role="tab" id="tabTodo" aria-selected="false" data-tab="todo">Todo</button>
  <button type="button" role="tab" id="tabArchive" aria-selected="false" data-tab="archive">Archive</button>
</nav>
<div id="reminderPane" role="tabpanel">
  <!-- move existing inbox + sessionsSection here -->
</div>
<div id="todoPane" role="tabpanel" hidden>
  <div class="library-layout" data-mark="todo">… tree + list placeholders …</div>
</div>
<div id="archivePane" role="tabpanel" hidden>
  <div class="library-layout" data-mark="archive">…</div>
</div>
<dialog id="libraryMarkDialog">… mark select, title, note, folder select, cancel/save …</dialog>
```

Styles: `.library-tabs`, selected state, `.library-layout` (tree + list), dialog basics — match existing topbar aesthetic (no purple fluff).

- [ ] **Step 3: Wire `app.js` tabs + mark from Reminder cards**

- On load: `loadLibraryTab()` → show pane; tab click → `saveLibraryTab` + switch (do not force reminder after mark)  
- Fetch `/api/library` on load; WS `type==="library"` updates `latestLibrary`  
- On attention / inbox cards: add button「馆藏」or「Todo/Archive」opening dialog prefilled from session/reminder fields (`conversationId`, workspace*, chatName, transcriptPath from session)  
- Dialog submit: `POST /api/library/entries` then toast；**do not** change tab  
- Run library-web tests + full `npm test`

- [ ] **Step 4: Commit**

```bash
git add cursor-watch/src/web/library.js cursor-watch/tests/library-web.test.ts cursor-watch/src/web/index.html cursor-watch/src/web/styles.css cursor-watch/src/web/app.js
git commit -m "$(cat <<'EOF'
feat(cursor-watch): add library tabs and Reminder mark dialog

Three top-level tabs with Reminder default; mark todo/archive from visible Reminder lists without switching tabs.

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 5: Todo/Archive curation UI + README

**Files:**
- Modify: `cursor-watch/src/web/app.js`
- Modify: `cursor-watch/src/web/styles.css`
- Modify: `README.md`
- Modify: `README.en.md` (short mirror if Chinese README gains a paragraph)

**Interfaces:**
- Consumes: Task 3 APIs + Task 4 helpers
- Produces: usable Todo/Archive panes — tree CRUD, entry edit/move/mark/unmark/open

- [ ] **Step 1: Render library panes**

For active mark pane:

- Folder tree from `buildFolderTree`; click selects folder filter (`null` = 未归组)  
- Buttons: 新建文件夹（prompt name, `POST /api/library/folders` with parentId=selected or null）、重命名（`PATCH`）、删除（`DELETE`，确认）  
- Entry list for selection; show stale badge「源会话不可用」  
- Per entry actions: 编辑标题/备注（`PATCH`）、移到文件夹、改为另一 mark（`PATCH` mark）、取消标注（`DELETE`）、↗（reuse `openInCursor` with `{ id: conversationId, workspacePath }`）

No drag-and-drop required if 「移动到」select works; optional DnD is out of scope unless cheap.

- [ ] **Step 2: Manual smoke checklist (document in commit body or skip file)**

1. Reminder → mark Todo with title → stays on Reminder → Todo tab shows entry  
2. Move to Archive → unfiled under Archive; title kept  
3. Create nested folders; delete middle folder → children reparent  
4. Remove transcript file / fake path → stale badge; unmark clears  
5. Open Chat from Archive for pruned session with stored workspacePath  

- [ ] **Step 3: Update README**

Chinese README（开篇或新小节「会话馆藏」）简短说明：

- 顶栏 Reminder / Todo / Archive  
- 代办=待落地；归档=回看/本机宣讲  
- 标注来自 Reminder 可见列表；非任务中枢、不导出、不替代侧边栏  

English README：对等一句。

- [ ] **Step 4: Run full test suite**

Run: `cd cursor-watch && npm test`

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/web/app.js cursor-watch/src/web/styles.css README.md README.en.md
git commit -m "$(cat <<'EOF'
feat(cursor-watch): library curation UI and README

Todo/Archive panes manage folders and entries; document dual-primary library in README.

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

## Spec coverage (self-review)

| Spec 要求 | Task |
|-----------|------|
| library.json + 互斥/互迁/unmark | 1 |
| 任意深度两套树、删文件夹提升 | 1 |
| stale 规则 | 2 |
| open-chat 白名单 | 2–3 |
| REST + WS | 3 |
| 三 Tab、Reminder 默认、标注入口不跳转 | 4 |
| 馆藏整理 UI | 5 |
| README / 非目标边界 | 5 |
| 无历史搜索、无导出 | 全任务不做 |

**Placeholder scan:** 无 TBD。  
**Type consistency:** `LibraryMark`, `LibraryEntry`, `LibraryHub.getSnapshot` / server attach stale — Task 2–3 对齐 `isLibraryEntryStale`。

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-06-chat-library.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每 Task 新开 subagent，任务间复查  
2. **Inline Execution** — 本会话按 executing-plans 连续做，设检查点  

Which approach?
