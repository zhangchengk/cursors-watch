# 01 — Cursor Agent 态势面板（cursor-watch）Implementation Plan

**What to build:** Implement the work described in `.scratch/agent-dashboard/issues/00-spec-agent-dashboard.md` and the checklist below.

**Blocked by:** None — can start immediately (or follow task order inside checklist).

**Status:** done

**Parent:** `.scratch/agent-dashboard/issues/00-spec-agent-dashboard.md`

- [ ] Acceptance: behavior matches spec and CONTEXT.md
- [ ] Tests updated or added at agreed seams

## Implementation checklist (migrated plan)

# Cursor Agent 态势面板（cursor-watch）Implementation Plan

**Goal:** 在本机用 TypeScript daemon + Web 面板，实时汇总 `~/.cursor/projects` 下所有 Agent 会话的态势（状态 / 路径 / 动作 / 时长 / 摘要）。

**Architecture:** chokidar 监听 transcript jsonl 与 terminals；解析并推断 SessionState；Fastify 绑定 `127.0.0.1:7423` 提供 REST + WebSocket + 静态面板；CLI `open` 在 daemon 未运行时 fork 后台进程。

**Tech Stack:** Node.js ≥20、TypeScript、Vitest、Fastify、`@fastify/websocket`、`@fastify/static`、chokidar；前端为零构建静态 HTML/CSS/JS。

## Global Constraints

- Spec：`.scratch/specs/2026-07-16-cursor-agent-dashboard-design.md`
- 仅绑定 `127.0.0.1`；默认端口 `7423`（可用 `CURSOR_WATCH_PORT` 覆盖）
- 数据目录：`~/.cursor/projects`；状态目录：`~/.cursor-watch/`（`daemon.pid`）
- 活跃窗：`ACTIVE_WINDOW_MS = 30 * 60 * 1000`；运行判定窗：`RUNNING_WINDOW_MS = 2 * 60 * 1000`
- `waiting`：**不**做问句启发式；规则为「最后有效消息为 assistant，且近 2min 无 tool_use / 活跃 shell」
- `workspaceLabel`：去掉 `$HOME/` 前缀后的相对路径；无法解码时退回 `projectKey`
- projectKey→路径：`encode = absPath.replace(/^\//,"").replace(/\//g,"-")`；解码在 `$HOME` 下有限深度 BFS 找 encode 命中；数字型 projectKey 不解码
- 前端：零构建静态文件，不用 Vite
- MVP 不做：Hooks、跳转 Cursor、复制按钮、脱敏、菜单栏、launchd
- 包路径：仓库根下 `cursor-watch/`
- 测试：Vitest；提交信息用英文 conventional commits，AI 协助时追加 `Co-Authored-By: Cursor <zhangchengk@yonyou.com>`

## File Structure

```
cursor-watch/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── bin/cursor-watch.mjs
├── README.md
├── src/
│   ├── types.ts
│   ├── constants.ts
│   ├── workspace.ts          # encode / decode / label
│   ├── parser/
│   │   └── transcript.ts     # jsonl → ParsedTranscript
│   ├── infer/
│   │   └── status.ts         # ParsedTranscript → status fields
│   ├── aggregator.ts         # filter / sort / merge subagents
│   ├── scanner.ts            # one-shot scan of ~/.cursor/projects
│   ├── store.ts              # in-memory SessionState[] + listeners
│   ├── watcher.ts            # chokidar → rescan affected sessions
│   ├── server.ts             # Fastify HTTP/WS/static
│   ├── daemon.ts             # start server + watcher; pid file
│   ├── cli.ts                # open | status | stop
│   └── web/
│       ├── index.html
│       ├── app.js
│       └── styles.css
└── tests/
    ├── fixtures/             # tiny jsonl / terminals samples
    ├── workspace.test.ts
    ├── transcript.test.ts
    ├── status.test.ts
    ├── aggregator.test.ts
    ├── scanner.test.ts
    └── server.test.ts
```

---

### Task 1: Scaffold + types + constants

**Files:**
- Create: `cursor-watch/package.json`
- Create: `cursor-watch/tsconfig.json`
- Create: `cursor-watch/vitest.config.ts`
- Create: `cursor-watch/src/types.ts`
- Create: `cursor-watch/src/constants.ts`
- Create: `cursor-watch/tests/types-smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `AgentStatus`, `SessionState`, `RecentMessage`, constants exported from `src/constants.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "cursor-watch",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "cursor-watch": "./bin/cursor-watch.mjs"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "node --import tsx src/cli.ts",
    "dev": "node --import tsx --watch src/cli.ts open"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write types and constants**

`src/types.ts`:

```ts
export type AgentStatus = "waiting" | "running" | "subagent" | "idle" | "error";

export interface RecentMessage {
  role: "user" | "assistant" | "system";
  text: string;
  at?: number;
}

export interface SessionState {
  id: string;
  projectKey: string;
  workspacePath: string;
  workspaceLabel: string;
  status: AgentStatus;
  summary: string;
  currentAction: string;
  lastActivityAt: number;
  waitingSince?: number;
  runningSince?: number;
  subagentCount: number;
  subagentRunning: number;
  transcriptPath: string;
  recentMessages: RecentMessage[];
  /** internal: parent session id if this row is a subagent (aggregator strips these) */
  parentId?: string;
}
```

`src/constants.ts`:

```ts
import os from "node:os";
import path from "node:path";

export const ACTIVE_WINDOW_MS = 30 * 60 * 1000;
export const RUNNING_WINDOW_MS = 2 * 60 * 1000;
export const DEFAULT_PORT = 7423;
export const SUMMARY_MAX_CHARS = 50;
export const RECENT_MESSAGE_COUNT = 3;
export const DECODE_MAX_DEPTH = 8;

export function cursorProjectsDir(home = os.homedir()): string {
  return path.join(home, ".cursor", "projects");
}

export function stateDir(home = os.homedir()): string {
  return path.join(home, ".cursor-watch");
}

export function pidFile(home = os.homedir()): string {
  return path.join(stateDir(home), "daemon.pid");
}

export function listenHost(): string {
  return "127.0.0.1";
}

export function listenPort(): number {
  const raw = process.env.CURSOR_WATCH_PORT;
  if (!raw) return DEFAULT_PORT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PORT;
}
```

- [ ] **Step 5: Write smoke test**

`tests/types-smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ACTIVE_WINDOW_MS, DEFAULT_PORT, RUNNING_WINDOW_MS } from "../src/constants.js";

describe("constants", () => {
  it("matches spec windows and port", () => {
    expect(ACTIVE_WINDOW_MS).toBe(30 * 60 * 1000);
    expect(RUNNING_WINDOW_MS).toBe(2 * 60 * 1000);
    expect(DEFAULT_PORT).toBe(7423);
  });
});
```

- [ ] **Step 6: Install deps and run test**

