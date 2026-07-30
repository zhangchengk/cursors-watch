# Cursors Watch

[中文](./README.md)

Cursors Watch watches multiple local Cursor Agent sessions (npm package name remains `cursor-watch`). On Turn end it interrupts you with an OS notification or HUD, leaves one pending item in the panel inbox, and lists currently running sessions below.

Reminders need optional hooks (`hooks install`). Without them there is no OS Reminder, only an install prompt on the panel. While an Active `/loop` sentinel is still alive, hooks `stop` events are not treated as turn end, so you do not get false alarms. From the panel you can open the matching workspace folder in Cursor on this Mac. It does not deep-link into a specific Agent/chat, and it does not modify session content or orchestrate work for you.

It is not a task hub or remote monitoring tool, and it does not replace Cursor's sidebar. It only reads local Cursor data (see below), and it is macOS only. The server binds to localhost and shows paths and message excerpts in the clear with no redaction, so do not expose the port to the network.

## Screenshots

While you work in Cursor, **Cursors Watch** interrupts with a system notification / HUD (no browser tab required):

![Cursors Watch reminder while working in Cursor](./docs/images/Cursors1.png)

Full panel: **Pending Reminder** inbox on top, **Running** sessions below; top bar has column count, status dots, sound, and fullscreen:

![Cursors Watch panel: Reminder inbox and running sessions](./docs/images/Cursors2.png)

## Requirements

- **macOS** only (do not install on other platforms)
- **Node.js ≥ 20** (needed to package / develop; the `.dmg` App embeds a runtime)
- **Cursor** installed on this Mac
- Scannable data appears under `~/.cursor/projects` after you have run Agent sessions locally (the panel may be empty with no Agent history)
- Fully local: no network or extra accounts required

## Install (recommended: menubar App)

Daily use is the informal **Cursors Watch** app (menu bar `CW`). You do not need to `npx` and open a browser every time.

```bash
git clone git@github.com:zhangchengk/cursors-watch.git
cd cursors-watch/cursor-watch
npm install
npm run package:dmg           # build a .dmg
# or install straight to Applications:
npm run package:app:install   # → /Applications/Cursors Watch.app
```

- **DMG output**: `macos/CursorWatch/dist/Cursors-Watch-<version>.dmg`  
  Open it and drag **Cursors Watch** into Applications. Unsigned; first launch may need Privacy & Security approval.
- After install, open from Applications: **Open at Login** defaults on (toggle in the menu); the shell starts the daemon and opens the panel.
- **Reminder**: prefers shell OS notifications; falls back to an in-shell **HUD** if permission is denied or delivery fails.
- If port `7423` already serves this product’s daemon, the shell **adopts** it and opens the panel; only a foreign process on that port errors out.
- Update by rebuilding the dmg / `package:app:install`. No one-click hooks installer or auto-update in v1.

User-facing name is **Cursors Watch**; technical ids stay `cursor-watch` / `com.cursor-watch.*`.

### Dev / CLI (optional)

This tool ships in a private repo. It is **not** on the npm registry. Do **not** run `npm i -g cursor-watch`.

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

The panel works without hooks: “running” then comes mainly from transcripts and terminals, and may lag. With hooks you get LIVE snapshots, which enable Reminders (notify + inbox) and sharper “running” detection, still not millisecond telemetry. While an Active `/loop` sentinel is alive, tick-gap `stop` events are suppressed. Hook failures do not break Cursor.

## Reading the panel

