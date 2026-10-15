# 01 — cursor-watch Incremental Scan Implementation Plan

**What to build:** Implement the work described in `.scratch/incremental-scan/issues/00-spec-incremental-scan.md` and the checklist below.

**Blocked by:** None — can start immediately (or follow task order inside checklist).

**Status:** done

**Parent:** `.scratch/incremental-scan/issues/00-spec-incremental-scan.md`

- [ ] Acceptance: behavior matches spec and CONTEXT.md
- [ ] Tests updated or added at agreed seams

## Implementation checklist (migrated plan)

# cursor-watch Incremental Scan Implementation Plan

**Goal:** Replace per-event full `scanProjects` with path-routed incremental patches so session status and progress text update in about 1–2s, while keeping startup + periodic full scans for correctness.

**Architecture:** Daemon keeps `SessionStore` in memory. Chokidar events are classified by path; only the affected session/project/live file is rescanned in-process and `upsert`/`remove`d. Full scans still `fork` `scan-worker.ts` on startup and every 5 minutes. Unknown paths or incremental errors schedule a full scan.

**Tech Stack:** Existing TypeScript / Vitest / Fastify / chokidar / `node:sqlite` (composer headers); no new dependencies.

## Global Constraints

- Spec: `.scratch/specs/2026-07-20-cursor-watch-incremental-scan-design.md`
- Product semantics unchanged: `ACTIVE_WINDOW_MS = 60 * 60 * 1000`, unread kept indefinitely, yellow=unread / white=read after stop, mirrored subagent ids must not become top-level cards, open-workspace behavior unchanged
- Incremental debounce: **80ms** trailing merge per key
- Full-scan interval: **`FULL_SCAN_INTERVAL_MS = 5 * 60 * 1000`**
- Full scan stays in forked worker; incremental runs in daemon process
- On classify failure / parse error: log + `scheduleFullScan()` (do not drop the update forever)
- After full `replaceAll`, if incremental queue non-empty: flush with short debounce
- WS protocol unchanged: push full `sessions` array on any store notify
- Working directory for code: `cursor-watch/`; docs under repo root `.scratch/`
- Commits: English conventional commits + blank line + `Co-Authored-By: Cursor <zhangchengk@yonyou.com>`
- TDD: failing test → implement → pass → commit per task

---

## File Structure

```text
cursor-watch/
├── src/
│   ├── constants.ts           # MODIFY: FULL_SCAN_INTERVAL_MS, INCREMENTAL_DEBOUNCE_MS
│   ├── store.ts               # MODIFY: upsert, remove
│   ├── watch-path.ts          # NEW: classifyWatchPath
│   ├── scan-caches.ts         # NEW: headers + workspace index caches (mtime-aware)
│   ├── incremental-scan.ts    # NEW: rescanParentSession, rescanProjectShells, applyLivePatch
│   ├── scanner.ts             # MODIFY: export helpers needed by incremental (or thin re-exports)
│   ├── watcher.ts             # MODIFY: route events; full scan on boot + interval; queue
│   └── (unchanged) live-store.ts, live-state.ts, chat-names.ts, aggregator.ts, …
├── tests/
│   ├── store.test.ts          # MODIFY
│   ├── watch-path.test.ts     # NEW
│   ├── incremental-scan.test.ts # NEW (fixtures under tests/fixtures/…)
│   └── scan-caches.test.ts    # NEW (optional light)
```

---

### Task 1: SessionStore upsert / remove

**Files:**
- Modify: `cursor-watch/src/store.ts`
- Test: `cursor-watch/tests/store.test.ts`

**Interfaces:**
- Consumes: `SessionState` from `src/types.ts`
- Produces:
  - `upsert(session: SessionState): void` — replace by `id` or append; then notify subscribers with `getSessions()`
  - `remove(id: string): void` — delete by id if present; notify even if missing is OK only when removed (prefer: notify only if something changed)

