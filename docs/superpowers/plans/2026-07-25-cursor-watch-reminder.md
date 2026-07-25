# cursor-watch Reminder-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Reminder the product primary job: on Effective turn end (hooks `stop` and not Active loop), coalesce a pending reminder, fire a (default-silent) OS notification, and show an inbox-first panel with ack via panel or notification deep link.

**Architecture:** Extend hooks `preToolUse` to append Loop ledger entries when the shell command looks like a `/loop` sentinel. On live `stop`, the daemon checks Active loop via process-table matching against the ledger; if clear, upsert `~/.cursor-watch/reminders.json` and notify. Fastify exposes reminders API + WS; the web UI puts the inbox above the existing session list.

**Tech Stack:** Existing TypeScript / Vitest / Fastify / chokidar; vanilla `src/web/*`; macOS notification via injectable `osascript` (or equivalent) wrapper.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-25-cursor-watch-reminder-design.md`
- ADR: `docs/adr/0001-reminder-over-attention.md`
- Glossary: `CONTEXT.md`
- Trigger = Turn end (hooks `stop`), **not** unread
- Active loop = sentinel process still alive for that `conversationId` (`AGENT_LOOP_TICK_` / `AGENT_LOOP_WAKE_`); never “any loop in project suppresses all chats”
- Delivery = OS notification + panel inbox; ack = panel open/confirm **or** notification click
- Coalesce per `conversationId` while `pending`
- Notification deep link → panel with `?conversationId=` (or hash); open Cursor workspace secondary
- Inbox-first layout; attention/workspace modes may remain secondary
- Hooks gate: no OS Reminder without hooks; `open` does **not** auto-install hooks
- Notification sound default **`false`** (silent banner); opt-in in prefs
- No focus-based suppression (multi Cursor / multi monitor)
- Working directory for code: `cursor-watch/`; docs under repo root
- Commits: English conventional commits + blank line + `Co-Authored-By: Cursor <zhangchengk@yonyou.com>`
- TDD: failing test → implement → pass → commit per task
- Prefer injectable ports for process listing and OS notify so unit tests never spawn real UI dialogs

---

## File Structure

```text
cursor-watch/
├── src/
│   ├── constants.ts              # MODIFY: reminder/ledger path helpers; sentinel markers
│   ├── types.ts                  # MODIFY: ReminderRecord (or reminders/types.ts)
│   ├── reminders/
│   │   ├── types.ts              # NEW: ReminderRecord, ReminderStatus
│   │   ├── store.ts              # NEW: load/save/upsertPending/ack; coalesce
│   │   ├── notify.ts             # NEW: notifyReminder(prefs, record) — injectable runner
│   │   └── pipeline.ts           # NEW: onEffectiveTurnEnd({…}) orchestration
│   ├── loop-ledger/
│   │   ├── types.ts              # NEW: LoopLedgerEntry
│   │   ├── store.ts              # NEW: ~/.cursor-watch/loop-ledger.json
│   │   ├── detect.ts             # NEW: isLoopSentinelCommand(cmd)
│   │   └── active.ts             # NEW: isActiveLoop(conversationId, deps)
│   ├── prefs.ts                  # NEW: ~/.cursor-watch/prefs.json (notificationSound)
│   ├── hooks/cursor-watch-observe.mjs  # MODIFY: ledger write on sentinel preToolUse
│   ├── live-store.ts             # keep stop→stoppedAt; no reminder logic here
│   ├── refresh-controller.ts     # MODIFY: on live stop path → pipeline (or wire in applyLivePatch)
│   ├── incremental-scan.ts       # MODIFY: after applyLivePatch stop, call pipeline
│   ├── server.ts                 # MODIFY: reminders API + WS type reminders
│   ├── daemon.ts                 # MODIFY: pass reminder deps if needed
│   └── web/
│       ├── index.html            # MODIFY: inbox section markup
│       ├── styles.css            # MODIFY: inbox styles
│       ├── app.js                # MODIFY: Inbox-first render; ack; deep link
│       └── prefs.js              # MODIFY or keep UI prefs separate from daemon prefs
└── tests/
    ├── reminders-store.test.ts
    ├── reminders-pipeline.test.ts
    ├── loop-ledger.test.ts
    ├── prefs.test.ts
    ├── notify.test.ts
    ├── server.test.ts            # MODIFY: reminders routes
    └── hooks-install.test.ts     # MODIFY if observe script behavior asserted
