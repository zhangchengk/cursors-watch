# 01 — cursor-watch Hooks Live / 分组 Top4 / 完成提醒 Implementation Plan

**What to build:** Implement the work described in `.scratch/hooks-live/issues/00-spec-hooks-live.md` and the checklist below.

**Blocked by:** None — can start immediately (or follow task order inside checklist).

**Status:** done

**Parent:** `.scratch/hooks-live/issues/00-spec-hooks-live.md`

- [ ] Acceptance: behavior matches spec and CONTEXT.md
- [ ] Tests updated or added at agreed seams

## Implementation checklist (migrated plan)

# cursor-watch Hooks Live / 分组 Top4 / 完成提醒 Implementation Plan

**Goal:** 用用户级 Cursor Hooks 写入 `~/.cursor-watch/live/`，在态势面板上标出真活跃（迷你滚动）、完成/未读提醒，并在每个工作区分组内只展示最近 4 个会话（外加提醒补入）。

**Architecture:** Hook 脚本只写本地 JSON 快照（fail-open）。Daemon 扫描时合并 transcript 启发式 ⊕ `composerHeaders`（name / lastUpdatedAt / hasUnread / subtitle）⊕ live 快照。前端 `groupSessionsForUi` 做每组 Top4∪提醒；卡片仅在 `live===true` 时播迷你滚动。

**Tech Stack:** 现有 TypeScript / Vitest / Fastify / chokidar；Hook 安装为自包含 `~/.cursor/hooks/cursor-watch-observe.mjs`（纯 Node，无 tsx）；`node:sqlite` 读 headers（与现有 chat-names 一致）。

## Global Constraints

- Spec：`.scratch/specs/2026-07-16-cursor-watch-hooks-live-design.md`
- LIVE TTL：`60_000` ms；`stop` 立即熄灭 live
- Hook 事件：仅 `preToolUse`、`afterAgentResponse`、`stop`（不要 `afterAgentThought`）
- 零干扰：无 `failClosed`、无 deny/ask、无网络、超时 ≤2s、异常也 exit 0
- `open` 不自动 install hooks；需显式 `hooks install|uninstall|status`
- Top4：每 `workspacePath` 组内按 `composerUpdatedAt ?? lastActivityAt`；再 ∪ `hasUnread || turnEnded`
- 迷你滚动：仅 hooks 推导的 `live===true`；`prefers-reduced-motion` 时静态 LIVE
- 完成文案：`hasUnread` → `有未读 · 请查看`；仅 `turnEnded` → `本轮结束`
- `live===true` 时强制 `status = "running"`（除非已是 `error`）
- 提交：英文 conventional commits + `Co-Authored-By: Cursor <zhangchengk@yonyou.com>`
- 工作目录：仓库根下 `cursor-watch/`（docs 在仓库根 `.scratch/`）
- **前置：** 工作区若仍有未提交的 `chat-names` 改动，在 Task 3 前先单独提交或并入 Task 3，勿丢失

## File Structure

```
cursor-watch/
├── src/
│   ├── constants.ts              # MODIFY: LIVE_TTL_MS, GROUP_TOP_N, liveDir, hooks paths
│   ├── types.ts                  # MODIFY: live/hasUnread/turnEnded/composerUpdatedAt/liveHint
│   ├── live-state.ts             # NEW: deriveLiveFlags, formatCompletionBanner, applyLiveToSession
│   ├── live-store.ts             # NEW: readLiveMap, parseLiveSnapshot
│   ├── chat-names.ts             # MODIFY→扩展: loadComposerHeadersMeta (name+unread+updatedAt+subtitle)
│   ├── hooks-install.ts          # NEW: install/uninstall/status merge ~/.cursor/hooks.json
│   ├── hooks/cursor-watch-observe.mjs  # NEW: 安装用模板（复制到 ~/.cursor/hooks/）
│   ├── scanner.ts                # MODIFY: 合并 live + headers meta
│   ├── watcher.ts                # MODIFY: 同时 watch liveDir
│   ├── cli.ts                    # MODIFY: hooks 子命令
│   └── web/
│       ├── group-sessions.js     # MODIFY: Top4 ∪ 提醒；totalCount；组内排序
│       ├── app.js                # MODIFY: 迷你轨、完成行、组头 k/m
│       └── styles.css            # MODIFY: marquee / LIVE / completion
├── tests/
│   ├── live-state.test.ts        # NEW
│   ├── live-store.test.ts        # NEW
│   ├── hooks-install.test.ts     # NEW
│   ├── group-sessions.test.ts    # MODIFY: Top4 用例
│   └── chat-names.test.ts        # MODIFY: headers meta
└── README.md                     # MODIFY: hooks 安装与行为说明
```

