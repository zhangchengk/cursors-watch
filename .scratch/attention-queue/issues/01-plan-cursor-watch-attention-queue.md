# 01 — cursor-watch Attention Queue + Layered Retention Implementation Plan

**What to build:** Implement the work described in `.scratch/attention-queue/issues/00-spec-attention-queue.md` and the checklist below.

**Blocked by:** None — can start immediately (or follow task order inside checklist).

**Status:** done

**Parent:** `.scratch/attention-queue/issues/00-spec-attention-queue.md`

- [ ] Acceptance: behavior matches spec and CONTEXT.md
- [ ] Tests updated or added at agreed seams

## Implementation checklist (migrated plan)

# cursor-watch Attention Queue + Layered Retention Implementation Plan

**Goal:** Stop stale read/`turnEnded` sessions from lingering for hours, and replace the workspace group wall with a flat two-line attention queue.

**Architecture:** Server-side `isSessionVisible` becomes the single retention truth (unread forever; in-progress always; `turnEnded` read ≤30min via `turnEndedAt`; idle ≤15min). A 30s prune timer removes invisible rows from `SessionStore`. The web UI drops group headers and sorts a flat urgency list into two-line cards.

**Tech Stack:** Existing TypeScript / Vitest / Fastify / chokidar; vanilla `src/web/*` (no new UI framework).

## Global Constraints

- Spec: `.scratch/specs/2026-07-22-cursor-watch-attention-queue-design.md`
- `TURN_ENDED_KEEP_MS = 30 * 60 * 1000`
- `IDLE_KEEP_MS = 15 * 60 * 1000`
- `VISIBILITY_PRUNE_MS = 30_000`
- Remove or stop using `ACTIVE_WINDOW_MS` as the idle window (replace with `IDLE_KEEP_MS`)
- No “更多” / history section; no second client-side time filter
- API stays flat `SessionState[]`; WS payload unchanged
- macOS-only product boundary unchanged
- Working directory for code: `cursor-watch/`; plan/spec under repo root `.scratch/`
- Commits: English conventional commits + blank line + `Co-Authored-By: Cursor <zhangchengk@yonyou.com>`
- TDD: failing test → implement → pass → commit per task

---

## File Structure

```text
cursor-watch/
├── src/
│   ├── constants.ts              # MODIFY: IDLE/TURN_ENDED/PRUNE; drop ACTIVE_WINDOW role
│   ├── types.ts                  # MODIFY: turnEndedAt?: number
│   ├── aggregator.ts             # MODIFY: layered isSessionVisible
│   ├── live-state.ts             # MODIFY: set turnEndedAt from snap.stoppedAt
│   ├── incremental-scan.ts       # MODIFY: stripLiveFields also drops turnEndedAt
│   ├── visibility-prune.ts       # NEW: pruneInvisibleSessions(store, …)
│   ├── refresh-controller.ts     # MODIFY: start/clear prune interval
│   └── web/
│       ├── group-sessions.js     # REWRITE → attention sort helpers (keep filename OR rename)
│       ├── app.js                # MODIFY: flat list + two-line cards + empty state
│       └── styles.css            # MODIFY: drop group-header; two-line card
├── tests/
│   ├── types-smoke.test.ts       # MODIFY: new constants
│   ├── aggregator.test.ts        # MODIFY: visibility matrix
│   ├── live-state.test.ts        # MODIFY: turnEndedAt
│   ├── visibility-prune.test.ts  # NEW
│   └── group-sessions.test.ts    # REWRITE: sortAttentionSessions tests
```

**Note on `group-sessions.js`:** Prefer **rewrite in place** (same import path) exporting `sortAttentionSessions(sessions)` so `app.js` changes stay small. Delete `groupSessionsForUi` / `GROUP_TOP_N` / `hasReminder` behavior.

---

### Task 1: Constants + `turnEndedAt` type

**Files:**
- Modify: `cursor-watch/src/constants.ts`
- Modify: `cursor-watch/src/types.ts`
- Modify: `cursor-watch/tests/types-smoke.test.ts`