- [ ] **Step 1: Write the failing tests**

Append to `tests/store.test.ts`:

```ts
it("upsert inserts and replaces by id and notifies", () => {
  const store = new SessionStore();
  const spy = vi.fn();
  store.subscribe(spy);
  const a = { id: "a", summary: "1" } as SessionState;
  store.upsert(a);
  expect(store.getSessions()).toEqual([a]);
  expect(spy).toHaveBeenLastCalledWith([a]);
  const a2 = { id: "a", summary: "2" } as SessionState;
  store.upsert(a2);
  expect(store.getSessions()).toEqual([a2]);
  const b = { id: "b", summary: "b" } as SessionState;
  store.upsert(b);
  expect(store.getSessions().map((s) => s.id).sort()).toEqual(["a", "b"]);
});

it("remove deletes by id and notifies", () => {
  const store = new SessionStore();
  const spy = vi.fn();
  store.replaceAll([{ id: "a" } as SessionState, { id: "b" } as SessionState]);
  store.subscribe(spy);
  store.remove("a");
  expect(store.getSessions().map((s) => s.id)).toEqual(["b"]);
  expect(spy).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cursor-watch && npx vitest run tests/store.test.ts`

Expected: FAIL — `upsert` / `remove` not defined

- [ ] **Step 3: Minimal implementation**

In `src/store.ts`:

```ts
upsert(session: SessionState): void {
  const i = this.sessions.findIndex((s) => s.id === session.id);
  if (i >= 0) {
    const next = this.sessions.slice();
    next[i] = session;
    this.sessions = next;
  } else {
    this.sessions = [...this.sessions, session];
  }
  for (const l of this.listeners) l(this.sessions);
}

remove(id: string): void {
  const next = this.sessions.filter((s) => s.id !== id);
  if (next.length === this.sessions.length) return;
  this.sessions = next;
  for (const l of this.listeners) l(this.sessions);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cursor-watch && npx vitest run tests/store.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangcheng/idea/Cursors
git add cursor-watch/src/store.ts cursor-watch/tests/store.test.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): add SessionStore upsert and remove

Enable in-place session patches for incremental scan without replaceAll.

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 2: classifyWatchPath

**Files:**
- Create: `cursor-watch/src/watch-path.ts`
- Create: `cursor-watch/tests/watch-path.test.ts`
- Modify: `cursor-watch/src/constants.ts` (only if needed — prefer pure path parsing)

**Interfaces:**
- Consumes: absolute file paths; `projectsDir` and `liveDir` absolute roots
- Produces:

```ts
export type WatchPathKind =
  | {
      kind: "transcript_main";
      projectKey: string;
      sessionId: string;
      filePath: string;
    }
  | {
      kind: "transcript_subagent";
      projectKey: string;
      parentId: string;
      childId: string;
      filePath: string;
    }
  | { kind: "terminal"; projectKey: string; filePath: string }
  | { kind: "live"; conversationId: string; filePath: string }
  | { kind: "unknown" };

export function classifyWatchPath(
  filePath: string,
  opts: { projectsDir: string; liveDir: string },
): WatchPathKind;
```

Rules (normalize with `path.resolve`):

- Under `liveDir`, file `*.json` → `live` with `conversationId = basename without .json`
- Match `…/<projectKey>/terminals/<name>.txt` under `projectsDir` → `terminal`
- Match `…/<projectKey>/agent-transcripts/<parentId>/subagents/<childId>.jsonl` → `transcript_subagent`
- Match `…/<projectKey>/agent-transcripts/<sessionId>/<sessionId>.jsonl` (same folder name as file stem) → `transcript_main`
- Else → `unknown`

- [ ] **Step 1: Write the failing tests**

Create `tests/watch-path.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyWatchPath } from "../src/watch-path.js";

const projectsDir = "/Users/u/.cursor/projects";
const liveDir = "/Users/u/.cursor-watch/live";

