# cursor-watch Open-Chat Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire panel `↗` so it opens the Cursor workspace then focuses the matching local Agent chat via the bridge extension calling `canvas.openAgentByConversationId` with a string `conversationId`.

**Architecture:** Daemon owns `BridgeHub` (WebSocket `/ws/bridge`: register + heartbeat + focus request/response). Panel calls `POST /api/open-chat` → `openWorkspaceInCursor` then `bridgeHub.focus`. Extension (evolved from spike) connects as client and runs the winning Spike command. App/CLI startup runs `ensureWatchComponents` (hooks + bundled VSIX).

**Tech Stack:** Existing Fastify + `@fastify/websocket`, VS Code/Cursor extension API, vitest, macOS `cursor` CLI for `--install-extension`.

**Spec:** `docs/superpowers/specs/2026-08-05-cursor-watch-open-chat-design.md` (§5–§8)  
**Spike evidence:** `docs/superpowers/specs/2026-08-05-cursor-watch-open-chat-spike-notes.md` (pass)

## Global Constraints

- Focus contract (verified Cursor 3.13.25): `executeCommand("canvas.openAgentByConversationId", conversationId)` with **string** id only — never Cloud Agent / `bc-*` / `openCloudAgentById`.
- Entry: panel `↗` only (not notification click, not whole-card click).
- Failure dispatch per spec §5.3; API `{ ok, stage?, error? }` with `stage` ∈ `workspace` | `bridge` | `focus`.
- Hooks + bridge extension are **default install** components (changes Shell v1 “no auto hooks”).
- localhost only; allow-list `workspacePath` + matching `conversationId` against current sessions.
- Commits: only when the user explicitly asks (skip Commit steps unless requested).
- Do not re-run Spike CDP; do not invent Marketplace publishing.

---

## File map

| File | Responsibility |
|------|----------------|
| `cursor-watch/src/bridge/types.ts` | Bridge protocol messages + result types |
| `cursor-watch/src/bridge/hub.ts` | In-memory registry, heartbeat TTL, focus RPC over WS |
| `cursor-watch/src/open-chat.ts` | Validate → open workspace → focus with retry |
| `cursor-watch/src/ensure-components.ts` | Idempotent hooks + VSIX ensure; status for self-check |
| `cursor-watch/src/server.ts` | `/api/open-chat`, `/api/bridge-status`, `/ws/bridge` |
| `cursor-watch/src/daemon.ts` / `cli.ts` | Call ensure on start/open (light) |
| `cursor-watch/src/web/app.js` | `↗` → `/api/open-chat` with id + path; toast by stage |
| `cursor-watch/extensions/cursor-watch-bridge/src/*` | Product bridge: WS client + focus handler |
| `cursor-watch/scripts/package-app.sh` | Bundle built `.vsix` into app resources |
| `cursor-watch/tests/bridge-hub.test.ts` | Hub register/heartbeat/focus timeout |
| `cursor-watch/tests/open-chat.test.ts` | Dispatch table with fake open + fake bridge |
| `cursor-watch/tests/ensure-components.test.ts` | Hooks/extension status helpers |
| `README.md` / `README.en.md` | Replace “定位不到具体 Agent/chat” |

---

### Task 1: BridgeHub (TDD)

**Files:**
- Create: `cursor-watch/src/bridge/types.ts`
- Create: `cursor-watch/src/bridge/hub.ts`
- Create: `cursor-watch/tests/bridge-hub.test.ts`

**Interfaces:**
- Produces:
```ts
export type BridgeFocusRequest = {
  conversationId: string;
  workspacePath: string;
  requestId: string;
};

export type BridgeFocusResult =
  | { ok: true }
  | { ok: false; error: string };

export type BridgeRegisterInfo = {
  extensionVersion: string;
  capabilities: string[]; // must include "canvas.openAgentByConversationId"
};

export class BridgeHub {
  constructor(opts?: { heartbeatTtlMs?: number; focusTimeoutMs?: number; now?: () => number });
  register(clientId: string, info: BridgeRegisterInfo, send: (msg: unknown) => void): void;
  heartbeat(clientId: string): void;
  unregister(clientId: string): void;
  isOnline(): boolean;
  /** Pick freshest non-expired client; send focus; wait for result or timeout */
  focus(req: Omit<BridgeFocusRequest, "requestId">): Promise<BridgeFocusResult>;
  /** Handle inbound WS message from extension */
  onClientMessage(clientId: string, msg: unknown): void;
}
```