---

### Task 1: live-state 纯函数（TTL / stop / 完成文案 / 强制 running）

**Files:**
- Create: `cursor-watch/src/live-state.ts`
- Create: `cursor-watch/tests/live-state.test.ts`
- Modify: `cursor-watch/src/constants.ts`（增加 `LIVE_TTL_MS`、`GROUP_TOP_N`、`liveDir`）
- Modify: `cursor-watch/src/types.ts`（扩展 `SessionState`）

**Interfaces:**
- Consumes: `LiveSnapshot`（见下）、`SessionState` 子集
- Produces:
  - `LIVE_TTL_MS = 60_000`、`GROUP_TOP_N = 4`
  - `liveDir(home?: string): string` → `path.join(stateDir(home), "live")`
  - `deriveLiveFlags(snap, now): { live: boolean; turnEnded: boolean; liveHint?: string }`
  - `formatCompletionBanner(hasUnread: boolean, turnEnded: boolean): string | null`
  - `applyLiveToSession(session, snap, now): SessionState`（返回新对象；`live` 时非 error 则 `status="running"`）

- [ ] **Step 1: Write the failing test**

`tests/live-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LIVE_TTL_MS } from "../src/constants.js";
import {
  applyLiveToSession,
  deriveLiveFlags,
  formatCompletionBanner,
} from "../src/live-state.js";
import type { LiveSnapshot } from "../src/live-state.js";
import type { SessionState } from "../src/types.js";

function snap(over: Partial<LiveSnapshot> & Pick<LiveSnapshot, "conversationId">): LiveSnapshot {
  return {
    lastEvent: "preToolUse",
    lastLiveAt: 1_000_000,
    stoppedAt: null,
    liveHint: "Shell: t",
    updatedAt: 1_000_000,
    ...over,
  };
}

function baseSession(over: Partial<SessionState> = {}): SessionState {
  return {
    id: "c1",
    projectKey: "p",
    workspacePath: "/w",
    workspaceLabel: "w",
    status: "idle",
    summary: "s",
    currentAction: "a",
    lastActivityAt: 1,
    subagentCount: 0,
    subagentRunning: 0,
    transcriptPath: "/t",
    recentMessages: [],
    hasUnread: false,
    turnEnded: false,
    live: false,
    ...over,
  };
}

describe("deriveLiveFlags", () => {
  it("is live within TTL when not stopped", () => {
    const f = deriveLiveFlags(snap({ lastLiveAt: 1_000_000 }), 1_000_000 + LIVE_TTL_MS);
    expect(f.live).toBe(true);
    expect(f.turnEnded).toBe(false);
  });

  it("is not live after TTL", () => {
    const f = deriveLiveFlags(snap({ lastLiveAt: 1_000_000 }), 1_000_000 + LIVE_TTL_MS + 1);
    expect(f.live).toBe(false);
  });

  it("stop clears live immediately and sets turnEnded", () => {
    const f = deriveLiveFlags(
      snap({ lastEvent: "stop", lastLiveAt: 1_000_000, stoppedAt: 1_000_050 }),
      1_000_060,
    );
    expect(f.live).toBe(false);
    expect(f.turnEnded).toBe(true);
  });
});

describe("formatCompletionBanner", () => {
  it("prefers unread over turnEnded", () => {
    expect(formatCompletionBanner(true, true)).toBe("有未读 · 请查看");
    expect(formatCompletionBanner(true, false)).toBe("有未读 · 请查看");
    expect(formatCompletionBanner(false, true)).toBe("本轮结束");
    expect(formatCompletionBanner(false, false)).toBeNull();
  });
});

describe("applyLiveToSession", () => {
  it("forces running when live unless error", () => {
    const s = applyLiveToSession(
      baseSession({ status: "waiting" }),
      snap({ lastLiveAt: 1_000_000 }),
      1_000_100,
    );
    expect(s.live).toBe(true);
    expect(s.status).toBe("running");
  });

  it("does not override error", () => {
    const s = applyLiveToSession(
      baseSession({ status: "error" }),
      snap({ lastLiveAt: 1_000_000 }),
      1_000_100,
    );
    expect(s.live).toBe(true);
    expect(s.status).toBe("error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cursor-watch && npm test -- tests/live-state.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

`constants.ts` 追加：

```ts
export const LIVE_TTL_MS = 60 * 1000;
export const GROUP_TOP_N = 4;

export function liveDir(home = os.homedir()): string {
  return path.join(stateDir(home), "live");
}
```

`types.ts` 的 `SessionState` 追加：

```ts
  composerUpdatedAt?: number;
  hasUnread?: boolean;
  live?: boolean;
  liveHint?: string;
  turnEnded?: boolean;