**Interfaces:**
- Produces:
  - `TURN_ENDED_KEEP_MS: number` (= `30 * 60 * 1000`)
  - `IDLE_KEEP_MS: number` (= `15 * 60 * 1000`)
  - `VISIBILITY_PRUNE_MS: number` (= `30_000`)
  - `SessionState.turnEndedAt?: number`
  - Remove export/use of `ACTIVE_WINDOW_MS` (delete constant); remove `GROUP_TOP_N` if unused after Task 5 (can remove in Task 5 — for this task only remove `ACTIVE_WINDOW_MS` after aggregator still imports it until Task 2; **in Task 1 add new constants alongside `ACTIVE_WINDOW_MS`, Task 2 deletes `ACTIVE_WINDOW_MS`**)

- [ ] **Step 1: Write the failing test**

In `tests/types-smoke.test.ts`, replace `ACTIVE_WINDOW_MS` expectations with:

```ts
import {
  IDLE_KEEP_MS,
  TURN_ENDED_KEEP_MS,
  VISIBILITY_PRUNE_MS,
} from "../src/constants.js";

it("exports layered retention constants", () => {
  expect(TURN_ENDED_KEEP_MS).toBe(30 * 60 * 1000);
  expect(IDLE_KEEP_MS).toBe(15 * 60 * 1000);
  expect(VISIBILITY_PRUNE_MS).toBe(30_000);
});
```

(Keep other existing smoke asserts that still apply.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cursor-watch && npx vitest run tests/types-smoke.test.ts`

Expected: FAIL — exports missing

- [ ] **Step 3: Minimal implementation**

Add to `constants.ts` (keep `ACTIVE_WINDOW_MS` until Task 2):

```ts
export const TURN_ENDED_KEEP_MS = 30 * 60 * 1000;
export const IDLE_KEEP_MS = 15 * 60 * 1000;
export const VISIBILITY_PRUNE_MS = 30_000;
```

Add to `SessionState` in `types.ts`:

```ts
  turnEnded?: boolean;
  /** When turnEnded became true (live snapshot stoppedAt); used for retention. */
  turnEndedAt?: number;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cursor-watch && npx vitest run tests/types-smoke.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/constants.ts cursor-watch/src/types.ts cursor-watch/tests/types-smoke.test.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): add retention constants and turnEndedAt field

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 2: Layered `isSessionVisible`

**Files:**
- Modify: `cursor-watch/src/aggregator.ts`
- Modify: `cursor-watch/src/constants.ts` (delete `ACTIVE_WINDOW_MS`)
- Modify: `cursor-watch/tests/aggregator.test.ts`
- Modify: any remaining imports of `ACTIVE_WINDOW_MS` (grep)

**Interfaces:**
- Consumes: `TURN_ENDED_KEEP_MS`, `IDLE_KEEP_MS`, `SessionState.turnEndedAt`
- Produces: updated `isSessionVisible(s, now, workspaceExists?): boolean` per spec §4

- [ ] **Step 1: Write the failing tests**

Replace the old “ACTIVE_WINDOW” test in `aggregator.test.ts` with a matrix (keep workspace / subagent / sort tests, update idle timing):