describe("classifyWatchPath", () => {
  it("classifies live json", () => {
    const r = classifyWatchPath(path.join(liveDir, "abc-123.json"), {
      projectsDir,
      liveDir,
    });
    expect(r).toEqual({
      kind: "live",
      conversationId: "abc-123",
      filePath: path.join(liveDir, "abc-123.json"),
    });
  });

  it("classifies terminal", () => {
    const filePath = path.join(projectsDir, "Users-u-idea-A", "terminals", "1.txt");
    const r = classifyWatchPath(filePath, { projectsDir, liveDir });
    expect(r).toMatchObject({ kind: "terminal", projectKey: "Users-u-idea-A" });
  });

  it("classifies main transcript and subagent", () => {
    const main = path.join(
      projectsDir,
      "Users-u-idea-A",
      "agent-transcripts",
      "sess-1",
      "sess-1.jsonl",
    );
    expect(classifyWatchPath(main, { projectsDir, liveDir })).toMatchObject({
      kind: "transcript_main",
      sessionId: "sess-1",
      projectKey: "Users-u-idea-A",
    });
    const sub = path.join(
      projectsDir,
      "Users-u-idea-A",
      "agent-transcripts",
      "sess-1",
      "subagents",
      "child-9.jsonl",
    );
    expect(classifyWatchPath(sub, { projectsDir, liveDir })).toMatchObject({
      kind: "transcript_subagent",
      parentId: "sess-1",
      childId: "child-9",
    });
  });

  it("returns unknown for unrelated paths", () => {
    expect(
      classifyWatchPath("/tmp/x", { projectsDir, liveDir }).kind,
    ).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cursor-watch && npx vitest run tests/watch-path.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/watch-path.ts`**

Implement `classifyWatchPath` with `path.resolve` + relative segments checks as above. Use string/`path.sep` carefully on macOS.

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd cursor-watch && npx vitest run tests/watch-path.test.ts`

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/watch-path.ts cursor-watch/tests/watch-path.test.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): classify chokidar paths for incremental scan

Route live, terminal, and transcript paths without a full rescan.

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 3: Constants for debounce + full-scan interval

**Files:**
- Modify: `cursor-watch/src/constants.ts`
- Modify: `cursor-watch/tests/types-smoke.test.ts` (assert new constants)

**Interfaces:**
- Produces:
  - `export const INCREMENTAL_DEBOUNCE_MS = 80;`
  - `export const FULL_SCAN_INTERVAL_MS = 5 * 60 * 1000;`

- [ ] **Step 1: Write failing assertion in `tests/types-smoke.test.ts`**

```ts
import {
  ACTIVE_WINDOW_MS,
  DEFAULT_PORT,
  FULL_SCAN_INTERVAL_MS,
  INCREMENTAL_DEBOUNCE_MS,
  RUNNING_WINDOW_MS,
} from "../src/constants.js";

// inside existing describe:
expect(INCREMENTAL_DEBOUNCE_MS).toBe(80);
expect(FULL_SCAN_INTERVAL_MS).toBe(5 * 60 * 1000);
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd cursor-watch && npx vitest run tests/types-smoke.test.ts`

- [ ] **Step 3: Add exports to `src/constants.ts`**

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/constants.ts cursor-watch/tests/types-smoke.test.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): add incremental debounce and full-scan interval constants

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 4: Scan caches (headers + workspace index)

**Files:**
- Create: `cursor-watch/src/scan-caches.ts`
- Create: `cursor-watch/tests/scan-caches.test.ts`
- Read: `cursor-watch/src/chat-names.ts` (`loadComposerHeadersMetaFromHome`, `composerStateDbCandidates`)
- Read: `cursor-watch/src/workspace.ts` (`buildWorkspaceIndex`, `resolveWorkspace`)

**Interfaces:**
- Produces:

```ts
export class ScanCaches {
  constructor(homeDir: string);
  /** Reload headers if db mtime changed (or first call). */
  getHeaders(): Map<string, ComposerHeaderMeta>;
  getHeader(id: string): ComposerHeaderMeta | undefined;
  /** Rebuild workspace index (call on full scan / when resolve misses). */
  rebuildWorkspaceIndex(): void;
  resolveWorkspace(projectKey: string): { workspacePath: string; workspaceLabel: string };
}
```

Behavior:

- Cache `Map` from `loadComposerHeadersMetaFromHome(homeDir)`
- Track max mtime of existing candidate db files; if mtime > cached, reload
- Hold `WorkspaceIndex` from `buildWorkspaceIndex(homeDir)`; `resolveWorkspace(projectKey, homeDir, index)`
- If resolve returns empty path and key looks valid, optionally `rebuildWorkspaceIndex()` once and retry (keep simple: rebuild on miss)

- [ ] **Step 1: Failing test with fake fs injection OR temp home**

Prefer temp dir + stub is heavy; test mtime reload with injectable deps:

```ts
// Minimal: construct ScanCaches with home that has no db → empty headers;
// after writing nothing, getHeaders() returns Map size 0.
```

If injection is cleaner, accept:

```ts
export class ScanCaches {
  constructor(
    homeDir: string,
    deps?: {
      loadHeaders?: (home: string) => Map<string, ComposerHeaderMeta>;
      dbMtimeMs?: (home: string) => number;
      buildIndex?: (home: string) => WorkspaceIndex;
    },
  );
}
```

Test: first `getHeaders` calls load once; second call same mtime does not reload; bump mtime → reload.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `scan-caches.ts`**

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/scan-caches.ts cursor-watch/tests/scan-caches.test.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): cache composer headers and workspace index for incremental scan

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 5: incremental-scan — rescan one parent session

**Files:**
- Create: `cursor-watch/src/incremental-scan.ts`
- Create: `cursor-watch/tests/incremental-scan.test.ts`
- Modify: `cursor-watch/src/scanner.ts` — **export** `buildState` (rename export) and/or extract shared helpers so incremental does not duplicate parse/infer/merge

**Interfaces:**
- Consumes: `parseTranscriptFile`, `inferSessionFields`, `mergeSessionExtras`, `aggregateSessions`, `readLiveMap` / single live file, `ScanCaches`, `workspaceDirExists` / aggregator filters
- Produces:

```ts
export function rescanParentSession(opts: {
  projectsDir: string;
  homeDir: string;
  projectKey: string;
  sessionId: string;
  caches: ScanCaches;
  now?: number;
}): SessionState | null;
```

Semantics:

1. If `sessionId` appears under any `agent-transcripts/*/subagents/<sessionId>.jsonl` in this project → return `null` (mirrored subagent; do not upsert as parent). Caller may instead rescan the real parent when event was subagent path.
2. Read main `…/agent-transcripts/<sessionId>/<sessionId>.jsonl`; missing → `null`.
3. Compute project `shellRunning` / `shellExitCode` from that project’s `terminals/` (same rules as `scanProjects`, including `SCAN_LOOKBACK_MS` mtime cutoff).
4. `buildState` parent + each subagent jsonl under `subagents/` → `raw[]` with `parentId`.
5. `aggregateSessions(raw, now)` → take the parent row (id === sessionId); if filtered out by ACTIVE_WINDOW/unread/workspace rules, return `null` (caller `remove`).
6. Apply `mergeSessionExtras` with `caches.getHeader(id)` and live snap for id (read `liveDir/home` single file or from `readLiveMap`).

Also export:

```ts
export function readProjectShellFlags(
  projectPath: string,
  now: number,
): { shellRunning: boolean; shellExitCode: number | null };
```

- [ ] **Step 1: Fixture + failing test**

Reuse / extend `tests/fixtures/projects-layout` or `fs.mkdtempSync`:

- Parent `parent-aa/parent-aa.jsonl` with recent timestamp  
- Optional subagent  
- Assert `rescanParentSession` returns id `parent-aa` with `recentMessages` length ≥ 1  
- Second fixture: id only under `other/subagents/child.jsonl` **and** top-level `child/child.jsonl` → `rescanParentSession(… sessionId: child)` returns `null`

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement + export scanner helpers as needed**

Prefer moving `buildState` / `collectMirroredSubagentIds` / terminal loop into exported functions used by both `scanProjects` and incremental (avoid drift).

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/incremental-scan.ts cursor-watch/src/scanner.ts cursor-watch/tests/incremental-scan.test.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): rescan a single parent session for incremental updates

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 6: incremental-scan — live patch + project shell refresh

