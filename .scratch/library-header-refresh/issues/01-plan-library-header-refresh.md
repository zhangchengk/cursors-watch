# 01 — Library header refresh Implementation Plan

**What to build:** Implement the work described in `.scratch/library-header-refresh/issues/00-spec-library-header-refresh.md` and the checklist below.

**Blocked by:** None — can start immediately (or follow task order inside checklist).

**Status:** ready-for-agent

**Parent:** `.scratch/library-header-refresh/issues/00-spec-library-header-refresh.md`

- [ ] Acceptance: behavior matches spec and CONTEXT.md
- [ ] Tests updated or added at agreed seams

## Implementation checklist (migrated plan)

# Library header refresh Implementation Plan


**Goal:** 交付 **馆藏时间刷新**：预览 + 在 Cursor 退出后更新 Todo/Archive 对应 `composerHeaders.lastUpdatedAt`；设置维护区 + API + CLI。

**Architecture:** 纯 Node 模块 `library-header-refresh.ts`（规划目标 + 读写 composerHeaders）；`cursor-process.ts`（macOS 检测）；`server.ts` 注册 maintenance 路由；`prefs.ts` 扩展 last-run 摘要；`web/` 设置区 UI；CLI 子命令。Chat purge 仅 HTML 占位。

**Spec:** `.scratch/specs/2026-10-15-library-header-refresh-design.md`

**Global constraints**

- macOS only for apply path.  
- Never delete composer rows or touch `cursorDiskKV`.  
- No auto-backup.  
- Commits only when user asks.

---

## File map

| File | Responsibility |
|------|----------------|
| `cursor-watch/src/cursor-process.ts` | `isCursorRunning(): boolean` (macOS) |
| `cursor-watch/src/composer-headers-write.ts` | Resolve db path; read/update single header JSON |
| `cursor-watch/src/library-header-refresh.ts` | Plan targets from library; dryRun/apply orchestration |
| `cursor-watch/src/prefs.ts` | Optional `libraryHeaderRefreshLast` load/save |
| `cursor-watch/src/server.ts` | `POST /api/maintenance/library-header-refresh` |
| `cursor-watch/src/cli.ts` | `library refresh-headers [--dry-run]` |
| `cursor-watch/tests/library-header-refresh.test.ts` | TDD: bump JSON, dryRun counts, cursor gate mock |
| `cursor-watch/tests/cursor-process.test.ts` | Optional: mock pgrep |
| `cursor-watch/src/web/index.html` | Settings **维护** section |
| `cursor-watch/src/web/app.js` | Preview/apply handlers |
| `docs/adr/0013-library-header-refresh-writes-composer-headers.md` | ADR |

---

### Task 1: `composer-headers-write` + refresh planner (TDD)

**Files:** Create `composer-headers-write.ts`, `library-header-refresh.ts`, `tests/library-header-refresh.test.ts`

**Produces:**

- `export function resolveComposerStateDbPath(home?: string): string | null` — reuse `composerStateDbCandidates`.  
- `export function bumpComposerHeaderLastUpdatedAt(dbPath, composerId, ts): { ok: true } | { ok: false; error: string }`  
- `export function listLibraryRefreshTargets(home, libraryEntries): Array<{ conversationId, mark, title? }>` — todo|archive dedupe.  
- `export function runLibraryHeaderRefresh(opts): RefreshResult` — `{ dryRun, batchTs?, refreshed, skippedNoHeader, failed, samples[] }`

**Tests (vitest):**

- Temp sqlite with `composerHeaders` table; bump updates only `lastUpdatedAt`.  
- Invalid JSON → failed count, others succeed.  
- Missing row → skippedNoHeader.  
- dryRun: no file mtime change / no UPDATE.

- [ ] Step 1: failing tests  
- [ ] Step 2: implement until green  

```bash
cd cursor-watch && npx vitest run tests/library-header-refresh.test.ts
```

---

### Task 2: Cursor process gate

**Files:** `cursor-process.ts`, wire into `runLibraryHeaderRefresh` when `!dryRun`

- [ ] Implement macOS heuristic (document in module comment).  
- [ ] Unit test with injected `checkProcess` dep.  
- [ ] Apply returns `{ ok: false, statusCode: 409, error: "…" }` when running.

---

### Task 3: Prefs last-run

**Files:** `prefs.ts`, tests

- [ ] Extend `WatchPrefs` or parallel field in same JSON file (prefer extend + coerce optional block).  
- [ ] `saveLibraryHeaderRefreshLast(home, summary)` called only from refresh apply success.  
- [ ] `GET /api/prefs` returns it for UI.

---

### Task 4: HTTP route

**Files:** `server.ts`, `tests/server.test.ts`

- [ ] `POST /api/maintenance/library-header-refresh` body `{ dryRun?: boolean }`.  
- [ ] Inject library snapshot from `libraryHub.rawState().entries`.  
- [ ] 409 when cursor running and apply.

---

### Task 5: CLI

**Files:** `cli.ts`

```bash
cursor-watch library refresh-headers [--dry-run]
```

- [ ] Calls same `runLibraryHeaderRefresh` in-process (no HTTP required).  
- [ ] Print JSON result to stdout.

---

### Task 6: Panel UI

**Files:** `index.html`, `app.js`, CSS if needed

- [ ] Section **维护** with warnings, last-run line, Preview + Apply buttons.  
- [ ] Apply: `confirm()` then POST.  
- [ ] Success panel: Reload + Delete Old Chats 引导文案.  
- [ ] Chat purge 占位段落（链到 spec / spike fail notes）.

---

### Task 7: Docs + README 一句

- [ ] ADR-0013 已添加  
- [ ] README 设置说明加「馆藏时间刷新」一行（可选，用户未要求可略 — plan 含 optional）

---

## Test plan (manual)

1. 标记 2 条 Todo，`dryRun` 预览计数正确。  
2. 启动 Cursor → apply 409。  
3. 退出 Cursor → apply 成功；sqlite 查 `lastUpdatedAt`。  
4. 开 Cursor → Delete Old Chats 30 天：馆藏仍在、无标注旧会话减少（人工 spot check）。