```

---

### Task 1: Reminder types + file store (coalesce / ack)

**Files:**
- Create: `cursor-watch/src/reminders/types.ts`
- Create: `cursor-watch/src/reminders/store.ts`
- Modify: `cursor-watch/src/constants.ts` — `remindersFile(home)`, `REMINDER_NOTIFY_ID_PREFIX = "cursor-watch-reminder-"`
- Test: `cursor-watch/tests/reminders-store.test.ts`

**Interfaces:**
- Produces:
  - `type ReminderStatus = "pending" | "acked"`
  - `interface ReminderRecord { conversationId: string; projectKey?: string; workspacePath?: string; workspaceLabel?: string; chatName?: string; turnedEndedAt: number; summary: string; status: ReminderStatus; ackedAt?: number; notifyId: string }`
  - `loadReminders(home): ReminderRecord[]`
  - `upsertPendingReminder(home, partial): ReminderRecord` — same `conversationId` while pending → update `turnedEndedAt`/`summary`/meta; set `notifyId` to `` `${REMINDER_NOTIFY_ID_PREFIX}${conversationId}` ``
  - `ackReminder(home, conversationId, at?: number): ReminderRecord | null` — pending→acked and **remove from pending list** (delete or filter; pending getters exclude acked)
  - `listPendingReminders(home): ReminderRecord[]`

- [ ] **Step 1: Write failing tests** for coalesce (two upserts → one pending), ack removes from pending, notifyId stable

- [ ] **Step 2: Run** `cd cursor-watch && npx vitest run tests/reminders-store.test.ts` — expect FAIL (module missing)

- [ ] **Step 3: Implement** types + JSON file store under `stateDir()/reminders.json`

- [ ] **Step 4: Run tests** — expect PASS

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/reminders cursor-watch/src/constants.ts cursor-watch/tests/reminders-store.test.ts
git commit -m "$(cat <<'EOF'
feat(cursor-watch): add reminder file store with coalesce and ack

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 2: Loop sentinel detect + ledger store

**Files:**
- Create: `cursor-watch/src/loop-ledger/types.ts`
- Create: `cursor-watch/src/loop-ledger/detect.ts`
- Create: `cursor-watch/src/loop-ledger/store.ts`
- Modify: `cursor-watch/src/constants.ts` — `LOOP_SENTINEL_MARKERS = ["AGENT_LOOP_TICK_", "AGENT_LOOP_WAKE_"]`, `loopLedgerFile(home)`, optional `CURSOR_WATCH_CONVERSATION_ID` env name constant
- Test: `cursor-watch/tests/loop-ledger.test.ts`

**Interfaces:**
- Produces:
  - `isLoopSentinelCommand(command: string): boolean`
  - `fingerprintCommand(command: string): string` (normalize whitespace, truncate)
  - `interface LoopLedgerEntry { conversationId: string; seenAt: number; commandFingerprint: string; markedConversationId?: string }`
  - `recordLoopLedgerEntry(home, entry): void`
  - `listLoopLedger(home): LoopLedgerEntry[]`
  - `clearLoopLedgerEntry(home, conversationId): void`

- [ ] **Step 1: Failing tests** — detect markers; reject unrelated shell; record/list/clear

- [ ] **Step 2: Run** vitest — FAIL

- [ ] **Step 3: Implement**

- [ ] **Step 4: PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(cursor-watch): add loop ledger store and sentinel command detect

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 3: `isActiveLoop` (process table match)

**Files:**
- Create: `cursor-watch/src/loop-ledger/active.ts`
- Test: `cursor-watch/tests/loop-active.test.ts`

**Interfaces:**
- Consumes: ledger store + detect markers
- Produces:
  - `type ProcessRow = { pid: number; command: string }`
  - `isActiveLoop(opts: { homeDir: string; conversationId: string; listProcesses?: () => ProcessRow[]; now?: number }): boolean`
- Matching rules (spec):
  1. If ledger entry has `markedConversationId` / argv contains `CURSOR_WATCH_CONVERSATION_ID=<id>` → match those processes only
  2. Else: any process whose `command` includes a sentinel marker **and** (command includes fingerprint substring **or** entry `seenAt` within last e.g. 24h for that conversationId — keep rule simple and documented in test names)
  3. **Never** return true solely because another conversation in the same project has a loop

- [ ] **Step 1: Failing tests** with fake `listProcesses` — active / inactive / wrong conversation / marked env

- [ ] **Step 2–4: Implement with injectable `listProcesses` (default: `ps -ax -o pid=,command=` parse on macOS)**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(cursor-watch): detect active loop via process table and ledger

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 4: Daemon prefs (`notificationSound`)

**Files:**
- Create: `cursor-watch/src/prefs.ts`
- Modify: `cursor-watch/src/constants.ts` — `prefsFile(home)`
- Test: `cursor-watch/tests/prefs.test.ts`

**Interfaces:**
- Produces: `interface WatchPrefs { notificationSound: boolean }`, `DEFAULT_WATCH_PREFS = { notificationSound: false }`, `loadWatchPrefs(home)`, `saveWatchPrefs(home, prefs)`

- [ ] **Step 1–5: TDD + commit** — default sound false; round-trip save

```bash
git commit -m "$(cat <<'EOF'
feat(cursor-watch): add daemon prefs with silent notifications by default

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 5: OS notify port (injectable)