**Files:**
- Modify: `cursor-watch/src/incremental-scan.ts`
- Modify: `cursor-watch/tests/incremental-scan.test.ts`

**Interfaces:**
- Produces:

```ts
export function applyLivePatch(opts: {
  conversationId: string;
  store: SessionStore;
  caches: ScanCaches;
  homeDir: string;
  now?: number;
}): "upserted" | "missing" | "removed";

export function rescanProjectShells(opts: {
  projectsDir: string;
  projectKey: string;
  store: SessionStore;
  caches: ScanCaches;
  homeDir: string;
  now?: number;
}): void;
```

`applyLivePatch`:

- Find session in store by id; if missing, return `"missing"` (optionally schedule full scan — leave to watcher).
- Read live file `liveDir(home)/<id>.json` (missing snap = undefined).
- `mergeSessionExtras({...session without live fields reset}, header, snap, now)` then `store.upsert`.
- If after merge the session would fail display filters (reuse same predicate as aggregator visibility: e.g. export `isSessionVisible(s, now)` from `aggregator.ts`), `store.remove(id)` and return `"removed"`.

`rescanProjectShells`:

- `readProjectShellFlags` for project  
- For each store session with `projectKey`, re-run **status inference only** is hard without re-parse; **simpler approach matching spec:** call `rescanParentSession` for each session id in that project currently in the store (and upsert/remove). Acceptable for small N (Top display ≪ all).