```ts
import { IDLE_KEEP_MS, TURN_ENDED_KEEP_MS } from "../src/constants.js";
import { aggregateSessions, isSessionVisible } from "../src/aggregator.js";

describe("isSessionVisible layered retention", () => {
  const now = 1_000_000;
  const pathOk = () => true;

  it("keeps unread forever", () => {
    expect(
      isSessionVisible(
        sess({
          id: "u",
          status: "waiting",
          hasUnread: true,
          lastActivityAt: now - 10 * 60 * 60 * 1000,
        }),
        now,
        pathOk,
      ),
    ).toBe(true);
  });

  it("keeps live / running / subagent / error", () => {
    expect(
      isSessionVisible(sess({ id: "l", status: "idle", live: true, lastActivityAt: now - 9e9 }), now, pathOk),
    ).toBe(true);
    expect(
      isSessionVisible(sess({ id: "r", status: "running", lastActivityAt: now - 9e9 }), now, pathOk),
    ).toBe(true);
    expect(
      isSessionVisible(sess({ id: "e", status: "error", lastActivityAt: now - 9e9 }), now, pathOk),
    ).toBe(true);
  });

  it("keeps turnEnded read only within TURN_ENDED_KEEP_MS", () => {
    const base = {
      id: "t",
      status: "idle" as const,
      hasUnread: false,
      turnEnded: true,
      lastActivityAt: now - 9e9,
    };
    expect(
      isSessionVisible(
        sess({ ...base, turnEndedAt: now - TURN_ENDED_KEEP_MS + 1_000 }),
        now,
        pathOk,
      ),
    ).toBe(true);
    expect(
      isSessionVisible(
        sess({ ...base, turnEndedAt: now - TURN_ENDED_KEEP_MS - 1 }),
        now,
        pathOk,
      ),
    ).toBe(false);
  });

  it("falls back to lastActivityAt when turnEndedAt missing", () => {
    expect(
      isSessionVisible(
        sess({
          id: "t2",
          status: "idle",
          turnEnded: true,
          hasUnread: false,
          lastActivityAt: now - TURN_ENDED_KEEP_MS + 1_000,
        }),
        now,
        pathOk,
      ),
    ).toBe(true);
  });

  it("drops plain idle older than IDLE_KEEP_MS", () => {
    expect(
      isSessionVisible(
        sess({
          id: "old",
          status: "idle",
          lastActivityAt: now - IDLE_KEEP_MS - 1,
        }),
        now,
        pathOk,
      ),
    ).toBe(false);
    expect(
      isSessionVisible(
        sess({
          id: "fresh",
          status: "idle",
          lastActivityAt: now - IDLE_KEEP_MS + 1_000,
        }),
        now,
        pathOk,
      ),
    ).toBe(true);
  });
});
```