- Top bar brand Cursors Watch; column stepper (default 2; viewports under 720px force 1 column), status color counts, Sound (muted by default), Fullscreen (`F`; native fullscreen inside the App).
- **Pending Reminder** on top: Turn end items that need your eyes. Without hooks this area shows the install command. Per-card Confirm or Confirm all; clicking the OS notification can also ack. ↗ opens the workspace folder only (not a specific chat).
- **Running** below: only LIVE / `running` / `subagent` session cards.
- Server retention still applies to the session snapshot: unread kept; in-progress always visible; read + turn-ended ~30 minutes; pure idle ~15 minutes.
- Top-bar dots count all sessions (including waiting / idle / error not listed under Running).
- Card titles prefer the Agent sidebar chat name; else the first user-message summary.

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
        └─ Fastify: static UI + /api/* + /ws
                  │
                  ▼
         WKWebView panel (or browser)
                  │
         Reminder: shell OS notify → HUD fallback
```

Flow:

1. Open the App (or `cursor-watch open`) to start / adopt the daemon, then open the panel.
2. The watcher triggers scan-worker to infer session state into an in-memory store.
3. The UI uses `GET /api/sessions` + `/ws`; Reminders use `/api/reminders` and the notify path.
4. Before display, child sessions are folded in and retention rules trim the list.

## Trust boundary

- HTTP/WebSocket bind to **`127.0.0.1` only** (default port `7423`).
- The panel shows workspace paths and message snippets **in the clear**, with no redaction.
- Do **not** expose the port to the internet or reverse-proxy it to other people.
- **Read-only scope**: scanning `~/.cursor/projects` and `composerHeaders` never writes session content back.
- **Write exception**: only `hooks install` writes `~/.cursor/hooks.json`, `~/.cursor/hooks/`, and runtime `~/.cursor-watch/live`.
- “Open in Cursor” only accepts workspace paths that already appear in the **current scanned session list**.
- There is **no auth**: the trust boundary is whoever can log into this Mac.

## Appendix: implementation notes

### Modules

| Module | Role |
|---|---|
| `cli.ts` | `open` / `status` / `stop` / `daemon` / `hooks` |
| `daemon.ts` | pid file, HTTP listen, start watcher |
| `watcher.ts` + `scan-worker.ts` | file watch; scan in a child process |
| `scanner.ts` | walk projects, parse transcripts/terminals, merge live |
| `aggregator.ts` | fold child sessions; filter what the panel should show |
| `infer/status.ts` | derive `AgentStatus` from transcript + shell |
| `live-state.ts` / `reminders/*` | LIVE, Turn end Reminder, delivery adapters |
| `loop-ledger/*` | Active `/loop` sentinel ledger (suppress false alarms) |
| `open-workspace.ts` | path allow-list, then `open -a Cursor <path>` |
| `server.ts` | static UI, `/api/*`, `/ws` |
| `web/*` | inbox-first panel (pending + running) |
| `macos/CursorWatch` + `scripts/package-*.sh` | menubar shell, `.app` / `.dmg` packaging |

### Data sources

| Path | Use |
|---|---|
| `~/.cursor/projects/<key>/agent-transcripts/` | session JSONL |
| terminals under the same project | whether a shell is still running / exit code |
| Cursor local DB `composerHeaders` | chat name, `hasUnread`, … |
| `~/.cursor-watch/live/<conversationId>.json` | LIVE snapshots from hooks (optional) |
| `~/.cursor-watch/shell-notify/` | shell notify bridge (`shell.alive` + intent JSON) |

Transcripts older than **7 days** by mtime are skipped (`SCAN_LOOKBACK_MS`).

### Key constants

| Constant | Default | Meaning |
|---|---|---|
| `DEFAULT_PORT` | `7423` | listen port (`CURSOR_WATCH_PORT` overrides) |
| `TURN_ENDED_KEEP_MS` | 30min | max keep for read + turnEnded |
| `IDLE_KEEP_MS` | 15min | max keep for pure idle |
| `RUNNING_WINDOW_MS` | 2min | “recently active” window for running inference |
| `LIVE_TTL_MS` | 60s | how long a live snapshot counts as LIVE |
| `RECENT_MESSAGE_COUNT` | 8 | recent messages in the drawer |

### Status & aggregation (essentials)

1. Tool failure or non-zero shell exit → `error`
2. Recent tool/shell activity → `running`
3. Subagents running → `subagent`
4. Last role is assistant → `waiting`
5. Else → `idle`

**LIVE override (non-error):** live → force `running`; turn ended or non-running → `waiting` / `idle` from unread.

### HTTP / WebSocket

| Endpoint | Notes |
|---|---|
| `GET /api/health` | `{ ok: true }` |
| `GET /api/sessions` | current `SessionState[]` |
| `GET /api/reminders` | pending Reminder list |
| `POST /api/reminders/:conversationId/ack` | acknowledge one Reminder |
| `GET /api/hooks-status` | whether hooks are installed |
| `POST /api/open-workspace` | body `{ path }` |
| `GET /ws` | `sessions` / `reminders` push |

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
