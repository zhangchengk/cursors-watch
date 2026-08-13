# Cursors Watch

[中文](./README.md)

Cursors Watch watches multiple local Cursor Agent sessions (npm package name remains `cursor-watch`). It does two primary jobs side by side:

1. Reminder: on Turn end it interrupts you with an OS notification or HUD, leaves one pending item in the panel inbox, and lists currently running sessions below.
2. Chat library: mark meaningful Agent chats as Todo or Archive, with optional titles/notes, local `.md` / `.html` attachments, and a separate arbitrarily nested machine-global folder tree per mark, so you can land the work later or present the chat live on this Mac.

Top-level tabs: `Reminder` (cold-start default) | `Todo` | `Archive`. A chat has at most one library mark (none / todo / archive), independent of whether a Reminder is pending. Marks are never inferred from unread or Turn end.

Reminders need hooks; opening the matching Agent chat needs the bridge extension. Both are default-installed and self-checked on App / `open`. While an Active `/loop` sentinel is still alive, hooks `stop` events are not treated as turn end. Panel `↗` opens the workspace then focuses the chat via the bridge (verified on Cursor 3.13.x; semi-internal API, may degrade to workspace-only + toast after major upgrades). It does not modify session content or orchestrate work for you.

It is not a task hub or remote monitoring tool, and it does not replace Cursor's sidebar. The library has no export or multi-user sync. It only reads local Cursor data (see below); reminders, library marks, and panel prefs live under `~/.cursor-watch/`; macOS only. The server binds to localhost and shows paths and message excerpts in the clear with no redaction, so do not expose the port to the network.

## Screenshots

While you work in Cursor, Cursors Watch interrupts with a system notification / HUD (no browser tab required):

![Cursors Watch reminder while working in Cursor](./docs/images/Cursors1.png)

Full panel: Reminder / Todo / Archive at the top; inside Reminder, pending inbox above and Running below; top bar has columns, status dots, sound, settings, and fullscreen:

![Cursors Watch panel: Reminder inbox and running sessions](./docs/images/Cursors2.png)

## Requirements

- macOS only (do not install on other platforms)
- Node.js ≥ 20 (needed to package / develop; the `.dmg` App embeds a runtime)
- Cursor installed on this Mac
- Scannable data appears under `~/.cursor/projects` after you have run Agent sessions locally (the panel may be empty with no Agent history)
- Fully local: no network or extra accounts required

## Install (recommended: menubar App)

Daily use is the informal Cursors Watch app (menu bar `CW`). You do not need to `npx` and open a browser every time.

```bash
git clone git@github.com:zhangchengk/cursors-watch.git
cd cursors-watch/cursor-watch
npm install
npm run package:dmg           # build a .dmg
# or install straight to Applications:
npm run package:app:install   # → /Applications/Cursors Watch.app
```

- DMG output: `macos/CursorWatch/dist/Cursors-Watch-<version>.dmg`  
  Open it and drag Cursors Watch into Applications. Unsigned; first launch may need Privacy & Security approval.
- After install, open from Applications: Open at Login defaults on (toggle in the menu); the shell starts the daemon and opens the panel.
- Reminder: prefers shell OS notifications; falls back to an in-shell HUD if permission is denied or delivery fails.
- If port `7423` already serves this product's daemon, the shell adopts it and opens the panel; only a foreign process on that port errors out.
- Opening the App / `cursor-watch open` self-checks and tries to install hooks and the bridge extension. To update, rebuild with `package:dmg` / `package:app:install`. No auto-update.
- Full Disk Access: on first launch, if not already granted, the shell asks once and opens System Settings → Privacy & Security → Full Disk Access (also available from the status-item menu). After that, per-folder Desktop/Documents prompts are usually unnecessary. The install script uses a stable local codesign identity (`~/.cursor-watch/codesign.keychain`) so reinstalls keep TCC grants.

User-facing name is Cursors Watch; technical ids stay `cursor-watch` / `com.cursor-watch.*`.

### Dev / CLI (optional)

This tool ships in a private repo. It is not on the npm registry. Do not run `npm i -g cursor-watch`.

```bash
cd cursors-watch/cursor-watch
npx cursor-watch open     # start daemon if needed, open panel in a browser
npx cursor-watch status
npx cursor-watch stop
npm link                  # optional: CLI from any directory
```

- Default panel: `http://127.0.0.1:7423` (`CURSOR_WATCH_PORT` overrides)
- Dev: `npm test`, `npm run dev`
- Debug shell without installing to Applications:

```bash
CURSOR_WATCH_ROOT="$PWD" open "macos/CursorWatch/dist/Cursors Watch.app"
```

### Hooks (optional; required for Reminders)

```bash
npx cursor-watch hooks install
npx cursor-watch hooks status
npx cursor-watch hooks uninstall
```

The panel works without hooks: "running" then comes mainly from transcripts and terminals, and may lag. With hooks you get LIVE snapshots, which enable Reminders (notify + inbox) and sharper "running" detection, still not millisecond telemetry. While an Active `/loop` sentinel is alive, tick-gap `stop` events are suppressed. Hook failures do not break Cursor.