```

`live-state.ts`:

```ts
import { LIVE_TTL_MS } from "./constants.js";
import type { AgentStatus, SessionState } from "./types.js";

export type LiveEvent = "preToolUse" | "afterAgentResponse" | "stop";

export interface LiveSnapshot {
  conversationId: string;
  lastEvent: LiveEvent;
  lastLiveAt: number;
  stoppedAt: number | null;
  liveHint: string;
  updatedAt: number;
}

export function deriveLiveFlags(
  snap: LiveSnapshot | undefined,
  now: number,
): { live: boolean; turnEnded: boolean; liveHint?: string } {
  if (!snap) return { live: false, turnEnded: false };
  const turnEnded = snap.stoppedAt != null;
  if (turnEnded) {
    return { live: false, turnEnded: true, liveHint: snap.liveHint || undefined };
  }
  const live = now - snap.lastLiveAt <= LIVE_TTL_MS;
  return { live, turnEnded: false, liveHint: snap.liveHint || undefined };
}

export function formatCompletionBanner(
  hasUnread: boolean,
  turnEnded: boolean,
): string | null {
  if (hasUnread) return "有未读 · 请查看";
  if (turnEnded) return "本轮结束";
  return null;
}

export function applyLiveToSession(
  session: SessionState,
  snap: LiveSnapshot | undefined,
  now: number,
): SessionState {
  const flags = deriveLiveFlags(snap, now);
  let status: AgentStatus = session.status;
  if (flags.live && status !== "error") status = "running";
  return {
    ...session,
    status,
    live: flags.live,
    turnEnded: flags.turnEnded,
    liveHint: flags.liveHint ?? session.liveHint,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cursor-watch && npm test -- tests/live-state.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/constants.ts cursor-watch/src/types.ts \
  cursor-watch/src/live-state.ts cursor-watch/tests/live-state.test.ts
git commit -m "$(cat <<'EOF'
feat: add live-state flags and completion banner helpers

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 2: live-store 读写

**Files:**
- Create: `cursor-watch/src/live-store.ts`
- Create: `cursor-watch/tests/live-store.test.ts`

**Interfaces:**
- Consumes: `liveDir`、`LiveSnapshot`
- Produces:
  - `parseLiveSnapshot(raw: unknown): LiveSnapshot | null`
  - `readLiveMap(dir: string): Map<string, LiveSnapshot>`（缺目录 → 空 Map；坏 JSON 跳过）
  - `buildLiveSnapshotFromHook(input: { conversationId: string; event: LiveEvent; hint?: string; now?: number; prev?: LiveSnapshot | null }): LiveSnapshot`（供 hook 逻辑单测；`stop` 设 `stoppedAt`；其它事件清 `stoppedAt` 并刷新 `lastLiveAt`）

- [ ] **Step 1: Write the failing test**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildLiveSnapshotFromHook,
  readLiveMap,
} from "../src/live-store.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("buildLiveSnapshotFromHook", () => {
  it("clears stoppedAt on preToolUse and sets it on stop", () => {
    const a = buildLiveSnapshotFromHook({
      conversationId: "c1",
      event: "preToolUse",
      hint: "Shell: x",
      now: 1000,
    });
    expect(a.stoppedAt).toBeNull();
    expect(a.lastLiveAt).toBe(1000);
    const b = buildLiveSnapshotFromHook({
      conversationId: "c1",
      event: "stop",
      now: 2000,
      prev: a,
    });
    expect(b.stoppedAt).toBe(2000);
    expect(b.lastEvent).toBe("stop");
  });
});