- [ ] **Step 1: Tests**

- Live: session in store, write live json with recent `lastLiveAt`, `applyLivePatch` → `live === true` / status running  
- Shell: terminal without `exit_code` in fixture project → after `rescanProjectShells`, parent status becomes `running` when activity within windows (control timestamps in fixture)

- [ ] **Step 2–4: RED / implement / GREEN**

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/incremental-scan.ts cursor-watch/tests/incremental-scan.test.ts cursor-watch/src/aggregator.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): incremental live patch and per-project shell refresh

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 7: Watcher — route events, debounce queue, full-scan interval

**Files:**
- Modify: `cursor-watch/src/watcher.ts`
- Modify: `cursor-watch/tests/` — add `tests/watcher-incremental.test.ts` if feasible with mocked chokidar; otherwise keep logic in a testable `createRefreshController` extracted from watcher

**Interfaces:**
- Prefer extract:

```ts
// src/refresh-controller.ts
export function createRefreshController(opts: {
  projectsDir: string;
  homeDir: string;
  store: SessionStore;
  caches: ScanCaches;
  runFullScan: () => void; // existing fork wrapper
  now?: () => number;
}): {
  onFsEvent: (event: string, filePath: string) => void;
  start: () => void; // schedule initial full + interval
  close: () => void;
};
```

Behavior:

1. `start`: `runFullScan()` immediately; `setInterval(runFullScan, FULL_SCAN_INTERVAL_MS)`  
2. `onFsEvent`: `classifyWatchPath`;  
   - `unknown` → `scheduleFullScan()` (debounced separately, e.g. 300ms, coalesce)  
   - else enqueue work key:
     - transcript_main → key `session:<projectKey>:<sessionId>`  
     - transcript_subagent → key `session:<projectKey>:<parentId>`  
     - terminal → key `shell:<projectKey>`  
     - live → key `live:<conversationId>`  
   - trailing debounce `INCREMENTAL_DEBOUNCE_MS` per key  