## Reading the panel

- Top bar brand Cursors Watch; list column stepper (default 2; viewports under 720px force 1 column; **same N shared** by Reminder and Todo / Archive), status color counts, Sound (muted by default), settings gear, Fullscreen (`F`; native fullscreen inside the App).
- Three tabs: `Reminder` | `Todo` | `Archive`. Last selected tab is remembered locally; cold start still defaults to Reminder.
- Reminder tab: pending Reminder inbox on top (Turn end items that need your eyes; without hooks shows the install command; per-card Confirm or Confirm all; OS notification click can also ack). Running below lists only LIVE / `running` / `subagent`. Cards have a Library action to mark Todo / Archive (optional title, note, target-tree folder; no attachments or priority at mark time); marking does not switch tabs. `↗` opens the workspace and tries to focus the chat.
- Todo / Archive tabs: folder tree on the left (top item「全部」/ All = full tab), entry curation on the right. Stage header has **Collapse / Expand**: collapsed hides note and attachments, keeps title and action bar (remembered per folder; **default collapsed**; in compact, title clamps to 2 lines / meta to 1 with ellipsis, equal-height cards in a grid row). Archive stage also has **search**: filters the current folder view by title / chat name / note (substring, case-insensitive; cleared when leaving the Archive tab). Create/rename/delete folders, edit title and note, move todo↔archive (lands in target-tree All / unfiled; title/note/attachments kept; **Todo priority discarded**), unmark (discards title, note, attachments, priority, and folder). If the source chat is gone the entry stays and is marked stale; `↗` may fail with a toast.
- Todo priority: Todo curation only — mutually exclusive Urgent / Important / None (segmented control on the card; also editable in the edit dialog). Viewing All or a folder sorts urgent → important → none; within a tier the prior relative order is kept. Archive has no priority field.
- Library attachments: bind local `.md` / `.html` from Todo / Archive curation (absolute path refs, no content copy); `.md` gets read-only in-panel preview, `.html` opens in the system default browser; Finder reveal as a secondary action. If the file moves, the ref remains and preview/open shows unavailable.
- Settings (gear): four UI themes (Blueprint default, Phosphor, Ink, Brass); workspace aliases (known absolute path → short nickname, display-layer overlay in the panel, hover still shows the full path; notification/HUD copy does not resolve aliases in v1). Aliases live in machine prefs with sound; clearing the library does not delete them.
- Server retention still applies to the session snapshot: unread kept; in-progress always visible; read + turn-ended ~30 minutes; pure idle ~15 minutes. Top-bar dots count all sessions (including waiting / idle / error not listed under Running). Card titles prefer the Agent sidebar chat name, else the first user-message summary; library list rows prefer the library title.

## Architecture overview

```text
Cursors Watch.app (menubar shell)
        │  embeds Node + cursor-watch
        ▼
   daemon (default :7423)
        │
        ├─ watcher + scan-worker  ──read──►  ~/.cursor/projects
        │         │                    (transcripts / terminals)
        │         │              ──opt──►   ~/.cursor-watch/live (hooks)
        │         │              ──read──►  composerHeaders (chat name / unread)
        │         ▼
        │      SessionStore
        │         │
        ├─ ReminderHub / LibraryHub / prefs
        │         │              ──r/w──►   ~/.cursor-watch/
        │         │                    (reminders / library / prefs / …)
        │         ▼
        └─ Fastify: static UI + /api/* + /ws
                  │
                  ▼
         WKWebView panel (or browser)
                  │
         Reminder: shell OS notify → HUD fallback
```

Flow:

1. Open the App (or `cursor-watch open`) to start / adopt the daemon, self-check hooks and the bridge, then open the panel.
2. The watcher triggers scan-worker to infer session state into an in-memory store.
3. The UI uses `GET /api/sessions` + `/ws`; Reminder / library also push over WS; prefs use `/api/prefs`.
4. Before display, child sessions are folded in and retention rules trim the list. Library entries are not auto-deleted when sessions are pruned.

## Trust boundary

- HTTP/WebSocket bind to `127.0.0.1` only (default port `7423`).
- The panel shows workspace paths and message snippets in the clear, with no redaction.
- Do not expose the port to the internet or reverse-proxy it to other people.
- Read-only scope: scanning `~/.cursor/projects` and `composerHeaders` never writes session content back.
- Write exceptions: `hooks install` writes `~/.cursor/hooks.json` and `~/.cursor/hooks/`; runtime writes under `~/.cursor-watch/` (live, reminders, library, prefs, loop-ledger, shell-notify, …). Library attachments store path refs only; `.md` is read for in-panel preview and `.html` is handed to the default browser — content is not copied into the watch home.
- Open in Cursor / Open Chat only accepts workspace paths that already appear in the current scanned sessions, pending Reminders, or library entries.
- There is no auth: the trust boundary is whoever can log into this Mac.

## Appendix: implementation notes

### Modules