describe("readLiveMap", () => {
  it("reads valid snapshots by conversationId", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-live-"));
    dirs.push(dir);
    const body = buildLiveSnapshotFromHook({
      conversationId: "abc",
      event: "afterAgentResponse",
      hint: "hi",
      now: 42,
    });
    fs.writeFileSync(path.join(dir, "abc.json"), JSON.stringify(body));
    fs.writeFileSync(path.join(dir, "bad.json"), "{");
    const map = readLiveMap(dir);
    expect(map.get("abc")?.liveHint).toBe("hi");
    expect(map.has("bad")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cursor-watch && npm test -- tests/live-store.test.ts`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`live-store.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import type { LiveEvent, LiveSnapshot } from "./live-state.js";

export function parseLiveSnapshot(raw: unknown): LiveSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.conversationId !== "string" || !o.conversationId) return null;
  if (o.lastEvent !== "preToolUse" && o.lastEvent !== "afterAgentResponse" && o.lastEvent !== "stop") {
    return null;
  }
  if (typeof o.lastLiveAt !== "number" || typeof o.updatedAt !== "number") return null;
  const stoppedAt = o.stoppedAt == null ? null : Number(o.stoppedAt);
  if (o.stoppedAt != null && !Number.isFinite(stoppedAt)) return null;
  return {
    conversationId: o.conversationId,
    lastEvent: o.lastEvent,
    lastLiveAt: o.lastLiveAt,
    stoppedAt,
    liveHint: typeof o.liveHint === "string" ? o.liveHint : "",
    updatedAt: o.updatedAt,
  };
}

export function buildLiveSnapshotFromHook(opts: {
  conversationId: string;
  event: LiveEvent;
  hint?: string;
  now?: number;
  prev?: LiveSnapshot | null;
}): LiveSnapshot {
  const now = opts.now ?? Date.now();
  const prev = opts.prev ?? null;
  const isStop = opts.event === "stop";
  return {
    conversationId: opts.conversationId,
    lastEvent: opts.event,
    lastLiveAt: isStop ? (prev?.lastLiveAt ?? now) : now,
    stoppedAt: isStop ? now : null,
    liveHint: (opts.hint ?? prev?.liveHint ?? "").slice(0, 200),
    updatedAt: now,
  };
}

export function readLiveMap(dir: string): Map<string, LiveSnapshot> {
  const out = new Map<string, LiveSnapshot>();
  if (!dir || !fs.existsSync(dir)) return out;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      const snap = parseLiveSnapshot(JSON.parse(text));
      if (snap) out.set(snap.conversationId, snap);
    } catch {
      /* skip */
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cursor-watch && npm test -- tests/live-store.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/live-store.ts cursor-watch/tests/live-store.test.ts
git commit -m "$(cat <<'EOF'
feat: add live snapshot store reader and hook builder

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 3: composerHeaders 扩展（unread / updatedAt / subtitle）

**Files:**
- Modify: `cursor-watch/src/chat-names.ts`（或重命名为 `composer-headers.ts`——**本计划保持文件名 `chat-names.ts`，新增 `loadComposerHeadersMeta`**，保留旧函数作薄封装以免破坏未提交调用方）
- Modify: `cursor-watch/tests/chat-names.test.ts`

**Interfaces:**
- Produces:
  - `ComposerHeaderMeta { chatName?: string; composerUpdatedAt?: number; hasUnread: boolean; subtitle?: string }`
  - `loadComposerHeadersMeta(dbPath: string): Map<string, ComposerHeaderMeta>`
  - `loadComposerHeadersMetaFromHome(home?: string): Map<string, ComposerHeaderMeta>`
  - 现有 `loadComposerChatNames*` 可改为基于 meta 映射 name（保持兼容）

- [ ] **Step 1: Write the failing test**

在 `tests/chat-names.test.ts` 追加（沿用现有 `makeDb`，写入 value 含 `hasUnreadMessages`、`lastUpdatedAt`、`subtitle`）：

```ts
import { loadComposerHeadersMeta } from "../src/chat-names.js";

it("loads unread, updatedAt, subtitle with name", () => {
  const dbPath = makeDb([
    {
      composerId: "c1",
      name: "Cursors面板开发",
      valueExtra: {
        hasUnreadMessages: true,
        lastUpdatedAt: 99,
        subtitle: "Edited a.ts",
      },
    },
  ]);
  const meta = loadComposerHeadersMeta(dbPath).get("c1");
  expect(meta?.chatName).toBe("Cursors面板开发");
  expect(meta?.hasUnread).toBe(true);
  expect(meta?.composerUpdatedAt).toBe(99);
  expect(meta?.subtitle).toBe("Edited a.ts");
});
```

（若 `makeDb` 尚不支持 `valueExtra`，按现有测试文件已有结构传入。）

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cursor-watch && npm test -- tests/chat-names.test.ts`  
Expected: FAIL（`loadComposerHeadersMeta` 不存在）

- [ ] **Step 3: Write minimal implementation**

在 `chat-names.ts` 中实现 `loadComposerHeadersMeta`：解析 `name`、`hasUnreadMessages`、`lastUpdatedAt`、`subtitle`；`hasUnread` 缺省 `false`；无 name 但有其它字段时仍可入 Map（`chatName` 可空）。  
`loadComposerChatNames` 改为调用 meta 后只取 `chatName`。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cursor-watch && npm test -- tests/chat-names.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**（若 chat-names 扫描接线仍未提交，一并：`scanner.ts`/`app.js` 中已有 chatName 展示）

```bash
git add cursor-watch/src/chat-names.ts cursor-watch/tests/chat-names.test.ts \
  cursor-watch/src/scanner.ts cursor-watch/src/types.ts \
  cursor-watch/src/web/app.js cursor-watch/src/web/styles.css cursor-watch/README.md
git commit -m "$(cat <<'EOF'
feat: load composer header meta and show chat names

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

（若部分文件已在先前 commit，只 add 有改动的。）

---

### Task 4: hooks install / uninstall / status + observe 脚本

**Files:**
- Create: `cursor-watch/src/hooks/cursor-watch-observe.mjs`
- Create: `cursor-watch/src/hooks-install.ts`
- Create: `cursor-watch/tests/hooks-install.test.ts`
- Modify: `cursor-watch/src/cli.ts`
- Modify: `cursor-watch/src/constants.ts`（`cursorUserHooksDir`、`cursorUserHooksJson`、`HOOK_SCRIPT_NAME = "cursor-watch-observe.mjs"`、`HOOK_COMMAND_MARKER`）

**Interfaces:**
- Produces:
  - `installHooks(home?: string): { hooksJson: string; scriptPath: string }`
  - `uninstallHooks(home?: string): { removed: boolean }`
  - `hooksStatus(home?: string): { installed: boolean; hooksJson: string; scriptPath: string; liveDirWritable: boolean }`
  - Merge 规则：仅管理 `command` 字符串包含 `cursor-watch-observe` 的条目；事件键 `preToolUse` / `afterAgentResponse` / `stop`；`timeout: 2`；不写 `failClosed`

- [ ] **Step 1: Write the failing test**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hooksStatus, installHooks, uninstallHooks } from "../src/hooks-install.js";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

function fakeHome() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "cw-home-"));
  homes.push(h);
  fs.mkdirSync(path.join(h, ".cursor"), { recursive: true });
  return h;
}