Wire protocol (JSON over `/ws/bridge`):
- Client → server: `{ type: "register", clientId, extensionVersion, capabilities }`
- Client → server: `{ type: "heartbeat", clientId }`
- Client → server: `{ type: "focus-result", requestId, ok: boolean, error?: string }`
- Server → client: `{ type: "focus", requestId, conversationId, workspacePath }`

- [ ] **Step 1: Failing tests**

Create `cursor-watch/tests/bridge-hub.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { BridgeHub } from "../src/bridge/hub.js";

describe("BridgeHub", () => {
  it("isOnline false when empty", () => {
    expect(new BridgeHub().isOnline()).toBe(false);
  });

  it("isOnline true after register + fresh heartbeat", () => {
    const hub = new BridgeHub({ heartbeatTtlMs: 10_000 });
    const send = vi.fn();
    hub.register("c1", { extensionVersion: "0.1.0", capabilities: ["canvas.openAgentByConversationId"] }, send);
    hub.heartbeat("c1");
    expect(hub.isOnline()).toBe(true);
  });

  it("isOnline false when heartbeat expired", () => {
    let now = 1_000;
    const hub = new BridgeHub({ heartbeatTtlMs: 100, now: () => now });
    hub.register("c1", { extensionVersion: "0.1.0", capabilities: ["canvas.openAgentByConversationId"] }, vi.fn());
    hub.heartbeat("c1");
    now = 1_250;
    expect(hub.isOnline()).toBe(false);
  });

  it("focus sends focus msg and resolves on focus-result ok", async () => {
    const hub = new BridgeHub({ focusTimeoutMs: 1_000 });
    const send = vi.fn((msg: unknown) => {
      const m = msg as { type: string; requestId: string };
      if (m.type === "focus") {
        hub.onClientMessage("c1", { type: "focus-result", requestId: m.requestId, ok: true });
      }
    });
    hub.register("c1", { extensionVersion: "0.1.0", capabilities: ["canvas.openAgentByConversationId"] }, send);
    hub.heartbeat("c1");
    const r = await hub.focus({
      conversationId: "abc",
      workspacePath: "/tmp/proj",
    });
    expect(r).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "focus",
        conversationId: "abc",
        workspacePath: "/tmp/proj",
      }),
    );
  });

  it("focus times out when no result", async () => {
    const hub = new BridgeHub({ focusTimeoutMs: 30 });
    hub.register("c1", { extensionVersion: "0.1.0", capabilities: ["canvas.openAgentByConversationId"] }, vi.fn());
    hub.heartbeat("c1");
    const r = await hub.focus({ conversationId: "abc", workspacePath: "/tmp/p" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/timeout|超时/i);
  });

  it("focus fails when no online bridge", async () => {
    const hub = new BridgeHub();
    const r = await hub.focus({ conversationId: "abc", workspacePath: "/tmp/p" });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd cursor-watch && npx vitest run tests/bridge-hub.test.ts
```

- [ ] **Step 3: Implement `types.ts` + `hub.ts`** to make tests pass (defaults: `heartbeatTtlMs=15_000`, `focusTimeoutMs=8_000`).

- [ ] **Step 4: Run — expect PASS**

---

### Task 2: `openChatInCursor` orchestrator (TDD)

**Files:**
- Create: `cursor-watch/src/open-chat.ts`
- Create: `cursor-watch/tests/open-chat.test.ts`
- Reuse: `open-workspace.ts` allow-list helpers