```bash
cd cursor-watch
npm install
npm install -D typescript vitest tsx @types/node
npm test
```

Expected: PASS for `constants` test.

- [ ] **Step 7: Commit**

```bash
git add cursor-watch/package.json cursor-watch/package-lock.json cursor-watch/tsconfig.json cursor-watch/vitest.config.ts cursor-watch/src/types.ts cursor-watch/src/constants.ts cursor-watch/tests/types-smoke.test.ts
git commit -m "$(cat <<'EOF'
chore: scaffold cursor-watch package with types

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 2: Workspace encode / decode / label

**Files:**
- Create: `cursor-watch/src/workspace.ts`
- Create: `cursor-watch/tests/workspace.test.ts`

**Interfaces:**
- Consumes: `DECODE_MAX_DEPTH` from constants
- Produces:
  - `encodeWorkspacePath(absPath: string): string`
  - `shortenLabel(absPath: string, homeDir: string): string`
  - `decodeProjectKey(projectKey: string, homeDir: string, existsFn?: (p: string) => boolean, listDirsFn?: (p: string) => string[]): string | null`

- [ ] **Step 1: Write failing tests**

`tests/workspace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  decodeProjectKey,
  encodeWorkspacePath,
  shortenLabel,
} from "../src/workspace.js";

describe("encodeWorkspacePath", () => {
  it("encodes absolute path the Cursor way", () => {
    expect(encodeWorkspacePath("/Users/zhangcheng/idea/Cursors")).toBe(
      "Users-zhangcheng-idea-Cursors",
    );
    expect(encodeWorkspacePath("/Users/zhangcheng/idea/datad-2026/datad")).toBe(
      "Users-zhangcheng-idea-datad-2026-datad",
    );
  });
});

describe("shortenLabel", () => {
  it("strips home prefix", () => {
    expect(
      shortenLabel("/Users/zhangcheng/idea/datad-2026/datad", "/Users/zhangcheng"),
    ).toBe("idea/datad-2026/datad");
  });

  it("falls back to abs path when outside home", () => {
    expect(shortenLabel("/tmp/x", "/Users/zhangcheng")).toBe("/tmp/x");
  });
});