**Files:**
- Create: `cursor-watch/src/reminders/notify.ts`
- Test: `cursor-watch/tests/notify.test.ts`

**Interfaces:**
- Produces:
  - `notifyReminder(opts: { record: ReminderRecord; sound: boolean; panelUrl: string; run?: (argv: string[]) => void }): void`
  - Default `run` builds `osascript` display notification with title=chatName, subtitle/summary, and opens `panelUrl` with `?conversationId=` on click **if** feasible via osascript; if click-open is hard on plain osascript, document: notification body includes URL and panel polls deep link on focus — **prefer** `open panelUrl` via a small helper script invoked from notification if needed
  - Tests assert `run` called with expected strings when sound false/true; never call real osascript in CI

- [ ] **Step 1–5: TDD + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(cursor-watch): add injectable macOS reminder notifier

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 6: Reminder pipeline (`onEffectiveTurnEnd`)

**Files:**
- Create: `cursor-watch/src/reminders/pipeline.ts`
- Test: `cursor-watch/tests/reminders-pipeline.test.ts`

**Interfaces:**
- Consumes: reminder store, `isActiveLoop`, prefs, notify
- Produces:
  - `onEffectiveTurnEnd(opts: { homeDir: string; conversationId: string; session?: Pick<SessionState,…>; liveHint?: string; notify?: typeof notifyReminder; isActiveLoop?: …; now?: number }): "suppressed" | "upserted"`
  - If `isActiveLoop` → return `"suppressed"` (no upsert, no notify)
  - Else upsert pending + notify once (coalesce still one notifyId)

- [ ] **Step 1: Tests** — suppress when active loop; upsert+notify when not; second call coalesces single pending

- [ ] **Step 2–4: Implement**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(cursor-watch): add effective-turn-end reminder pipeline

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 7: Wire pipeline on live stop + hooks ledger write

**Files:**
- Modify: `cursor-watch/src/hooks/cursor-watch-observe.mjs` — on `preToolUse`, if sentinel command, append ledger JSON (fail-open)
- Modify: `cursor-watch/src/incremental-scan.ts` `applyLivePatch` — when snap becomes turnEnded (stoppedAt set) and previously not, call `onEffectiveTurnEnd` with session meta from store
- Modify: `cursor-watch/tests/hooks-install.test.ts` and/or new `tests/observe-ledger.test.ts` for sentinel write
- Modify: `cursor-watch/tests/incremental-scan.test.ts` — stop without loop → reminder file pending; with fake active loop → no reminder