3. On flush: if `fullScanInFlight`, push keys to `pendingIncrementalKeys`; return  
4. Execute incremental:
   - session → `rescanParentSession`; null → `store.remove(sessionId)` else `upsert`  
   - shell → `rescanProjectShells`  
   - live → `applyLivePatch`  
   - try/catch → log + `scheduleFullScan()`  
5. Full scan completion (`replaceAll`): clear in-flight; if pending keys, re-schedule their debounce flush  
6. Chokidar: change `watcher.on("all", (event, p) => controller.onFsEvent(event, p))` instead of always `schedule()` full refresh  
7. Keep `awaitWriteFinish` as today  

Generation token (optional but recommended): increment `scanGeneration` on each `replaceAll`; incremental captures generation at start and aborts upsert if generation changed mid-flight.

- [ ] **Step 1: Unit-test controller with fake `runFullScan` / fake timers**

```ts
vi.useFakeTimers();
// emit two live events for same id within 80ms → only one apply
```

- [ ] **Step 2: RED**

- [ ] **Step 3: Implement controller + wire `watcher.ts`**

- [ ] **Step 4: GREEN + `npx vitest run` (full suite)**

Expected: all existing tests still PASS

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/watcher.ts cursor-watch/src/refresh-controller.ts cursor-watch/tests/watcher-incremental.test.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): wire incremental refresh with debounced path routing

Keep forked full scans on startup and every five minutes as a correctness backstop.

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 8: Manual verification + spec status

**Files:**
- Modify: `.scratch/specs/2026-07-20-cursor-watch-incremental-scan-design.md` — set `状态：已实现` (or `已落地`) after verification

- [ ] **Step 1: Restart daemon**

```bash
cd cursor-watch && npx cursor-watch stop && npx cursor-watch open
```

Wait until `/api/sessions` non-empty.

- [ ] **Step 2: Transcript latency**

Append a line to an active session jsonl (or trigger Agent tool). Confirm card progress / status updates in **≤2s** (stopwatch). Note: first full scan on boot may still take ~15s.

- [ ] **Step 3: Live latency**

Touch `~/.cursor-watch/live/<id>.json` with fresh `lastLiveAt`. Confirm LIVE within **≤2s**.

- [ ] **Step 4: Regression**

`cd cursor-watch && npx vitest run` — all green.

- [ ] **Step 5: Commit doc status if updated**

```bash
git add .scratch/specs/2026-07-20-cursor-watch-incremental-scan-design.md
git commit -m "$(cat <<'EOF'
docs: mark incremental scan spec as implemented

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

## Self-Review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Event routing + in-memory patch | 2, 5, 6, 7 |
| Status + progress near-real-time (C) | 5 (recentMessages), 6 (live), 7 |
| Startup full scan | 7 |
| Periodic full scan 5–10 min (use 5) | 3, 7 |
| Store upsert/remove | 1 |
| Headers/workspace cache | 4 |
| Debounce 50–100ms (use 80) | 3, 7 |
| Queue across full scan | 7 |
| Unknown/error → full scan | 7 |
| Mirrored subagent not promoted | 5 |
| WS full array unchanged | 1/7 (notify getSessions) |
| Tests: classify, upsert/remove, incremental, mirror | 1, 2, 5 |
| Non-goals (terminal→chat, token stream) | not scheduled |

Placeholder scan: none intentional.  
Types: `WatchPathKind`, `ScanCaches`, `rescanParentSession`, `applyLivePatch`, `rescanProjectShells`, `createRefreshController` used consistently across tasks.

---

## Execution Handoff

Plan complete and saved to `.scratch/plans/2026-07-20-cursor-watch-incremental-scan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with executing-plans checkpoints  

Which approach?