describe("decodeProjectKey", () => {
  it("finds path by encode match via injected fs", () => {
    const home = "/Users/zhangcheng";
    const dirs: Record<string, string[]> = {
      "/Users/zhangcheng": ["idea"],
      "/Users/zhangcheng/idea": ["datad-2026", "Cursors"],
      "/Users/zhangcheng/idea/datad-2026": ["datad"],
      "/Users/zhangcheng/idea/datad-2026/datad": [],
      "/Users/zhangcheng/idea/Cursors": [],
    };
    const exists = (p: string) => p in dirs || p === home;
    const listDirs = (p: string) => dirs[p] ?? [];
    expect(
      decodeProjectKey(
        "Users-zhangcheng-idea-datad-2026-datad",
        home,
        exists,
        listDirs,
      ),
    ).toBe("/Users/zhangcheng/idea/datad-2026/datad");
  });

  it("returns null for numeric project keys", () => {
    expect(decodeProjectKey("1779083085308", "/Users/zhangcheng")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd cursor-watch && npm test -- tests/workspace.test.ts
```

Expected: FAIL — cannot find module `../src/workspace.js`

- [ ] **Step 3: Implement workspace.ts**

```ts
import fs from "node:fs";
import path from "node:path";
import { DECODE_MAX_DEPTH } from "./constants.js";

export function encodeWorkspacePath(absPath: string): string {
  const normalized = path.resolve(absPath);
  return normalized.replace(/^\//, "").replace(/\//g, "-");
}

export function shortenLabel(absPath: string, homeDir: string): string {
  if (!absPath) return "";
  const home = path.resolve(homeDir);
  const abs = path.resolve(absPath);
  if (abs === home) return "~";
  const prefix = home.endsWith(path.sep) ? home : home + path.sep;
  if (abs.startsWith(prefix)) return abs.slice(prefix.length);
  return abs;
}

export function decodeProjectKey(
  projectKey: string,
  homeDir: string,
  existsFn: (p: string) => boolean = (p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  listDirsFn: (p: string) => {
    try {
      return fs
        .readdirSync(p, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return [];
    }
  },
): string | null {
  if (/^\d+$/.test(projectKey)) return null;

  const home = path.resolve(homeDir);
  const homeDepth = home.split(path.sep).filter(Boolean).length;
  const queue: string[] = [home];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);

    if (encodeWorkspacePath(cur) === projectKey) return cur;

    const depth = cur.split(path.sep).filter(Boolean).length;
    if (depth - homeDepth >= DECODE_MAX_DEPTH) continue;
    if (!existsFn(cur)) continue;

    for (const name of listDirsFn(cur)) {
      if (name === "node_modules" || name === ".git") continue;
      queue.push(path.join(cur, name));
    }
  }
  return null;
}

export function resolveWorkspace(
  projectKey: string,
  homeDir: string,
): { workspacePath: string; workspaceLabel: string } {
  const decoded = decodeProjectKey(projectKey, homeDir);
  if (decoded) {
    return {
      workspacePath: decoded,
      workspaceLabel: shortenLabel(decoded, homeDir),
    };
  }
  return { workspacePath: "", workspaceLabel: projectKey };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd cursor-watch && npm test -- tests/workspace.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/workspace.ts cursor-watch/tests/workspace.test.ts
git commit -m "$(cat <<'EOF'
feat: decode Cursor project keys to workspace labels

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 3: Transcript jsonl parser

**Files:**
- Create: `cursor-watch/src/parser/transcript.ts`
- Create: `cursor-watch/tests/fixtures/sample-parent.jsonl`
- Create: `cursor-watch/tests/fixtures/sample-subagent.jsonl`
- Create: `cursor-watch/tests/transcript.test.ts`

**Interfaces:**
- Consumes: `SUMMARY_MAX_CHARS`, `RECENT_MESSAGE_COUNT`
- Produces:
  - `ParsedTranscript`（含 `lastMessageHadToolUse: boolean`）
  - `parseTranscriptFile(filePath: string, now?: number, parentId?: string): ParsedTranscript`
  - `parseTranscriptText(text: string, meta: { id: string; transcriptPath: string; parentId?: string }, now?: number, fileMtimeMs?: number): ParsedTranscript`

- [ ] **Step 1: Create fixtures**

`tests/fixtures/sample-parent.jsonl`:

```jsonl
{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\n修复 sonar 清单里的 S1068\n</user_query>"}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"先读清单。"},{"type":"tool_use","name":"Read","input":{"path":"/tmp/a.md"}}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"已修好，还要继续吗？"}]}}
```

`tests/fixtures/sample-subagent.jsonl`:

```jsonl
{"role":"assistant","message":{"content":[{"type":"tool_use","name":"Grep","input":{"pattern":"foo"}}]}}
```

- [ ] **Step 2: Write failing tests**

```ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTranscriptText } from "../src/parser/transcript.js";

const fix = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("parseTranscriptText", () => {
  it("extracts summary, recent messages, last tool, roles", () => {
    const text = fs.readFileSync(path.join(fix, "sample-parent.jsonl"), "utf8");
    const parsed = parseTranscriptText(text, {
      id: "abc",
      transcriptPath: "/tmp/abc.jsonl",
    });
    expect(parsed.id).toBe("abc");
    expect(parsed.summary).toContain("修复 sonar");
    expect(parsed.summary.length).toBeLessThanOrEqual(50);
    expect(parsed.lastRole).toBe("assistant");
    expect(parsed.lastToolName).toBe("Read"); // last *seen* tool in file
    expect(parsed.lastMessageHadToolUse).toBe(false); // last message has no tool_use
    expect(parsed.hadToolUseRecently).toBe(false);
    expect(parsed.recentMessages.length).toBeLessThanOrEqual(3);
    expect(parsed.recentMessages.at(-1)?.text).toContain("还要继续吗");
  });

  it("detects recent tool_use when event timestamps are provided via now-window", () => {
    const now = 1_000_000;
    const text = [
      JSON.stringify({
        role: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Shell", input: { command: "mvn test" } }],
        },
        // parser accepts optional top-level timestamp ms
        timestamp: now - 30_000,
      }),
    ].join("\n");
    const parsed = parseTranscriptText(
      text,
      { id: "t1", transcriptPath: "/tmp/t1.jsonl" },
      now,
    );
    expect(parsed.lastToolName).toBe("Shell");
    expect(parsed.lastToolCommand).toBe("mvn test");
    expect(parsed.hadToolUseRecently).toBe(true);
    expect(parsed.lastActivityAt).toBe(now - 30_000);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
cd cursor-watch && npm test -- tests/transcript.test.ts
```

- [ ] **Step 4: Implement parser**

```ts
import fs from "node:fs";
import {
  RECENT_MESSAGE_COUNT,
  RUNNING_WINDOW_MS,
  SUMMARY_MAX_CHARS,
} from "../constants.js";
import type { RecentMessage } from "../types.js";

export interface ParsedTranscript {
  id: string;
  transcriptPath: string;
  parentId?: string;
  summary: string;
  lastRole: "user" | "assistant" | "system" | null;
  lastToolName?: string;
  lastToolCommand?: string;
  lastToolFailed: boolean;
  hadToolUseRecently: boolean;
  lastMessageHadToolUse: boolean;
  lastActivityAt: number;
  recentMessages: RecentMessage[];
  rawUserTexts: string[];
}

function stripUserQuery(text: string): string {
  return text
    .replace(/<\/?user_query>/g, "")
    .replace(/<\/?timestamp>[^]*?<\/timestamp>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: string; text?: string };
    if (p.type === "text" && typeof p.text === "string") parts.push(p.text);
  }
  return parts.join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export function parseTranscriptText(
  text: string,
  meta: { id: string; transcriptPath: string; parentId?: string },
  now = Date.now(),
  fileMtimeMs?: number,
): ParsedTranscript {
  const recent: RecentMessage[] = [];
  const rawUserTexts: string[] = [];
  let lastRole: ParsedTranscript["lastRole"] = null;
  let lastToolName: string | undefined;
  let lastToolCommand: string | undefined;
  let lastToolFailed = false;
  let lastActivityAt = fileMtimeMs ?? 0;
  let lastToolAt = 0;
  let lastMessageHadToolUse = false;

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const role = obj.role as RecentMessage["role"] | undefined;
    const message = obj.message as { content?: unknown } | undefined;
    const ts =
      typeof obj.timestamp === "number"
        ? obj.timestamp
        : typeof obj.timestamp === "string"
          ? Date.parse(obj.timestamp)
          : undefined;

    if (ts && !Number.isNaN(ts)) lastActivityAt = Math.max(lastActivityAt, ts);

    if (!role || !message) continue;
    lastRole = role;
    lastMessageHadToolUse = false;

    const content = message.content;
    const textBody = stripUserQuery(contentToText(content));
    if (role === "user" && textBody) rawUserTexts.push(textBody);

    let toolName: string | undefined;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const p = part as {
          type?: string;
          name?: string;
          input?: Record<string, unknown>;
          is_error?: boolean;
        };
        if (p.type === "tool_use" && p.name) {
          toolName = p.name;
          lastToolName = p.name;
          lastMessageHadToolUse = true;
          const input = p.input ?? {};
          if (typeof input.command === "string") {
            lastToolCommand = input.command;
          } else if (typeof input.description === "string") {
            lastToolCommand = input.description;
          }
          lastToolAt = ts ?? lastActivityAt ?? now;
        }
        if (p.type === "tool_result" && p.is_error) lastToolFailed = true;
      }
    }

    const display = textBody || (toolName ? `[tool] ${toolName}` : "");
    if (display) {
      recent.push({ role, text: display, at: ts });
      if (recent.length > RECENT_MESSAGE_COUNT) recent.shift();
    }
  }

  if (!lastActivityAt && fileMtimeMs) lastActivityAt = fileMtimeMs;
  if (!lastActivityAt) lastActivityAt = now;

  const hadToolUseRecently =
    (lastToolAt > 0 && now - lastToolAt <= RUNNING_WINDOW_MS) ||
    Boolean(
      lastMessageHadToolUse &&
        fileMtimeMs &&
        now - fileMtimeMs <= RUNNING_WINDOW_MS,
    );

  const firstUser = rawUserTexts[0] ?? "";
  return {
    id: meta.id,
    transcriptPath: meta.transcriptPath,
    parentId: meta.parentId,
    summary: truncate(firstUser || "(no user message)", SUMMARY_MAX_CHARS),
    lastRole,
    lastToolName,
    lastToolCommand,
    lastToolFailed,
    hadToolUseRecently,
    lastMessageHadToolUse,
    lastActivityAt,
    recentMessages: recent.slice(-RECENT_MESSAGE_COUNT),
    rawUserTexts,
  };
}

export function parseTranscriptFile(
  filePath: string,
  now = Date.now(),
  parentId?: string,
): ParsedTranscript {
  const text = fs.readFileSync(filePath, "utf8");
  const stat = fs.statSync(filePath);
  const id = pathBasenameWithoutExt(filePath);
  return parseTranscriptText(
    text,
    { id, transcriptPath: filePath, parentId },
    now,
    stat.mtimeMs,
  );
}

function pathBasenameWithoutExt(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  return base.replace(/\.jsonl$/i, "");
}
```

- [ ] **Step 5: Run tests — PASS**

```bash
cd cursor-watch && npm test -- tests/transcript.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add cursor-watch/src/parser/transcript.ts cursor-watch/tests/fixtures cursor-watch/tests/transcript.test.ts
git commit -m "$(cat <<'EOF'
feat: parse Cursor agent transcript jsonl

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 4: Status inference

**Files:**
- Create: `cursor-watch/src/infer/status.ts`
- Create: `cursor-watch/tests/status.test.ts`

**Interfaces:**
- Consumes: `ParsedTranscript`, `ACTIVE_WINDOW_MS`, `RUNNING_WINDOW_MS`
- Produces:
  - `InferInput` / `inferSessionFields(input): Pick<SessionState, "status" | "currentAction" | "waitingSince" | "runningSince">`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { inferSessionFields } from "../src/infer/status.js";
import type { ParsedTranscript } from "../src/parser/transcript.js";

function base(over: Partial<ParsedTranscript> = {}): ParsedTranscript {
  return {
    id: "1",
    transcriptPath: "/t.jsonl",
    summary: "hello",
    lastRole: "assistant",
    lastToolFailed: false,
    hadToolUseRecently: false,
    lastMessageHadToolUse: false,
    lastActivityAt: Date.now(),
    recentMessages: [],
    rawUserTexts: ["hello"],
    ...over,
  };
}

describe("inferSessionFields", () => {
  const now = 10_000_000;

  it("marks waiting when last role is assistant and no recent tools", () => {
    const r = inferSessionFields({
      parsed: base({ lastRole: "assistant", lastActivityAt: now - 60_000 }),
      now,
      shellRunning: false,
      shellExitCode: null,
      subagentRunning: 0,
    });
    expect(r.status).toBe("waiting");
    expect(r.currentAction).toMatch(/等待/);
    expect(r.waitingSince).toBe(now - 60_000);
  });

  it("marks running when recent tool_use", () => {
    const r = inferSessionFields({
      parsed: base({
        hadToolUseRecently: true,
        lastToolName: "Shell",
        lastToolCommand: "mvn test",
        lastMessageHadToolUse: true,
      }),
      now,
      shellRunning: false,
      shellExitCode: null,
      subagentRunning: 0,
    });
    expect(r.status).toBe("running");
    expect(r.currentAction).toContain("Shell");
    expect(r.currentAction).toContain("mvn test");
  });

  it("marks running when shellRunning", () => {
    const r = inferSessionFields({
      parsed: base({ lastRole: "assistant" }),
      now,
      shellRunning: true,
      shellExitCode: null,
      subagentRunning: 0,
    });
    expect(r.status).toBe("running");
  });

  it("marks error on tool failure or nonzero exit", () => {
    expect(
      inferSessionFields({
        parsed: base({ lastToolFailed: true }),
        now,
        shellRunning: false,
        shellExitCode: null,
        subagentRunning: 0,
      }).status,
    ).toBe("error");
    expect(
      inferSessionFields({
        parsed: base(),
        now,
        shellRunning: false,
        shellExitCode: 1,
        subagentRunning: 0,
      }).status,
    ).toBe("error");
  });

  it("marks subagent when child running and parent otherwise idle-ish", () => {
    const r = inferSessionFields({
      parsed: base({ lastRole: "assistant", hadToolUseRecently: false }),
      now,
      shellRunning: false,
      shellExitCode: null,
      subagentRunning: 2,
    });
    expect(r.status).toBe("subagent");
    expect(r.currentAction).toContain("2");
  });

  it("marks idle when last role is user (your turn done, agent not replied) inside window", () => {
    const r = inferSessionFields({
      parsed: base({ lastRole: "user", lastActivityAt: now - 10_000 }),
      now,
      shellRunning: false,
      shellExitCode: null,
      subagentRunning: 0,
    });
    // agent may be thinking — MVP: idle (not waiting for user)
    expect(r.status).toBe("idle");
  });
});
```

- [ ] **Step 2: Run — FAIL**

```bash
cd cursor-watch && npm test -- tests/status.test.ts
```

- [ ] **Step 3: Implement infer/status.ts**

```ts
import type { ParsedTranscript } from "../parser/transcript.js";
import type { AgentStatus } from "../types.js";

export interface InferInput {
  parsed: ParsedTranscript;
  now: number;
  shellRunning: boolean;
  shellExitCode: number | null;
  subagentRunning: number;
}

export interface InferResult {
  status: AgentStatus;
  currentAction: string;
  waitingSince?: number;
  runningSince?: number;
}

export function inferSessionFields(input: InferInput): InferResult {
  const { parsed, now, shellRunning, shellExitCode, subagentRunning } = input;

  if (parsed.lastToolFailed || (shellExitCode !== null && shellExitCode !== 0)) {
    return {
      status: "error",
      currentAction: parsed.lastToolFailed
        ? `工具失败: ${parsed.lastToolName ?? "unknown"}`
        : `终端退出码 ${shellExitCode}`,
    };
  }

  const running =
    parsed.hadToolUseRecently || shellRunning || parsed.lastMessageHadToolUse;

  if (running) {
    const action = parsed.lastToolName
      ? parsed.lastToolCommand
        ? `${parsed.lastToolName}: ${truncate(parsed.lastToolCommand, 60)}`
        : parsed.lastToolName
      : shellRunning
        ? "Shell 运行中"
        : "运行中";
    return {
      status: "running",
      currentAction: action,
      runningSince: parsed.lastActivityAt,
    };
  }

  if (subagentRunning > 0) {
    return {
      status: "subagent",
      currentAction: `${subagentRunning} 个子 Agent 运行中`,
      runningSince: parsed.lastActivityAt,
    };
  }

  if (parsed.lastRole === "assistant") {
    return {
      status: "waiting",
      currentAction: "等待你回复",
      waitingSince: parsed.lastActivityAt,
    };
  }

  return {
    status: "idle",
    currentAction: parsed.lastRole === "user" ? "等待 Agent" : "空闲",
  };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
```

- [ ] **Step 4: PASS + commit**

```bash
cd cursor-watch && npm test -- tests/status.test.ts
git add cursor-watch/src/infer/status.ts cursor-watch/tests/status.test.ts cursor-watch/src/parser/transcript.ts
git commit -m "$(cat <<'EOF'
feat: infer agent session status from transcripts

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 5: Aggregator (filter / sort / merge)

**Files:**
- Create: `cursor-watch/src/aggregator.ts`
- Create: `cursor-watch/tests/aggregator.test.ts`

**Interfaces:**
- Consumes: `SessionState`, `ACTIVE_WINDOW_MS`
- Produces: `aggregateSessions(sessions: SessionState[], now?: number): SessionState[]`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { aggregateSessions } from "../src/aggregator.js";
import type { SessionState } from "../src/types.js";

function sess(p: Partial<SessionState> & Pick<SessionState, "id" | "status">): SessionState {
  return {
    projectKey: "p",
    workspacePath: "/Users/zhangcheng/idea/Cursors",
    workspaceLabel: "idea/Cursors",
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

describe("aggregateSessions", () => {
  const now = 1_000_000;

  it("drops cold non-waiting sessions", () => {
    const out = aggregateSessions(
      [
        sess({ id: "old", status: "idle", lastActivityAt: now - 2 * 60 * 60 * 1000 }),
        sess({ id: "wait", status: "waiting", lastActivityAt: now - 2 * 60 * 60 * 1000, waitingSince: now - 2 * 60 * 60 * 1000 }),
      ],
      now,
    );
    expect(out.map((s) => s.id)).toEqual(["wait"]);
  });

  it("merges subagent rows into parent counts and excludes child rows", () => {
    const out = aggregateSessions(
      [
        sess({
          id: "parent",
          status: "waiting",
          lastActivityAt: now - 10_000,
        }),
        sess({
          id: "child",
          status: "running",
          parentId: "parent",
          lastActivityAt: now - 5_000,
        }),
      ],
      now,
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("parent");
    expect(out[0].subagentCount).toBe(1);
    expect(out[0].subagentRunning).toBe(1);
    expect(out[0].status).toBe("subagent");
  });

  it("sorts waiting → error → running/subagent → idle", () => {
    const out = aggregateSessions(
      [
        sess({ id: "i", status: "idle", lastActivityAt: now }),
        sess({ id: "r", status: "running", lastActivityAt: now }),
        sess({ id: "e", status: "error", lastActivityAt: now }),
        sess({
          id: "w2",
          status: "waiting",
          lastActivityAt: now - 1000,
          waitingSince: now - 1000,
        }),
        sess({
          id: "w1",
          status: "waiting",
          lastActivityAt: now - 5000,
          waitingSince: now - 5000,
        }),
      ],
      now,
    );
    expect(out.map((s) => s.id)).toEqual(["w1", "w2", "e", "r", "i"]);
  });
});
```

- [ ] **Step 2: Implement aggregator.ts**

```ts
import { ACTIVE_WINDOW_MS } from "./constants.js";
import type { AgentStatus, SessionState } from "./types.js";

const STATUS_RANK: Record<AgentStatus, number> = {
  waiting: 0,
  error: 1,
  running: 2,
  subagent: 2,
  idle: 3,
};

export function aggregateSessions(
  sessions: SessionState[],
  now = Date.now(),
): SessionState[] {
  const children = sessions.filter((s) => s.parentId);
  const parents = sessions.filter((s) => !s.parentId);
  const byId = new Map(parents.map((p) => [p.id, { ...p }]));

  for (const child of children) {
    const parent = byId.get(child.parentId!);
    if (!parent) continue;
    parent.subagentCount += 1;
    if (child.status === "running" || child.status === "subagent") {
      parent.subagentRunning += 1;
    }
    parent.lastActivityAt = Math.max(parent.lastActivityAt, child.lastActivityAt);
    if (parent.subagentRunning > 0 && parent.status !== "error" && parent.status !== "running") {
      parent.status = "subagent";
      parent.currentAction = `${parent.subagentRunning} 个子 Agent 运行中`;
    }
  }

  const merged = [...byId.values()].filter((s) => {
    if (s.status === "waiting") return true;
    return now - s.lastActivityAt <= ACTIVE_WINDOW_MS;
  });

  merged.sort((a, b) => {
    const rd = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rd !== 0) return rd;
    if (a.status === "waiting") {
      return (a.waitingSince ?? a.lastActivityAt) - (b.waitingSince ?? b.lastActivityAt);
    }
    return b.lastActivityAt - a.lastActivityAt;
  });

  return merged;
}
```

- [ ] **Step 3: PASS + commit**

```bash
cd cursor-watch && npm test -- tests/aggregator.test.ts
git add cursor-watch/src/aggregator.ts cursor-watch/tests/aggregator.test.ts
git commit -m "$(cat <<'EOF'
feat: aggregate filter sort and merge subagent sessions

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 6: Scanner (filesystem → SessionState[])

**Files:**
- Create: `cursor-watch/src/terminals.ts` (parse terminal header)
- Create: `cursor-watch/src/scanner.ts`
- Create: `cursor-watch/tests/fixtures/projects-layout/` (mini fake tree)
- Create: `cursor-watch/tests/scanner.test.ts`

**Interfaces:**
- Consumes: parser, infer, workspace, aggregator
- Produces:
  - `scanProjects(projectsDir: string, homeDir: string, now?: number): SessionState[]`
  - `parseTerminalMeta(text: string): { pid?: number; cwd?: string; exitCode?: number; running: boolean }`

- [ ] **Step 1: Create fixture tree**

Under `tests/fixtures/projects-layout/`:

```
Users-test-idea-Demo/
  agent-transcripts/
    sess-1/
      sess-1.jsonl          # copy sample-parent content
      subagents/
        child-1.jsonl       # sample-subagent
  terminals/
    1.txt                   # header with pid, no exit_code
```

`1.txt`:

```
---
pid: 12345
cwd: /Users/test/idea/Demo
---
running...
```

- [ ] **Step 2: Tests for terminals + scanner**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanProjects } from "../src/scanner.js";
import { parseTerminalMeta } from "../src/terminals.js";

describe("parseTerminalMeta", () => {
  it("reads pid and running when no exit_code", () => {
    const meta = parseTerminalMeta(`---\npid: 1\ncwd: /tmp\n---\nhi\n`);
    expect(meta.pid).toBe(1);
    expect(meta.exitCode).toBeNull();
    expect(meta.running).toBe(true);
  });

  it("reads exit_code", () => {
    const meta = parseTerminalMeta(`---\npid: 1\nexit_code: 0\n---\n`);
    expect(meta.exitCode).toBe(0);
    expect(meta.running).toBe(false);
  });
});

describe("scanProjects", () => {
  it("discovers parent sessions under a projects root", () => {
    const root = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "fixtures/projects-layout",
    );
    // homeDir chosen so decode may fail → label falls back to projectKey
    const sessions = scanProjects(root, "/Users/test", Date.now());
    const parent = sessions.find((s) => s.id === "sess-1");
    expect(parent).toBeTruthy();
    expect(parent!.projectKey).toBe("Users-test-idea-Demo");
    expect(parent!.subagentCount).toBeGreaterThanOrEqual(0); // aggregator applied inside scan
  });
});
```

Note: `scanProjects` should return **already aggregated** list (call `aggregateSessions` at end).

- [ ] **Step 3: Implement terminals.ts + scanner.ts**

`src/terminals.ts`:

```ts
export interface TerminalMeta {
  pid: number | null;
  cwd: string | null;
  exitCode: number | null;
  running: boolean;
}

export function parseTerminalMeta(text: string): TerminalMeta {
  const headerMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const header = headerMatch?.[1] ?? "";
  const pid = header.match(/^pid:\s*(\d+)/m);
  const cwd = header.match(/^cwd:\s*(.+)$/m);
  const exit = header.match(/^exit_code:\s*(-?\d+)/m);
  const exitCode = exit ? Number(exit[1]) : null;
  return {
    pid: pid ? Number(pid[1]) : null,
    cwd: cwd ? cwd[1].trim() : null,
    exitCode,
    running: exitCode === null && pid !== null,
  };
}
```

`src/scanner.ts` — walk `projectsDir/*/agent-transcripts/*/*.jsonl` (skip if path contains `/subagents/` for parent discovery; separately load subagents):

```ts
import fs from "node:fs";
import path from "node:path";
import { aggregateSessions } from "./aggregator.js";
import { inferSessionFields } from "./infer/status.js";
import { parseTranscriptFile } from "./parser/transcript.js";
import { parseTerminalMeta } from "./terminals.js";
import type { SessionState } from "./types.js";
import { resolveWorkspace } from "./workspace.js";

export function scanProjects(
  projectsDir: string,
  homeDir: string,
  now = Date.now(),
): SessionState[] {
  const raw: SessionState[] = [];
  if (!fs.existsSync(projectsDir)) return [];

  for (const projectKey of fs.readdirSync(projectsDir)) {
    const projectPath = path.join(projectsDir, projectKey);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    const { workspacePath, workspaceLabel } = resolveWorkspace(projectKey, homeDir);

    let shellRunning = false;
    let shellExitCode: number | null = null;
    const termDir = path.join(projectPath, "terminals");
    if (fs.existsSync(termDir)) {
      for (const name of fs.readdirSync(termDir)) {
        if (!name.endsWith(".txt")) continue;
        const meta = parseTerminalMeta(
          fs.readFileSync(path.join(termDir, name), "utf8"),
        );
        if (meta.running) shellRunning = true;
        if (meta.exitCode !== null && meta.exitCode !== 0) shellExitCode = meta.exitCode;
      }
    }

    const transcriptsRoot = path.join(projectPath, "agent-transcripts");
    if (!fs.existsSync(transcriptsRoot)) continue;

    for (const sessionId of fs.readdirSync(transcriptsRoot)) {
      const sessionDir = path.join(transcriptsRoot, sessionId);
      if (!fs.statSync(sessionDir).isDirectory()) continue;
      const mainFile = path.join(sessionDir, `${sessionId}.jsonl`);
      if (fs.existsSync(mainFile)) {
        raw.push(
          buildState({
            file: mainFile,
            projectKey,
            workspacePath,
            workspaceLabel,
            now,
            shellRunning,
            shellExitCode,
          }),
        );
      }
      const subDir = path.join(sessionDir, "subagents");
      if (fs.existsSync(subDir)) {
        for (const name of fs.readdirSync(subDir)) {
          if (!name.endsWith(".jsonl")) continue;
          raw.push(
            buildState({
              file: path.join(subDir, name),
              projectKey,
              workspacePath,
              workspaceLabel,
              now,
              shellRunning: false,
              shellExitCode: null,
              parentId: sessionId,
            }),
          );
        }
      }
    }
  }

  return aggregateSessions(raw, now);
}

function buildState(opts: {
  file: string;
  projectKey: string;
  workspacePath: string;
  workspaceLabel: string;
  now: number;
  shellRunning: boolean;
  shellExitCode: number | null;
  parentId?: string;
}): SessionState {
  const parsed = parseTranscriptFile(opts.file, opts.now, opts.parentId);
  // Re-infer subagentRunning later in aggregator; pass 0 here
  const inferred = inferSessionFields({
    parsed,
    now: opts.now,
    shellRunning: opts.shellRunning,
    shellExitCode: opts.shellExitCode,
    subagentRunning: 0,
  });
  return {
    id: parsed.id,
    projectKey: opts.projectKey,
    workspacePath: opts.workspacePath,
    workspaceLabel: opts.workspaceLabel,
    status: inferred.status,
    summary: parsed.summary,
    currentAction: inferred.currentAction,
    lastActivityAt: parsed.lastActivityAt,
    waitingSince: inferred.waitingSince,
    runningSince: inferred.runningSince,
    subagentCount: 0,
    subagentRunning: 0,
    transcriptPath: parsed.transcriptPath,
    recentMessages: parsed.recentMessages,
    parentId: opts.parentId,
  };
}
```

Ensure `ParsedTranscript` includes `lastMessageHadToolUse` from Task 3.

- [ ] **Step 4: PASS + commit**

```bash
cd cursor-watch && npm test -- tests/scanner.test.ts
git add cursor-watch/src/scanner.ts cursor-watch/src/terminals.ts cursor-watch/tests/scanner.test.ts cursor-watch/tests/fixtures/projects-layout
git commit -m "$(cat <<'EOF'
feat: scan ~/.cursor/projects into session states

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 7: Store + watcher

**Files:**
- Create: `cursor-watch/src/store.ts`
- Create: `cursor-watch/src/watcher.ts`
- Create: `cursor-watch/tests/store.test.ts`

**Interfaces:**
- Consumes: `scanProjects`
- Produces:
  - `SessionStore` with `getSessions()`, `replaceAll()`, `subscribe(fn)`, `refresh()`
  - `startWatcher(projectsDir, store, homeDir): { close(): Promise<void> }`

- [ ] **Step 1: Store test**

```ts
import { describe, expect, it, vi } from "vitest";
import { SessionStore } from "../src/store.js";
import type { SessionState } from "../src/types.js";

describe("SessionStore", () => {
  it("notifies subscribers on replaceAll", () => {
    const store = new SessionStore();
    const spy = vi.fn();
    store.subscribe(spy);
    const rows = [{ id: "a" } as SessionState];
    store.replaceAll(rows);
    expect(store.getSessions()).toEqual(rows);
    expect(spy).toHaveBeenCalledWith(rows);
  });
});
```

- [ ] **Step 2: Implement store + watcher**

`src/store.ts`:

```ts
import type { SessionState } from "./types.js";

export type SessionsListener = (sessions: SessionState[]) => void;

export class SessionStore {
  private sessions: SessionState[] = [];
  private listeners = new Set<SessionsListener>();

  getSessions(): SessionState[] {
    return this.sessions;
  }

  replaceAll(sessions: SessionState[]): void {
    this.sessions = sessions;
    for (const l of this.listeners) l(this.sessions);
  }

  subscribe(fn: SessionsListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
```

`src/watcher.ts`:

```ts
import path from "node:path";
import chokidar from "chokidar";
import { scanProjects } from "./scanner.js";
import type { SessionStore } from "./store.js";

export function startWatcher(
  projectsDir: string,
  homeDir: string,
  store: SessionStore,
): { close: () => Promise<void> } {
  const refresh = () => {
    try {
      store.replaceAll(scanProjects(projectsDir, homeDir));
    } catch (err) {
      console.error("[cursor-watch] scan failed", err);
    }
  };

  refresh();

  let timer: NodeJS.Timeout | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  };

  const watcher = chokidar.watch(
    [
      path.join(projectsDir, "**/agent-transcripts/**/*.jsonl"),
      path.join(projectsDir, "**/terminals/*.txt"),
    ],
    {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      depth: 8,
    },
  );
  watcher.on("all", schedule);

  return {
    close: async () => {
      if (timer) clearTimeout(timer);
      await watcher.close();
    },
  };
}
```

- [ ] **Step 3: Install chokidar + test + commit**

```bash
cd cursor-watch && npm install chokidar && npm test -- tests/store.test.ts
git add cursor-watch/src/store.ts cursor-watch/src/watcher.ts cursor-watch/tests/store.test.ts cursor-watch/package.json cursor-watch/package-lock.json
git commit -m "$(cat <<'EOF'
feat: add session store and filesystem watcher

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 8: Fastify server (HTTP + WS + static)

**Files:**
- Create: `cursor-watch/src/server.ts`
- Create: `cursor-watch/src/web/index.html` (minimal stub for static test)
- Create: `cursor-watch/src/web/app.js` (empty stub)
- Create: `cursor-watch/src/web/styles.css` (empty stub)
- Create: `cursor-watch/tests/server.test.ts`

**Interfaces:**
- Consumes: `SessionStore`, `listenHost`, `listenPort`
- Produces: `buildServer(store): FastifyInstance` with routes per spec

- [ ] **Step 1: Install server deps**

```bash
cd cursor-watch && npm install fastify @fastify/websocket @fastify/static
```

- [ ] **Step 2: Failing/integration test**

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { SessionStore } from "../src/store.js";
import { buildServer } from "../src/server.js";
import type { SessionState } from "../src/types.js";

describe("buildServer", () => {
  const store = new SessionStore();
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    store.replaceAll([
      {
        id: "x",
        projectKey: "p",
        workspacePath: "",
        workspaceLabel: "idea/Demo",
        status: "waiting",
        summary: "hi",
        currentAction: "等待你回复",
        lastActivityAt: Date.now(),
        subagentCount: 0,
        subagentRunning: 0,
        transcriptPath: "/t",
        recentMessages: [],
      } satisfies SessionState,
    ]);
    app = await buildServer(store);
    await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/health", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("GET /api/sessions", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].id).toBe("x");
  });

  it("GET / serves index", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/cursor-watch/i);
  });
});
```

- [ ] **Step 3: Implement server.ts + stub HTML**

`src/web/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>cursor-watch</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <h1>cursor-watch</h1>
    <div id="counts"></div>
    <div id="list"></div>
    <aside id="drawer" hidden></aside>
    <script src="/app.js" type="module"></script>
  </body>
</html>
```

`src/server.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import type { SessionStore } from "./store.js";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");

export async function buildServer(store: SessionStore) {
  const app = Fastify({ logger: false });
  await app.register(websocket);
  await app.register(fastifyStatic, {
    root: webRoot,
    prefix: "/",
  });

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/sessions", async () => store.getSessions());

  app.get("/ws", { websocket: true }, (socket) => {
    const send = () => {
      socket.send(
        JSON.stringify({ type: "sessions", payload: store.getSessions() }),
      );
    };
    send();
    const unsub = store.subscribe(() => send());
    socket.on("close", () => unsub());
  });

  return app;
}
```

- [ ] **Step 4: PASS + commit**

```bash
cd cursor-watch && npm test -- tests/server.test.ts
git add cursor-watch/src/server.ts cursor-watch/src/web cursor-watch/tests/server.test.ts cursor-watch/package.json cursor-watch/package-lock.json
git commit -m "$(cat <<'EOF'
feat: serve sessions API websocket and static panel shell

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 9: Web panel UI (cards + drawer)

**Files:**
- Modify: `cursor-watch/src/web/index.html`
- Modify: `cursor-watch/src/web/styles.css`
- Modify: `cursor-watch/src/web/app.js`

**Interfaces:**
- Consumes: `GET /api/sessions`, `WS /ws` payload `{ type:"sessions", payload: SessionState[] }`
- Produces: interactive DOM UI (manual verify)

- [ ] **Step 1: Implement styles.css**

Use a compact dark-neutral local tool aesthetic (not purple gradient). Cards with left status border; drawer slides from right on desktop.

Key classes: `.counts`, `.card`, `.card.waiting|.running|.idle|.error|.subagent`, `#drawer.open`.

- [ ] **Step 2: Implement app.js**

```js
const listEl = document.getElementById("list");
const countsEl = document.getElementById("counts");
const drawerEl = document.getElementById("drawer");

const STATUS_ICON = {
  waiting: "🟡",
  running: "🟢",
  subagent: "🔵",
  idle: "⚪",
  error: "🔴",
};

function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  return `${Math.floor(m / 60)}h${m % 60}min`;
}

function render(sessions) {
  const counts = { waiting: 0, running: 0, subagent: 0, idle: 0, error: 0 };
  for (const s of sessions) counts[s.status] = (counts[s.status] ?? 0) + 1;
  countsEl.textContent = `🟢${counts.running} 🟡${counts.waiting} 🔵${counts.subagent} ⚪${counts.idle} 🔴${counts.error}`;

  listEl.innerHTML = "";
  for (const s of sessions) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `card ${s.status}`;
    const ageBase =
      s.status === "waiting" ? s.waitingSince ?? s.lastActivityAt : s.lastActivityAt;
    card.innerHTML = `
      <div class="title">${STATUS_ICON[s.status] ?? ""} ${escapeHtml(s.workspaceLabel)}</div>
      <div class="action">${escapeHtml(s.currentAction)} · ${formatDuration(Date.now() - ageBase)}</div>
      <div class="summary">${escapeHtml(s.summary)}</div>
    `;
    card.addEventListener("click", () => openDrawer(s));
    listEl.appendChild(card);
  }
}

function openDrawer(s) {
  drawerEl.hidden = false;
  drawerEl.classList.add("open");
  drawerEl.innerHTML = `
    <header><strong>${escapeHtml(s.workspaceLabel)}</strong>
      <button type="button" id="closeDrawer">关闭</button></header>
    <p>状态: ${STATUS_ICON[s.status]} ${s.status}</p>
    <p>动作: ${escapeHtml(s.currentAction)}</p>
    <p>摘要: ${escapeHtml(s.summary)}</p>
    <p>Transcript: <code>${escapeHtml(s.transcriptPath)}</code></p>
    <p>Subagents: ${s.subagentCount} (running ${s.subagentRunning})</p>
    <h3>最近消息</h3>
    <ul>${(s.recentMessages || [])
      .map((m) => `<li><strong>${m.role}</strong>: ${escapeHtml(m.text)}</li>`)
      .join("")}</ul>
  `;
  document.getElementById("closeDrawer").onclick = () => {
    drawerEl.classList.remove("open");
    drawerEl.hidden = true;
  };
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function boot() {
  const res = await fetch("/api/sessions");
  render(await res.json());
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "sessions") render(msg.payload);
  };
}

boot();
```

- [ ] **Step 3: Polish index.html structure** (header title「Cursor Agent 态势面板」)

- [ ] **Step 4: Manual smoke (no automated UI test required)**

```bash
cd cursor-watch
node --import tsx -e "
import { SessionStore } from './src/store.ts';
import { buildServer } from './src/server.ts';
import { startWatcher } from './src/watcher.ts';
import { cursorProjectsDir } from './src/constants.ts';
import os from 'node:os';
const store = new SessionStore();
const w = startWatcher(cursorProjectsDir(), os.homedir(), store);
const app = await buildServer(store);
await app.listen({ host: '127.0.0.1', port: 7423 });
console.log('open http://127.0.0.1:7423');
"
```

Expected: browser shows cards for recent sessions; click opens drawer with recent messages.

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/web
git commit -m "$(cat <<'EOF'
feat: add cursor-watch web cards and detail drawer

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 10: Daemon lifecycle + CLI (`open` / `status` / `stop`)

**Files:**
- Create: `cursor-watch/src/daemon.ts`
- Create: `cursor-watch/src/cli.ts`
- Create: `cursor-watch/bin/cursor-watch.mjs`

**Interfaces:**
- Consumes: server, watcher, store, `pidFile`, `listenHost`, `listenPort`
- Produces: CLI commands per spec §4.2

- [ ] **Step 1: Implement daemon.ts**

```ts
import fs from "node:fs";
import os from "node:os";
import {
  cursorProjectsDir,
  listenHost,
  listenPort,
  pidFile,
  stateDir,
} from "./constants.js";
import { buildServer } from "./server.js";
import { SessionStore } from "./store.js";
import { startWatcher } from "./watcher.js";

export async function runDaemon(): Promise<void> {
  fs.mkdirSync(stateDir(), { recursive: true });
  const pf = pidFile();
  fs.writeFileSync(pf, String(process.pid), "utf8");

  const store = new SessionStore();
  const watcher = startWatcher(cursorProjectsDir(), os.homedir(), store);
  const app = await buildServer(store);
  const host = listenHost();
  const port = listenPort();
  await app.listen({ host, port });
  console.log(`[cursor-watch] listening on http://${host}:${port}`);

  const shutdown = async () => {
    await watcher.close();
    await app.close();
    try {
      if (fs.existsSync(pf) && fs.readFileSync(pf, "utf8").trim() === String(process.pid)) {
        fs.unlinkSync(pf);
      }
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
```

- [ ] **Step 2: Implement cli.ts**

```ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listenHost, listenPort, pidFile } from "./constants.js";
import { runDaemon } from "./daemon.js";

async function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

function readPid(): number | null {
  try {
    const n = Number(fs.readFileSync(pidFile(), "utf8").trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureDaemon(): Promise<void> {
  const host = listenHost();
  const port = listenPort();
  if (await isPortOpen(host, port)) return;

  const self = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, ["--import", "tsx", self, "daemon"], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  for (let i = 0; i < 40; i++) {
    if (await isPortOpen(host, port)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("daemon failed to start on port " + port);
}

async function openBrowser(url: string): Promise<void> {
  spawn("open", [url], { stdio: "ignore", detached: true }).unref();
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "open";
  if (cmd === "daemon") {
    await runDaemon();
    return;
  }
  if (cmd === "status") {
    const host = listenHost();
    const port = listenPort();
    const up = await isPortOpen(host, port);
    const pid = readPid();
    console.log(
      JSON.stringify({ up, host, port, pid, pidAlive: pid ? pidAlive(pid) : false }, null, 2),
    );
    return;
  }
  if (cmd === "stop") {
    const pid = readPid();
    if (pid && pidAlive(pid)) {
      process.kill(pid, "SIGTERM");
      console.log("sent SIGTERM to", pid);
    } else {
      console.log("daemon not running");
    }
    return;
  }
  if (cmd === "open") {
    await ensureDaemon();
    const url = `http://${listenHost()}:${listenPort()}/`;
    await openBrowser(url);
    console.log(url);
    return;
  }
  console.error("usage: cursor-watch <open|status|stop|daemon>");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: bin/cursor-watch.mjs**

```js
#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(root, "..", "src", "cli.ts");
const child = spawn(process.execPath, ["--import", "tsx", cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
```

- [ ] **Step 4: Manual verify CLI**

```bash
cd cursor-watch
node --import tsx src/cli.ts status   # up:false
node --import tsx src/cli.ts open     # starts daemon, opens browser
node --import tsx src/cli.ts status   # up:true
curl -s http://127.0.0.1:7423/api/health
node --import tsx src/cli.ts stop
```

Expected: health `{"ok":true}`; stop clears process.

- [ ] **Step 5: Commit**

```bash
git add cursor-watch/src/daemon.ts cursor-watch/src/cli.ts cursor-watch/bin/cursor-watch.mjs
git commit -m "$(cat <<'EOF'
feat: add cursor-watch daemon CLI open status stop

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

### Task 11: README + full test suite

**Files:**
- Create: `cursor-watch/README.md`
- Modify: root notes if needed (optional link from repo README — only if you create one; otherwise just `cursor-watch/README.md`)

- [ ] **Step 1: Write README.md**

Content must include:

- 这是什么（态势感知，只读）
- 安装：`cd cursor-watch && npm install`
- 使用：`npx cursor-watch open` / `status` / `stop`
- 端口：`7423`，`CURSOR_WATCH_PORT`
- 数据源：`~/.cursor/projects`
- 信任边界：localhost，不脱敏
- v2 路线图一句话：Hooks、跳转 Cursor

- [ ] **Step 2: Run full suite**

```bash
cd cursor-watch && npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add cursor-watch/README.md
git commit -m "$(cat <<'EOF'
docs: add cursor-watch README

Co-Authored-By: Cursor <zhangchengk@yonyou.com>
EOF
)"
```

---

## Self-Review (plan vs spec)

| Spec 项 | Task |
|---------|------|
| 5 字段卡片 + 详情抽屉 | Task 9 |
| 文件监听 MVP | Task 7 |
| Web localhost:7423 | Task 8–10 |
| 30min ∪ waiting 过滤 + 排序 | Task 5 |
| workspace 路径 label | Task 2、6 |
| 按需拉起 daemon | Task 10 `open`→`ensureDaemon` |
| TypeScript/Node | Task 1 |
| 不脱敏 / 无复制 / 无跳转 | Task 9（仅展示路径） |
| subagent 归并 | Task 5–6 |
| terminals 辅助 | Task 6 |
| README | Task 11 |
| v2 Hooks/跳转 | 文档提及，无实现任务（正确） |

开放细节已锁定：BFS 解码、waiting 无问句启发式、`~/.cursor-watch/daemon.pid`、零构建静态前端。

无 TBD/TODO 占位；类型名在各 Task `Produces` 与代码块一致（`SessionState`、`aggregateSessions`、`buildServer`、`SessionStore`）。