**Interfaces:**
- Hook ledger write must not require TypeScript build (keep `.mjs` self-contained or shared JSON schema only)
- `applyLivePatch` remains return type `"upserted" | "missing" | "removed"`; reminder side effects are additional

- [ ] **Step 1: Failing tests** for observe sentinel → ledger entry; applyLivePatch stop → pipeline

- [ ] **Step 2: Implement hook + wire**

- [ ] **Step 3: Full related vitest PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(cursor-watch): record loop ledger in hooks and remind on stop

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 8: Reminders HTTP API + WS broadcast

**Files:**
- Modify: `cursor-watch/src/server.ts`
- Create or extend a small `ReminderHub` / reuse file store + subscribe pattern (lightweight EventEmitter or mirror SessionStore pattern)
- Test: `cursor-watch/tests/server.test.ts`

**Interfaces:**
- `GET /api/reminders` → `listPendingReminders`
- `POST /api/reminders/:conversationId/ack` → ack + return `{ ok: true }`
- `GET /api/prefs` / `PUT /api/prefs` for `notificationSound` (optional in this task; if deferred, keep sound read-only default until Task 8b — **do prefs GET/PUT here** to avoid UI without backend)
- WS: on reminder change send `{ type: "reminders", payload: ReminderRecord[] }` in addition to sessions (clients handle both)
- `GET /api/hooks-status` **or** reuse existing hooks status if already exposed — panel needs `hooks installed?`; if missing, add `GET /api/hooks-status` wrapping `hooksStatus()`

- [ ] **Step 1–5: TDD routes + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(cursor-watch): expose reminders and prefs APIs over HTTP/WS

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 9: Inbox-first web UI + ack + deep link

**Files:**
- Modify: `cursor-watch/src/web/index.html` — `#inbox` section above `#list`
- Modify: `cursor-watch/src/web/styles.css`
- Modify: `cursor-watch/src/web/app.js` — fetch reminders; render inbox; ack button; on boot read `URLSearchParams conversationId` → select + `POST ack`; WS `reminders` handler; hooks CTA when not installed; sound toggle calling `PUT /api/prefs`
- Test: prefer pure helpers extracted to `web/inbox.js` + `tests/inbox.test.ts` for render/ack URL parsing if DOM-heavy app.js is hard to test

**Interfaces:**
- Deep link: `http://127.0.0.1:7423/?conversationId=<id>`
- Inbox empty state vs hooks CTA per spec §8.1
- Session list remains below (existing attention/workspace prefs OK as secondary)

- [ ] **Step 1: Helper tests** for deep-link parse / inbox model

- [ ] **Step 2: Implement UI**

- [ ] **Step 3: Manual smoke** (plan step): `npx cursor-watch open`, install hooks if needed, simulate stop — skip in CI

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(cursor-watch): inbox-first UI with reminder ack and deep links

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 10: Spec status + README touch-up

**Files:**
- Modify: `docs/superpowers/specs/2026-07-25-cursor-watch-reminder-design.md` — `状态：已实现` after verification
- Modify: root `README.md` / `README.en.md` — product one-liner: Reminder-first; mention hooks + `/loop` caveat briefly

- [ ] **Step 1: Run** `cd cursor-watch && npx vitest run` — all green

- [ ] **Step 2: Update docs**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs: mark reminder-first spec implemented and refresh README

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

## Self-Review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Reminder store coalesce/ack | 1 |
| Loop detect + ledger | 2 |
| Active loop process match | 3 |
| Silent-by-default prefs | 4 |
| OS notify injectable | 5 |
| Effective turn end pipeline | 6 |
| Hooks ledger + stop wire | 7 |
| API/WS + hooks status | 8 |
| Inbox-first UI + deep link | 9 |
| Docs | 10 |
| No project-wide loop suppress | 3 tests |
| No focus suppression | (no code path) |
| open 不自动装 hooks | unchanged; CTA only |

Placeholder scan: none intentional.  
Types: `ReminderRecord`, `LoopLedgerEntry`, `onEffectiveTurnEnd`, `isActiveLoop` used consistently.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-07-25-cursor-watch-reminder.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with executing-plans checkpoints  

Which approach?