Update `aggregateSessions` “drops sessions colder…” test: waiting without unread older than `IDLE_KEEP_MS` should drop; unread-old still kept; “wait-fresh” must be within `IDLE_KEEP_MS` (e.g. `now - 5 * 60 * 1000`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cursor-watch && npx vitest run tests/aggregator.test.ts`

Expected: FAIL — old 1h behavior / missing live branch

- [ ] **Step 3: Minimal implementation**

Replace `isSessionVisible` body in `aggregator.ts`:

```ts
import { IDLE_KEEP_MS, TURN_ENDED_KEEP_MS } from "./constants.js";

export function isSessionVisible(
  s: SessionState,
  now: number,
  workspaceExists: (workspacePath: string) => boolean = workspaceDirExists,
): boolean {
  if (!workspaceExists(s.workspacePath)) return false;
  if (s.hasUnread) return true;
  if (s.live || s.status === "running" || s.status === "subagent" || s.status === "error") {
    return true;
  }
  if (s.turnEnded) {
    const endedAt = s.turnEndedAt ?? s.lastActivityAt;
    return now - endedAt <= TURN_ENDED_KEEP_MS;
  }
  return now - s.lastActivityAt <= IDLE_KEEP_MS;
}
```

Delete `ACTIVE_WINDOW_MS` from `constants.ts`. Grep and fix leftovers.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cursor-watch && npx vitest run tests/aggregator.test.ts tests/types-smoke.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/aggregator.ts cursor-watch/src/constants.ts cursor-watch/tests/aggregator.test.ts cursor-watch/tests/types-smoke.test.ts
git commit -m "$(cat <<'EOF'
fix(cursor-watch): apply layered session visibility retention

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 3: Persist `turnEndedAt` from live snapshots

**Files:**
- Modify: `cursor-watch/src/live-state.ts`
- Modify: `cursor-watch/src/incremental-scan.ts` (`stripLiveFields`)
- Modify: `cursor-watch/tests/live-state.test.ts`

**Interfaces:**
- Consumes: `LiveSnapshot.stoppedAt`
- Produces: `applyLiveToSession` sets `turnEndedAt` when `turnEnded`; clears/omits when not ended

- [ ] **Step 1: Write the failing test**

Append to `live-state.test.ts`:

```ts
it("sets turnEndedAt from snapshot stoppedAt", () => {
  const s = applyLiveToSession(
    baseSession({ status: "running", hasUnread: false }),
    snap({ lastEvent: "stop", stoppedAt: 1_000_050, lastLiveAt: 1_000_000 }),
    1_000_100,
  );
  expect(s.turnEnded).toBe(true);
  expect(s.turnEndedAt).toBe(1_000_050);
  expect(s.status).toBe("idle");
});

it("clears turnEndedAt when not turnEnded", () => {
  const s = applyLiveToSession(
    baseSession({ turnEnded: true, turnEndedAt: 99, status: "idle" }),
    snap({ lastLiveAt: 1_000_000, stoppedAt: null }),
    1_000_100,
  );
  expect(s.turnEnded).toBe(false);
  expect(s.turnEndedAt).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cursor-watch && npx vitest run tests/live-state.test.ts`

Expected: FAIL — `turnEndedAt` undefined

- [ ] **Step 3: Minimal implementation**

In `applyLiveToSession` return object:

```ts
  return {
    ...session,
    status,
    live: flags.live,
    turnEnded: flags.turnEnded,
    turnEndedAt: flags.turnEnded
      ? (snap?.stoppedAt ?? session.turnEndedAt ?? session.lastActivityAt)
      : undefined,
    liveHint: flags.liveHint ?? session.liveHint,
  };
```

In `incremental-scan.ts` `stripLiveFields`:

```ts
  const { live: _l, turnEnded: _t, turnEndedAt: _ta, liveHint: _h, ...rest } = session;
  return rest;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cursor-watch && npx vitest run tests/live-state.test.ts tests/incremental-scan.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/live-state.ts cursor-watch/src/incremental-scan.ts cursor-watch/tests/live-state.test.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): persist turnEndedAt from live stop snapshots

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 4: Visibility prune timer

**Files:**
- Create: `cursor-watch/src/visibility-prune.ts`
- Create: `cursor-watch/tests/visibility-prune.test.ts`
- Modify: `cursor-watch/src/refresh-controller.ts`

**Interfaces:**
- Produces:
  - `pruneInvisibleSessions(opts: { store: SessionStore; now?: number; workspaceExists?: (p: string) => boolean }): number` — returns number removed
- `createRefreshController` `start()` begins `setInterval(prune, VISIBILITY_PRUNE_MS)`; `close()` clears it
- On prune error: `console.error`, do not throw out of interval

- [ ] **Step 1: Write the failing test**

`tests/visibility-prune.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { IDLE_KEEP_MS } from "../src/constants.js";
import { SessionStore } from "../src/store.js";
import type { SessionState } from "../src/types.js";
import { pruneInvisibleSessions } from "../src/visibility-prune.js";

function sess(p: Partial<SessionState> & Pick<SessionState, "id">): SessionState {
  return {
    projectKey: "p",
    workspacePath: "/w",
    workspaceLabel: "w",
    status: "idle",
    summary: "s",
    currentAction: "a",
    lastActivityAt: Date.now(),
    subagentCount: 0,
    subagentRunning: 0,
    transcriptPath: "/t",
    recentMessages: [],
    ...p,
  };
}

describe("pruneInvisibleSessions", () => {
  it("removes stale idle and keeps unread", () => {
    const now = 1_000_000;
    const store = new SessionStore();
    store.replaceAll([
      sess({ id: "old", lastActivityAt: now - IDLE_KEEP_MS - 1 }),
      sess({
        id: "unread",
        status: "waiting",
        hasUnread: true,
        lastActivityAt: now - 9e9,
      }),
    ]);
    const n = pruneInvisibleSessions({
      store,
      now,
      workspaceExists: () => true,
    });
    expect(n).toBe(1);
    expect(store.getSessions().map((s) => s.id)).toEqual(["unread"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cursor-watch && npx vitest run tests/visibility-prune.test.ts`

Expected: FAIL — module missing

- [ ] **Step 3: Minimal implementation**

`visibility-prune.ts`:

```ts
import { isSessionVisible, workspaceDirExists } from "./aggregator.js";
import type { SessionStore } from "./store.js";

export function pruneInvisibleSessions(opts: {
  store: SessionStore;
  now?: number;
  workspaceExists?: (workspacePath: string) => boolean;
}): number {
  const now = opts.now ?? Date.now();
  const workspaceExists = opts.workspaceExists ?? workspaceDirExists;
  let removed = 0;
  for (const s of opts.store.getSessions()) {
    if (!isSessionVisible(s, now, workspaceExists)) {
      opts.store.remove(s.id);
      removed += 1;
    }
  }
  return removed;
}
```

In `refresh-controller.ts`:

- import `VISIBILITY_PRUNE_MS`, `pruneInvisibleSessions`
- `let pruneTimer: ReturnType<typeof setInterval> | null = null`
- in `start()` after full-scan interval:

```ts
    pruneTimer = setInterval(() => {
      try {
        pruneInvisibleSessions({ store: opts.store });
      } catch (err) {
        console.error("[cursor-watch] visibility prune failed", err);
      }
    }, VISIBILITY_PRUNE_MS);
```

- in `close()`: `if (pruneTimer) { clearInterval(pruneTimer); pruneTimer = null; }`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cursor-watch && npx vitest run tests/visibility-prune.test.ts tests/aggregator.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/visibility-prune.ts cursor-watch/tests/visibility-prune.test.ts cursor-watch/src/refresh-controller.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): prune invisible sessions on a 30s timer

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 5: Flat attention sort (replace group wall helpers)

**Files:**
- Modify: `cursor-watch/src/web/group-sessions.js` (rewrite exports)
- Modify: `cursor-watch/tests/group-sessions.test.ts` (rewrite)
- Modify: `cursor-watch/src/constants.ts` — delete `GROUP_TOP_N` if present

**Interfaces:**
- Produces:
  - `sortAttentionSessions(sessions: Array): Array` — new array, urgency sort
  - `urgencyBucket(s): 0 | 1 | 2` — 0 = live/running/subagent/error; 1 = unread/waiting; 2 = turnEnded read / other
  - Remove `groupSessionsForUi` (or keep as deprecated thin wrapper that throws — prefer delete and fix imports)

Sort rules (spec §5.1):

1. bucket 0 before 1 before 2  
2. within bucket: `(composerUpdatedAt ?? lastActivityAt)` descending  

- [ ] **Step 1: Write the failing tests**

Replace `group-sessions.test.ts` contents with:

```ts
import { describe, expect, it } from "vitest";
import { sortAttentionSessions, urgencyBucket } from "../src/web/group-sessions.js";

function s(partial) {
  return {
    id: "x",
    status: "idle",
    hasUnread: false,
    turnEnded: false,
    live: false,
    lastActivityAt: 0,
    workspaceLabel: "w",
    ...partial,
  };
}

describe("urgencyBucket", () => {
  it("ranks live/running before unread before turnEnded", () => {
    expect(urgencyBucket(s({ live: true }))).toBe(0);
    expect(urgencyBucket(s({ status: "running" }))).toBe(0);
    expect(urgencyBucket(s({ hasUnread: true, status: "waiting" }))).toBe(1);
    expect(urgencyBucket(s({ turnEnded: true, status: "idle" }))).toBe(2);
  });
});

describe("sortAttentionSessions", () => {
  it("orders LIVE before unread before turnEnded idle", () => {
    const out = sortAttentionSessions([
      s({ id: "t", turnEnded: true, lastActivityAt: 300 }),
      s({ id: "u", hasUnread: true, status: "waiting", lastActivityAt: 200 }),
      s({ id: "l", live: true, status: "running", lastActivityAt: 100 }),
    ]);
    expect(out.map((x) => x.id)).toEqual(["l", "u", "t"]);
  });

  it("orders same bucket by activity desc", () => {
    const out = sortAttentionSessions([
      s({ id: "a", hasUnread: true, status: "waiting", lastActivityAt: 1 }),
      s({ id: "b", hasUnread: true, status: "waiting", composerUpdatedAt: 50, lastActivityAt: 1 }),
    ]);
    expect(out.map((x) => x.id)).toEqual(["b", "a"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cursor-watch && npx vitest run tests/group-sessions.test.ts`

Expected: FAIL — exports missing / old API

- [ ] **Step 3: Minimal implementation**

Rewrite `group-sessions.js`:

```js
export function urgencyBucket(s) {
  if (
    s.live ||
    s.status === "running" ||
    s.status === "subagent" ||
    s.status === "error"
  ) {
    return 0;
  }
  if (s.hasUnread || s.status === "waiting") return 1;
  return 2;
}

function activityAt(s) {
  return s.composerUpdatedAt ?? s.lastActivityAt ?? 0;
}

export function sortAttentionSessions(sessions) {
  return [...(sessions || [])].sort((a, b) => {
    const d = urgencyBucket(a) - urgencyBucket(b);
    if (d !== 0) return d;
    return activityAt(b) - activityAt(a);
  });
}
```

Delete unused `formatStatusSummary` **only if** `app.js` no longer imports it (Task 6 will stop using it — for this task, keep exporting a no-op or leave `formatStatusSummary` until Task 6 deletes the import). **Keep** `formatStatusSummary` export for now to avoid breaking `app.js` mid-plan; Task 6 removes the import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cursor-watch && npx vitest run tests/group-sessions.test.ts`

Expected: PASS (app.js may still call deleted `groupSessionsForUi` — do **not** run full suite until Task 6, or temporarily re-export:

```js
export function groupSessionsForUi(sessions) {
  return [{ key: "", label: "", sessions: sortAttentionSessions(sessions), statusCounts: {}, totalCount: sessions?.length ?? 0 }];
}
```

Prefer the temporary shim so `npm test` stays green, then remove shim in Task 6.

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/web/group-sessions.js cursor-watch/tests/group-sessions.test.ts cursor-watch/src/constants.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): add flat attention urgency sort helpers

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 6: Two-line flat panel UI

**Files:**
- Modify: `cursor-watch/src/web/app.js`
- Modify: `cursor-watch/src/web/styles.css`
- Modify: `cursor-watch/src/web/group-sessions.js` (remove `groupSessionsForUi` shim if added)
- Optional: light DOM assertion via existing patterns only if present — otherwise manual check notes in commit body; prefer not adding Playwright unless already in repo

**Interfaces:**
- Consumes: `sortAttentionSessions` from `./group-sessions.js`
- Renders flat `#list` of `.card.attention` (two rows); empty state when `sessions.length === 0`

- [ ] **Step 1: Write the failing test (sort already covered) — document UI checklist as assertable class hooks**

If no HTML test harness exists, add a tiny pure helper test instead: extract `buildCardModel(s, now)` in `group-sessions.js` or `drawer-format.js` and unit-test title/subtitle fields. Minimal:

In `group-sessions.js`:

```js
export function attentionCardLines(s, now = Date.now()) {
  const title = s.chatName || s.summary || s.id;
  const ageBase =
    s.status === "waiting" ? s.waitingSince ?? s.lastActivityAt : s.lastActivityAt;
  const subtitle =
    (s.live && s.liveHint) || s.summary || s.currentAction || "";
  return {
    title,
    ageMs: Math.max(0, now - Number(ageBase || 0)),
    subtitle,
    workspaceLabel: s.workspaceLabel || "",
  };
}
```

Test in `group-sessions.test.ts`:

```ts
it("attentionCardLines prefers chatName and exposes workspaceLabel", () => {
  const lines = attentionCardLines({
    chatName: "T",
    summary: "sum",
    workspaceLabel: "idea/X",
    status: "idle",
    lastActivityAt: 1_000,
  }, 1_060_000);
  expect(lines.title).toBe("T");
  expect(lines.workspaceLabel).toBe("idea/X");
  expect(lines.ageMs).toBe(1_059_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cursor-watch && npx vitest run tests/group-sessions.test.ts`

Expected: FAIL — `attentionCardLines` missing

- [ ] **Step 3: Implement helper + rewrite `render()` in `app.js`**

1. Add `attentionCardLines` as above.  
2. Change import to `sortAttentionSessions` (drop `formatStatusSummary` / `groupSessionsForUi`).  
3. Replace `render(sessions)` list body with:

```js
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
    card.innerHTML = `
      <div class="summary-row">
        <div class="summary">${STATUS_ICON[s.status] ?? ""} ${escapeHtml(lines.title)} · ${formatDuration(lines.ageMs)}</div>
        ${openBtn}
      </div>
      <div class="card-sub">
        <div class="action">${liveBit}</div>
        <div class="workspace-tag">${escapeHtml(lines.workspaceLabel)}</div>
      </div>
      ${banner ? `<div class="completion">${escapeHtml(banner)}</div>` : ""}
    `;
    card.classList.toggle("is-live", Boolean(s.live));
    // same click/keydown/openInCursor handlers as today
    listEl.appendChild(card);
  }
```

Wire event listeners same as current loop (copy from existing card handlers).

4. CSS: remove/ignore `.group-header` / `.workspace-group` spacing; add:

```css
.card.attention { /* slightly tighter padding if needed */ }
.card-sub {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
  justify-content: space-between;
}
.workspace-tag {
  flex: 0 1 auto;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.65;
  font-size: 0.85em;
}
.empty-state {
  padding: 2rem 1rem;
  opacity: 0.7;
  text-align: center;
}
.live-inline { font-weight: 600; }
```

5. Delete `groupSessionsForUi` shim and unused `formatStatusSummary` / `GROUP_TOP_N`.

- [ ] **Step 4: Run full unit tests**

Run: `cd cursor-watch && npm test`

Expected: PASS

Manual smoke (implementer): `npx cursor-watch open` — no group headers; stale 40h white cards gone within ≤30s prune after deploy; unread/LIVE still listed.

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/web/app.js cursor-watch/src/web/styles.css cursor-watch/src/web/group-sessions.js cursor-watch/tests/group-sessions.test.ts cursor-watch/src/constants.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): render flat two-line attention queue

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 7: Spec status + README one-liner (optional but recommended)