describe("hooks install", () => {
  it("merges without destroying existing hooks and uninstall is precise", () => {
    const home = fakeHome();
    const hooksJson = path.join(home, ".cursor", "hooks.json");
    fs.writeFileSync(
      hooksJson,
      JSON.stringify({
        version: 1,
        hooks: {
          beforeShellExecution: [{ command: "./hooks/other.sh" }],
        },
      }),
    );
    installHooks(home);
    const after = JSON.parse(fs.readFileSync(hooksJson, "utf8"));
    expect(after.hooks.beforeShellExecution).toHaveLength(1);
    expect(after.hooks.preToolUse.some((x: { command: string }) => x.command.includes("cursor-watch-observe"))).toBe(true);
    expect(after.hooks.afterAgentResponse.length).toBeGreaterThan(0);
    expect(after.hooks.stop.length).toBeGreaterThan(0);
    expect(hooksStatus(home).installed).toBe(true);
    uninstallHooks(home);
    const gone = JSON.parse(fs.readFileSync(hooksJson, "utf8"));
    expect(gone.hooks.beforeShellExecution).toHaveLength(1);
    expect(gone.hooks.preToolUse ?? []).toHaveLength(0);
    expect(hooksStatus(home).installed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cursor-watch && npm test -- tests/hooks-install.test.ts`  
Expected: FAIL

- [ ] **Step 3: Write observe script + install module + CLI**

`src/hooks/cursor-watch-observe.mjs`（自包含，安装时复制到 `~/.cursor/hooks/`）：

```js
#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function main() {
  try {
    const chunks = [];
    for (const c of fs.readFileSync(0)) chunks.push(c);
    // Cursor 可能已把 stdin 读完；兼容：若为空则退出
  } catch {
    /* ignore */
  }
}

// 更稳妥：同步读 stdin
let raw = "";
try {
  raw = fs.readFileSync(0, "utf8");
} catch {
  process.exit(0);
}
try {
  const input = raw.trim() ? JSON.parse(raw) : {};
  const event = input.hook_event_name || input.event || "";
  const id =
    input.conversation_id ||
    input.session_id ||
    input.composer_id ||
    "";
  if (!id || !["preToolUse", "afterAgentResponse", "stop"].includes(event)) {
    process.exit(0);
  }
  const home = os.homedir();
  const dir = path.join(home, ".cursor-watch", "live");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.json`);
  let prev = null;
  try {
    prev = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* none */
  }
  const now = Date.now();
  const isStop = event === "stop";
  let hint = "";
  if (typeof input.tool_name === "string") hint = input.tool_name;
  else if (input.tool_input && typeof input.tool_input.command === "string") {
    hint = `Shell: ${input.tool_input.command}`.slice(0, 200);
  } else if (typeof input.text === "string") hint = input.text.slice(0, 120);
  else if (prev && prev.liveHint) hint = prev.liveHint;
  const snap = {
    conversationId: id,
    lastEvent: event,
    lastLiveAt: isStop ? (prev?.lastLiveAt ?? now) : now,
    stoppedAt: isStop ? now : null,
    liveHint: hint,
    updatedAt: now,
  };
  fs.writeFileSync(file, JSON.stringify(snap));
} catch {
  /* swallow */
}
process.exit(0);
```

实现时对照 [Cursor Hooks 文档](https://cursor.com/docs/hooks) 核对 stdin 字段名（`hook_event_name`、`conversation_id`、tool 字段）；以实测为准，单测覆盖 install 合并即可；observe 脚本可用临时 spawn + 假 stdin 做一条集成测（可选，写在同测试文件）。

`hooks-install.ts`：从包内模板 `path.join(fileURLToPath(new URL("./hooks/cursor-watch-observe.mjs", import.meta.url)))` 复制到 `~/.cursor/hooks/cursor-watch-observe.mjs`，chmod +x；合并 hooks.json。

`cli.ts`：

```ts
if (cmd === "hooks") {
  const sub = process.argv[3];
  const { installHooks, uninstallHooks, hooksStatus } = await import("./hooks-install.js");
  if (sub === "install") {
    const r = installHooks();
    console.log("installed", r.scriptPath);
    return;
  }
  if (sub === "uninstall") {
    console.log(JSON.stringify(uninstallHooks(), null, 2));
    return;
  }
  if (sub === "status") {
    console.log(JSON.stringify(hooksStatus(), null, 2));
    return;
  }
  console.error("usage: cursor-watch hooks <install|uninstall|status>");
  process.exit(1);
}
```

更新 usage 行。

- [ ] **Step 4: Run tests**

Run: `cd cursor-watch && npm test -- tests/hooks-install.test.ts`  
Expected: PASS

手动冒烟（可选）：`node src/hooks/cursor-watch-observe.mjs <<< '{"hook_event_name":"preToolUse","conversation_id":"test-id","tool_name":"Shell"}'` 后检查 `~/.cursor-watch/live/test-id.json`（测完可删）。

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/hooks/cursor-watch-observe.mjs \
  cursor-watch/src/hooks-install.ts cursor-watch/tests/hooks-install.test.ts \
  cursor-watch/src/cli.ts cursor-watch/src/constants.ts
git commit -m "$(cat <<'EOF'
feat: add cursor-watch hooks install and observe script

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 5: scanner + watcher 合并 live 与 headers

**Files:**
- Modify: `cursor-watch/src/scanner.ts`
- Modify: `cursor-watch/src/watcher.ts`
- Modify: `cursor-watch/tests/scanner.test.ts`（若有集成夹具则补一条；否则新增轻量测试用临时 projects+live+fake 不强制 sqlite）

**Interfaces:**
- Consumes: `loadComposerHeadersMetaFromHome`、`readLiveMap(liveDir(home))`、`applyLiveToSession`
- Produces: 每个父会话带 `chatName`、`composerUpdatedAt`、`hasUnread`、`live`、`liveHint`、`turnEnded`；`liveHint` 缺省可用 `subtitle`

- [ ] **Step 1: Write the failing test**

优先在 `tests/` 新增 `tests/scan-live-merge.test.ts`：构造临时 `projectsDir`（可空或最小 jsonl）+ `liveDir` 写入 snap，**若 scanner 强依赖真实 transcript，则改为单测「合并函数」**——把 scanner 末尾合并抽成：

```ts
// live-state.ts 或 scanner.ts 导出
export function mergeSessionExtras(
  session: SessionState,
  meta: ComposerHeaderMeta | undefined,
  snap: LiveSnapshot | undefined,
  now: number,
): SessionState
```

测试 `mergeSessionExtras`（推荐，避免重型 fs 扫描）：

```ts
it("applies unread and live from extras", () => {
  const s = mergeSessionExtras(
    baseSession({ status: "idle" }),
    { chatName: "N", hasUnread: true, composerUpdatedAt: 9, subtitle: "sub" },
    { conversationId: "c1", lastEvent: "preToolUse", lastLiveAt: 100, stoppedAt: null, liveHint: "Shell", updatedAt: 100 },
    150,
  );
  expect(s.chatName).toBe("N");
  expect(s.hasUnread).toBe(true);
  expect(s.live).toBe(true);
  expect(s.status).toBe("running");
  expect(s.liveHint).toBe("Shell");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cursor-watch && npm test -- tests/scan-live-merge.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement merge + wire scanner/watcher**

`mergeSessionExtras`：写入 meta 字段；`liveHint` = snap hint || meta.subtitle；再 `applyLiveToSession`。

`scanProjects` 开头：

```ts
const headers = loadComposerHeadersMetaFromHome(homeDir);
const lives = readLiveMap(liveDir(homeDir));
```

`buildState` 后对父会话（无 parentId）调用 `mergeSessionExtras`；subagent 可不合并 headers live（或仅 live 按自身 id——**规定：只对无 parentId 的会话合并**）。

`watcher.ts` 的 chokidar 路径数组加入 `liveDir(homeDir)`（目录不存在则先 `fs.mkdirSync`）。

- [ ] **Step 4: Run tests**

Run: `cd cursor-watch && npm test`  
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/scanner.ts cursor-watch/src/watcher.ts \
  cursor-watch/src/live-state.ts cursor-watch/tests/scan-live-merge.test.ts
git commit -m "$(cat <<'EOF'
feat: merge live snapshots and composer meta in scanner

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 6: groupSessionsForUi — 每组 Top4 ∪ 提醒

**Files:**
- Modify: `cursor-watch/src/web/group-sessions.js`
- Modify: `cursor-watch/tests/group-sessions.test.ts`

**Interfaces:**
- Consumes: `GROUP_TOP_N`（前端可硬编码 4，或与 constants 重复字面量 4——**前端硬编码 `const GROUP_TOP_N = 4`**，与 spec 一致）
- Produces: `WorkspaceGroup` 增加 `totalCount: number`；`sessions` 为裁剪后列表；组内排序：`(hasUnread||turnEnded)` > `live` > `composerUpdatedAt/lastActivityAt` 新→旧；组间仍按组内首卡紧急度（更新 `cmpSession`）

- [ ] **Step 1: Write the failing test**

```ts
it("keeps top 4 by composerUpdatedAt and always includes unread/turnEnded", () => {
  const sessions = [];
  for (let i = 0; i < 6; i++) {
    sessions.push(
      sess({
        id: `s${i}`,
        status: "idle",
        workspacePath: "/A",
        workspaceLabel: "A",
        lastActivityAt: i,
        composerUpdatedAt: i,
      }),
    );
  }
  sessions.push(
    sess({
      id: "old-unread",
      status: "idle",
      workspacePath: "/A",
      workspaceLabel: "A",
      lastActivityAt: 0,
      composerUpdatedAt: 0,
      hasUnread: true,
    }),
  );
  const g = groupSessionsForUi(sessions)[0];
  expect(g.totalCount).toBe(7);
  expect(g.sessions.length).toBe(5); // top4 (s5..s2) + old-unread
  expect(g.sessions.some((s) => s.id === "old-unread")).toBe(true);
  expect(g.sessions.some((s) => s.id === "s0")).toBe(false);
});
```

（按实现精确调整期望 id 集合：Top4 应为 s5,s4,s3,s2 + old-unread。）

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cursor-watch && npm test -- tests/group-sessions.test.ts`  
Expected: FAIL（无 totalCount / 未裁剪）

- [ ] **Step 3: Implement select + sort**

在 `group-sessions.js`：

```js
const GROUP_TOP_N = 4;

function activityAt(s) {
  return s.composerUpdatedAt ?? s.lastActivityAt ?? 0;
}

function hasReminder(s) {
  return Boolean(s.hasUnread || s.turnEnded);
}

function cmpCard(a, b) {
  const ra = hasReminder(a) ? 0 : 1;
  const rb = hasReminder(b) ? 0 : 1;
  if (ra !== rb) return ra - rb;
  const la = a.live ? 0 : 1;
  const lb = b.live ? 0 : 1;
  if (la !== lb) return la - lb;
  return activityAt(b) - activityAt(a);
}

function limitGroupSessions(sessions) {
  const sortedByActivity = [...sessions].sort((a, b) => activityAt(b) - activityAt(a));
  const top = sortedByActivity.slice(0, GROUP_TOP_N);
  const ids = new Set(top.map((s) => s.id));
  for (const s of sessions) {
    if (hasReminder(s) && !ids.has(s.id)) {
      top.push(s);
      ids.add(s.id);
    }
  }
  return top.sort(cmpCard);
}
```

分组循环末尾：`g.totalCount = g.sessions.length`；`g.sessions = limitGroupSessions(g.sessions)`；`statusCounts` 按 **展示后** 的 sessions 重算（与组头摘要一致）。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cursor-watch && npm test -- tests/group-sessions.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/web/group-sessions.js cursor-watch/tests/group-sessions.test.ts
git commit -m "$(cat <<'EOF'
feat: limit each workspace group to top 4 plus reminders

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 7: 面板 UI — 迷你滚动 + 完成行 + 组头 k/m

**Files:**
- Modify: `cursor-watch/src/web/app.js`
- Modify: `cursor-watch/src/web/styles.css`
- Modify: `cursor-watch/README.md`

**Interfaces:**
- Consumes: `session.live`、`liveHint`、`hasUnread`、`turnEnded`、`formatCompletionBanner` 逻辑（前端内联相同文案函数，避免打包 TS）

- [ ] **Step 1: Write the failing test**

前端无构建：本任务以 **手动验收清单** + 可选把 `formatCompletionBanner` 已在 Task 1 覆盖。  
若需自动化：在 `group-sessions` 旁增加 `completion-banner.js` 复制纯函数并测——**YAGNI：复用 Task 1，本任务不加强制单测**；在 Step 4 用浏览器/API 冒烟。

- [ ] **Step 2: （跳过 RED 单测）实现 UI**

`app.js` 组头：

```js
header.textContent = summary
  ? `${g.label} · 显示 ${g.sessions.length} / 组内 ${g.totalCount} · ${summary}`
  : `${g.label} · 显示 ${g.sessions.length} / 组内 ${g.totalCount}`;
```

卡片：

```js
function completionBanner(s) {
  if (s.hasUnread) return "有未读 · 请查看";
  if (s.turnEnded) return "本轮结束";
  return "";
}
// ...
const title = sessionTitle(s);
const banner = completionBanner(s);
const marquee =
  s.live && s.liveHint
    ? `<div class="marquee" aria-hidden="true"><span>${escapeHtml(s.liveHint)}</span></div>`
    : s.live
      ? `<div class="live-badge">LIVE</div>`
      : "";
card.innerHTML = `
  <div class="summary">${STATUS_ICON[s.status] ?? ""} ${escapeHtml(title)} · ${formatDuration(...)}</div>
  ${marquee}
  ${banner ? `<div class="completion">${escapeHtml(banner)}</div>` : ""}
  ${!s.live ? `<div class="action">${escapeHtml(s.currentAction)}</div>` : ""}
`;
card.classList.toggle("is-live", Boolean(s.live));
```

抽屉增加 live / turnEnded / hasUnread / composerUpdatedAt 行。

`styles.css`：

```css
.card.is-live { outline: 1px solid color-mix(in srgb, var(--running, #3c3) 40%, transparent); }
.marquee {
  overflow: hidden;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-muted);
  mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent);
}
.marquee span {
  display: inline-block;
  padding-left: 100%;
  animation: cw-marquee 12s linear infinite;
}
@keyframes cw-marquee {
  to { transform: translateX(-100%); }
}
@media (prefers-reduced-motion: reduce) {
  .marquee span { animation: none; padding-left: 0; }
  .marquee::before { content: "LIVE · "; }
}
.completion {
  color: #e6c07b;
  font-size: 12px;
  margin-top: 0.2rem;
}
```

README 增加：

```md
## Hooks（可选）

npx cursor-watch hooks install   # 用户级观察脚本 → ~/.cursor-watch/live
npx cursor-watch hooks status
npx cursor-watch hooks uninstall

不安装也可使用面板；安装后可显示 LIVE 迷你滚动与更准的「在跑」状态。hooks 失败不影响 Cursor。
```

- [ ] **Step 3: Run full tests + 冒烟**

Run: `cd cursor-watch && npm test`  
Expected: 全绿  

冒烟：`npx cursor-watch stop; npx cursor-watch open`，确认 API 字段；有 hooks 时跑一会话看 LIVE。

- [ ] **Step 4: Commit**

```bash
git add cursor-watch/src/web/app.js cursor-watch/src/web/styles.css cursor-watch/README.md
git commit -m "$(cat <<'EOF'
feat: show live marquee and completion banners on panel

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

## Spec coverage (self-review)

| Spec 项 | Task |
|---------|------|
| Hooks → live 文件 | 2, 4 |
| 事件集 preToolUse/afterAgentResponse/stop | 4 |
| TTL 60s + stop 熄灭 | 1 |
| 零干扰 / 显式 install | 4 |
| hasUnread + turnEnded 文案 | 1, 7 |
| 每组 Top4 ∪ 提醒 | 6 |
| 排序用 lastUpdatedAt | 3, 5, 6 |
| 迷你滚动仅 live | 7 |
| reduced-motion | 7 |
| scanner 合并 + watch live | 5 |
| README / CLI status | 4, 7 |
| chatName（已有能力） | 3 |
| 非目标 afterAgentThought / HTTP / 跳转 | 未实现（正确） |

**Placeholder scan：** 无 TBD；observe 脚本字段名要求实现时对照文档实测并固定。  
**类型一致性：** `LiveSnapshot` / `ComposerHeaderMeta` / `SessionState` 扩展字段在 Task 1/3 定义，后续任务复用同名。

---

## Execution Handoff

Plan complete and saved to `.scratch/plans/2026-07-16-cursor-watch-hooks-live.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每个 Task 派一个新 subagent，任务间复审，迭代快  

**2. Inline Execution** — 本会话用 executing-plans 按检查点批量执行  

Which approach?