| Module | Role |
|---|---|
| `cli.ts` | `open` / `status` / `stop` / `daemon` / `hooks` |
| `daemon.ts` | pid file, HTTP listen, start watcher, ensure components |
| `ensure-components.ts` | default install + self-check for hooks and bridge extension |
| `watcher.ts` + `scan-worker.ts` | file watch; scan in a child process |
| `scanner.ts` | walk projects, parse transcripts/terminals, merge live |
| `aggregator.ts` | fold child sessions; filter what the panel should show |
| `infer/status.ts` | derive `AgentStatus` from transcript + shell |
| `live-state.ts` / `reminders/*` | LIVE, Turn end Reminder, delivery adapters |
| `library/*` | Chat library state, stale detection, attachment paths and preview |
| `prefs.ts` | notification sound, workspace aliases, panel theme |
| `loop-ledger/*` | Active `/loop` sentinel ledger (suppress false alarms) |
| `open-workspace.ts` | path allow-list, then `open -a Cursor <path>` |
| `open-chat.ts` / `bridge/hub.ts` | open folder + focus chat via bridge |
| `server.ts` | static UI, `/api/*`, `/ws`, `/ws/bridge` |
| `web/*` | Reminder inbox + Todo/Archive library + settings |
| `macos/CursorWatch` + `scripts/package-*.sh` | menubar shell, `.app` / `.dmg` packaging |

### Data sources

| Path | Use |
|---|---|
| `~/.cursor/projects/<key>/agent-transcripts/` | session JSONL |
| terminals under the same project | whether a shell is still running / exit code |
| Cursor local DB `composerHeaders` | chat name, `hasUnread`, … |
| `~/.cursor-watch/live/<conversationId>.json` | LIVE snapshots from hooks (optional) |
| `~/.cursor-watch/reminders.json` | pending Reminders |
| `~/.cursor-watch/library.json` | Todo / Archive library and folder trees |
| `~/.cursor-watch/prefs.json` | sound, workspace aliases, `uiTheme` |
| `~/.cursor-watch/shell-notify/` | shell notify bridge (`shell.alive` + intent JSON) |

Transcripts older than 7 days by mtime are skipped (`SCAN_LOOKBACK_MS`).

### Key constants

| Constant | Default | Meaning |
|---|---|---|
| `DEFAULT_PORT` | `7423` | listen port (`CURSOR_WATCH_PORT` overrides) |
| `TURN_ENDED_KEEP_MS` | 30min | max keep for read + turnEnded |
| `IDLE_KEEP_MS` | 15min | max keep for pure idle |
| `RUNNING_WINDOW_MS` | 2min | "recently active" window for running inference |
| `LIVE_TTL_MS` | 60s | how long a live snapshot counts as LIVE |
| `RECENT_MESSAGE_COUNT` | 8 | recent messages in the drawer |

### Status & aggregation (essentials)

1. Tool failure or non-zero shell exit → `error`
2. Recent tool/shell activity → `running`
3. Subagents running → `subagent`
4. Last role is assistant → `waiting`
5. Else → `idle`

LIVE override (non-error): live → force `running`; turn ended or non-running → `waiting` / `idle` from unread.

### HTTP / WebSocket

| Endpoint | Notes |
|---|---|
| `GET /api/health` | `{ ok: true }` |
| `GET /api/sessions` | current `SessionState[]` |
| `GET /api/reminders` | pending Reminder list |
| `POST /api/reminders/:conversationId/ack` | acknowledge one Reminder |
| `GET /api/library` | library snapshot (folders + entries, with `stale`) |
| `POST /api/library/entries` | mark / upsert an entry |
| `PATCH /api/library/entries/:conversationId` | change mark / title / note / folder / Todo priority |
| `DELETE /api/library/entries/:conversationId` | unmark |
| `POST/DELETE …/attachments` | bind / unbind local `.md` / `.html` paths |
| `GET …/attachments/preview` | read-only `.md` attachment preview |
| `POST …/attachments/open` | open `.html` attachment in the default browser |
| `POST …/attachments/reveal` | reveal attachment in Finder |
| `POST/PATCH/DELETE /api/library/folders[/:id]` | folder CRUD |
| `GET/PUT /api/prefs` | read / partial-merge machine prefs |
| `GET /api/hooks-status` | whether hooks are installed |
| `POST /api/open-workspace` | body `{ path }` |
| `POST /api/open-chat` | body `{ conversationId, workspacePath }` → open folder + focus chat |
| `GET /api/bridge-status` | `{ online, extensionVersion? }` |
| `GET /ws` | pushes `sessions` / `reminders` / `library` |
| `GET /ws/bridge` | bridge extension connection |

### Hooks

`hooks install` registers user-level entries in `~/.cursor/hooks.json` (clean uninstall):

- `preToolUse`
- `afterAgentResponse`
- `stop`

The observe script writes `~/.cursor-watch/live/`. Failures must not take down the Agent.

### Tests & packaging

```bash
npm test
npm run build
npm run package:app
npm run package:app:install
npm run package:dmg
```