**Files:**
- Modify: `.scratch/specs/2026-07-22-cursor-watch-attention-queue-design.md` — status → `已实现`
- Modify: root `README.md` / `README.en.md` — panel section: mention flat attention list + retention (unread / 30min turnEnded / 15min idle); remove “按工作区分组 / Top 4” claims

- [ ] **Step 1: Update docs to match shipped behavior** (no code test)

- [ ] **Step 2: Commit**

```bash
git add .scratch/specs/2026-07-22-cursor-watch-attention-queue-design.md README.md README.en.md
git commit -m "$(cat <<'EOF'
docs: mark attention-queue spec implemented and refresh README

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

## Self-Review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Layered visibility | Task 2 |
| `turnEndedAt` from live | Task 3 |
| Prune 30s | Task 4 |
| Flat urgency list | Task 5–6 |
| Two-line cards + workspace label | Task 6 |
| No “更多” | Task 6 (omission) |
| No client-side second filter | Task 6 |
| Unread forever / LIVE kept | Task 2 tests |
| Drop group wall / TopN turnEnded keep | Task 5–6 |
| README / prior group design superseded | Task 7 |

**Placeholder scan:** none intentional.  
**Type consistency:** `turnEndedAt?: number` on `SessionState`; prune uses `isSessionVisible`; UI uses `sortAttentionSessions` + `attentionCardLines`.

---

## Execution Handoff

Plan complete and saved to `.scratch/plans/2026-07-22-cursor-watch-attention-queue.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute in this session with executing-plans checkpoints  

Which approach?