**Interfaces:**
```ts
export type OpenChatStage = "workspace" | "bridge" | "focus";

export type OpenChatResult =
  | { ok: true }
  | { ok: false; stage: OpenChatStage; error: string; statusCode?: number };

export async function openChatInCursor(opts: {
  conversationId: string;
  workspacePath: string;
  sessions: SessionState[];
  openWorkspace?: typeof openWorkspaceInCursor;
  bridge: Pick<BridgeHub, "isOnline" | "focus">;
  sleep?: (ms: number) => Promise<void>;
  /** After failed bridge/focus, try open workspace again then focus once more */
  retryDelayMs?: number; // default 2500
}): Promise<OpenChatResult>;
```

Rules:
1. Find session where `s.id === conversationId` and `s.workspacePath === workspacePath` (trim); else `{ ok:false, stage:"focus", error:"会话不存在", statusCode:404 }` — or stage `workspace` if path not allow-listed (`403`).
2. Call `openWorkspace`; on fail return `stage:"workspace"`.
3. If `!bridge.isOnline()`, wait `retryDelayMs`, if still offline return `stage:"bridge"`.
4. Call `bridge.focus`; on fail wait `retryDelayMs`, call `openWorkspace` again then `focus` once more; still fail → `{ ok:false, stage:"focus", error:"未能定位到 Chat" }` (**workspace already opened** — UI treats as soft degrade toast).

- [ ] **Step 1: Tests** covering: unknown id; workspace open fail; bridge offline; focus fail after retry; happy path.

- [ ] **Step 2: Implement minimal `open-chat.ts`.**

- [ ] **Step 3: Tests PASS.**

---

### Task 3: Server routes + wire BridgeHub into daemon

**Files:**
- Modify: `cursor-watch/src/server.ts`
- Modify: `cursor-watch/src/daemon.ts` (construct shared `BridgeHub`, pass into `buildServer`)
- Modify: `cursor-watch/tests/server.test.ts` (add open-chat / bridge-status cases with fake hub)

**Interfaces:**
- `BuildServerOptions` gains `bridgeHub?: BridgeHub`
- `POST /api/open-chat` body `{ conversationId: string, workspacePath: string }` → `openChatInCursor`
- `GET /api/bridge-status` → `{ online: boolean, extensionVersion?: string }`
- `GET /ws/bridge` websocket: parse register/heartbeat/focus-result; on close unregister

- [ ] **Step 1: Extend server tests** — reject bad body; 404 unknown session; success when fake hub returns ok.

- [ ] **Step 2: Implement routes + daemon wiring.**

- [ ] **Step 3: `npx vitest run tests/server.test.ts tests/open-chat.test.ts tests/bridge-hub.test.ts` PASS.**

---

### Task 4: Productize extension (WS client + focus)

**Files:**
- Modify: `cursor-watch/extensions/cursor-watch-bridge/package.json` (version `0.1.0`, activation `onStartupFinished`)
- Modify: `cursor-watch/extensions/cursor-watch-bridge/src/extension.ts`
- Create: `cursor-watch/extensions/cursor-watch-bridge/src/bridge-client.ts`
- Keep spike dump / canvas-only commands as optional debug (OK to keep).

**Behavior:**
1. On activate: connect `ws://127.0.0.1:${port}/ws/bridge` (port from env `CURSOR_WATCH_PORT` or default `7423`).
2. Send register with `capabilities: ["canvas.openAgentByConversationId"]`.
3. Heartbeat every 5s.
4. On `focus` message:  
   `await vscode.commands.executeCommand("canvas.openAgentByConversationId", conversationId)`  
   then send `focus-result` (`ok: true` if no throw; on throw `ok: false` with message).  
   Do **not** call Cloud Agent commands.
5. Reconnect with backoff if daemon down.
6. `workspacePath` is advisory for logging only in v1 (Spike proved string id enough after workspace open).

- [ ] **Step 1: Implement `bridge-client.ts` + wire `extension.ts`.**

- [ ] **Step 2: Compile + package VSIX:**

```bash
cd cursor-watch/extensions/cursor-watch-bridge
npm install && npm run compile
npx --yes @vscode/vsce package --allow-missing-repository
```

- [ ] **Step 3: Manual smoke** (human or documented): daemon up → Reload Window → extension online in `/api/bridge-status` → Focus via panel later.

---

### Task 5: Panel `↗` → `/api/open-chat`

**Files:**
- Modify: `cursor-watch/src/web/app.js` (`openInCursor` → pass `conversationId` + `workspacePath`)
- Optionally tiny helper test if inbox/app helpers are extracted; otherwise manual + server tests suffice.

**UI:**
```js
async function openInCursor(session) {
  const res = await fetch("/api/open-chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      conversationId: session.id,
      workspacePath: session.workspacePath,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.ok) {
    showToast("已在 Cursor 中打开对应 Chat");
    return;
  }
  // stage-based Chinese toasts per §5.3
  if (data.stage === "workspace") showToast(data.error || "打开工程失败");
  else if (data.stage === "bridge") showToast(data.error || "桥未连接：请确认已装扩展且 Cursor 已打开");
  else if (data.stage === "focus") showToast(data.error || "未能定位到 Chat（工程可能已打开）");
  else showToast(data.error || `打开失败 (${res.status})`);
}
```

Update `mountCard` click handler to pass full `s` not only path. Title: `在 Cursor 中打开对应 Chat`.

- [ ] **Step 1: Edit `app.js`.**

- [ ] **Step 2: Manual check toast strings; no regression on ack.**

---

### Task 6: `ensureWatchComponents` + startup / package

**Files:**
- Create: `cursor-watch/src/ensure-components.ts`
- Create: `cursor-watch/tests/ensure-components.test.ts`
- Modify: `cursor-watch/src/cli.ts` (`open` / daemon start path)
- Modify: `cursor-watch/src/daemon.ts` (light self-check log)
- Modify: `cursor-watch/scripts/package-app.sh` (copy `extensions/cursor-watch-bridge/*.vsix` into `Resources/cursor-watch/extensions/`)
- Modify shell/docs mentions if any “hooks not auto-installed”

**Interfaces:**
```ts
export type ComponentsStatus = {
  hooksInstalled: boolean;
  extensionInstalled: boolean;
  extensionVersion?: string;
  bundledVsixPath?: string;
  bridgeOnline?: boolean;
};

export function hooksInstalled(home?: string): boolean; // reuse hooksStatus
export function resolveBundledVsix(root?: string): string | null;
export function ensureWatchComponents(opts?: {
  homeDir?: string;
  cursorBin?: string;
  bundledVsixPath?: string;
  installExtension?: (vsix: string) => Promise<void>;
}): Promise<ComponentsStatus>;
```

`ensureWatchComponents`:
1. If hooks missing → `installHooks()`.
2. If VSIX path exists and extension missing/outdated → `cursor --install-extension <vsix> --force`.
3. Return status; never throw to caller — catch and attach errors on status object if needed.

Call from `cli.ts` when `open` / after ensureDaemon (non-blocking log). Daemon may call once at boot.

- [ ] **Step 1: Unit tests** with fake fs/hooks and fake installExtension.

- [ ] **Step 2: Implement + wire CLI/daemon + package-app.sh copy vsix.**

- [ ] **Step 3: Tests PASS; document manual `package:app:install` path.**

---

### Task 7: README + design status touch-up

**Files:**
- Modify: `README.md`, `README.en.md` — capability now opens Chat via bridge; note Cursor ≥ verified 3.13.x; extension+hooks default; semi-internal command may break on upgrade.
- Modify: `docs/superpowers/specs/2026-08-05-cursor-watch-open-chat-design.md` status → `已实现` or `实现中` when done.
- Optional ADR note: default hooks install supersedes Shell v1 gate.

- [ ] **Step 1: Edit docs.**

- [ ] **Step 2: Grep README for 「定位不到」 and remove/replace.**

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| `POST /api/open-chat` + stages | 2, 3 |
| Bridge register / heartbeat / focus | 1, 3, 4 |
| `↗` only entry | 5 |
| Open workspace then focus | 2 |
| Failure dispatch §5.3 | 2, 5 |
| `canvas.openAgentByConversationId` string | 4 |
| Default hooks + extension + self-check | 6 |
| Bundle VSIX in app | 6 |
| README update | 7 |

## Out of scope

- Notification → Cursor Chat
- CDP
- Marketplace
- Multi-window perfect routing beyond open-workspace-first
