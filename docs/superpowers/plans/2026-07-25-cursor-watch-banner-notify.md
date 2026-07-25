# cursor-watch macOS Banner Notify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Reminder OS notifications as macOS Notification Center top-right banners via a vendored `terminal-notifier.app`, removing modal `display alert`.

**Architecture:** `notifyReminder` builds a `terminal-notifier` argv (title/subtitle/message/group/open/optional sound), sends `{ type: "notify", argv }` through the existing `notify-worker` (clean FDs). If the vendored binary is missing, fall back to `osascript display notification`. No `display alert` on the main path.

**Tech Stack:** Node.js (existing daemon), vendored `terminal-notifier` (from `node-notifier` mac vendor), vitest.

**Spec:** `docs/superpowers/specs/2026-07-25-cursor-watch-banner-notify-design.md`

## Global Constraints

- Vendored binary only — do **not** add `node-notifier` as a runtime npm dependency.
- Keep `notify-worker` started before chokidar (existing daemon order).
- Do **not** auto-downgrade to `display alert`.
- `notificationSound` default semantics unchanged; sound via `-sound Glass` when true.
- `-group` = `record.notifyId`; `-open` = panel deep link.
- Commits: only when the user explicitly asks (workspace rule overrides plan “frequent commit” steps — skip Step Commit unless requested).

---

## File map

| File | Responsibility |
|------|----------------|
| `cursor-watch/vendor/mac/terminal-notifier.app/**` | Vendored notifier binary + resources |
| `cursor-watch/vendor/mac/terminal-notifier-LICENSE` | Upstream license |
| `cursor-watch/src/reminders/notify.ts` | Resolve binary, build argv, notifyReminder, osascript fallback |
| `cursor-watch/src/reminders/notify-worker.mjs` | IPC `argv` spawn |
| `cursor-watch/tests/notify.test.ts` | Unit tests for argv / sound / truncate / fallback helpers |

---

### Task 1: Vendor terminal-notifier + failing notify tests

**Files:**
- Create: `cursor-watch/vendor/mac/terminal-notifier.app/**` (copy from `node-notifier` package `vendor/mac.noindex/terminal-notifier.app`)
- Create: `cursor-watch/vendor/mac/terminal-notifier-LICENSE` (copy from `node-notifier` `vendor/terminal-notifier-LICENSE`)
- Modify: `cursor-watch/tests/notify.test.ts`
- (Implementation of `notify.ts` / worker comes in Task 2 after red tests)

**Interfaces:**
- Produces (expected after Task 2):
  - `resolveTerminalNotifierBin(): string | null`
  - `buildTerminalNotifierArgv(opts: { bin: string; title: string; subtitle?: string; message: string; group: string; openUrl: string; sound: boolean }): string[]`
  - `notifyReminder(opts: NotifyReminderOpts): void` — when `run` provided, calls `run(argv)` once with notifier argv (or osascript fallback argv); no separate afplay call on primary path
  - Keep: `buildReminderDeepLink`, `truncateNotifyText`, `buildDisplayNotificationScript` (fallback helper)
  - Remove primary use of: `buildReminderAlertScript` (may delete or leave unused — prefer delete if no imports)

- [ ] **Step 1: Copy vendor assets**

```bash
cd /tmp && rm -rf nn-vend && mkdir nn-vend && cd nn-vend
npm pack node-notifier@10.0.1
tar -xzf node-notifier-10.0.1.tgz
DEST="/Users/zhangcheng/idea/Cursors/cursor-watch/vendor/mac"
mkdir -p "$DEST"
rm -rf "$DEST/terminal-notifier.app"
cp -R package/vendor/mac.noindex/terminal-notifier.app "$DEST/"
cp package/vendor/terminal-notifier-LICENSE "$DEST/terminal-notifier-LICENSE"
chmod +x "$DEST/terminal-notifier.app/Contents/MacOS/terminal-notifier"
test -x "$DEST/terminal-notifier.app/Contents/MacOS/terminal-notifier"
"$DEST/terminal-notifier.app/Contents/MacOS/terminal-notifier" -help | head -5
```

Expected: help text mentioning `-message` / `-title`.

- [ ] **Step 2: Rewrite failing tests**

Replace `cursor-watch/tests/notify.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  buildDisplayNotificationScript,
  buildTerminalNotifierArgv,
  notifyReminder,
  resolveTerminalNotifierBin,
} from "../src/reminders/notify.js";
import type { ReminderRecord } from "../src/reminders/types.js";

function record(over: Partial<ReminderRecord> = {}): ReminderRecord {
  return {
    conversationId: "conv-42",
    chatName: "My Chat",
    turnedEndedAt: 1_700_000_000_000,
    summary: "turn ended",
    status: "pending",
    notifyId: "cursor-watch-reminder-conv-42",
    ...over,
  };
}

describe("buildTerminalNotifierArgv", () => {
  it("includes title subtitle message group open and optional sound", () => {
    const argv = buildTerminalNotifierArgv({
      bin: "/tmp/terminal-notifier",
      title: "Cursor Watch",
      subtitle: "My Chat",
      message: "turn ended",
      group: "cursor-watch-reminder-conv-42",
      openUrl: "http://127.0.0.1:7423/?conversationId=conv-42",
      sound: true,
    });
    expect(argv[0]).toBe("/tmp/terminal-notifier");
    expect(argv).toContain("-title");
    expect(argv).toContain("Cursor Watch");
    expect(argv).toContain("-subtitle");
    expect(argv).toContain("My Chat");
    expect(argv).toContain("-message");
    expect(argv).toContain("turn ended");
    expect(argv).toContain("-group");
    expect(argv).toContain("cursor-watch-reminder-conv-42");
    expect(argv).toContain("-open");
    expect(argv).toContain("http://127.0.0.1:7423/?conversationId=conv-42");
    expect(argv).toContain("-sound");
    expect(argv).toContain("Glass");
  });

  it("omits -sound when sound false", () => {
    const argv = buildTerminalNotifierArgv({
      bin: "/tmp/terminal-notifier",
      title: "Cursor Watch",
      message: "x",
      group: "g",
      openUrl: "http://127.0.0.1:7423/",
      sound: false,
    });
    expect(argv).not.toContain("-sound");
  });
});

describe("notifyReminder", () => {
  it("calls run once with terminal-notifier argv (no afplay, no alert)", () => {
    const run = vi.fn();
    const bin = resolveTerminalNotifierBin();
    expect(bin).toBeTruthy();

    notifyReminder({
      record: record(),
      sound: false,
      panelUrl: "http://127.0.0.1:7423/",
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    const argv = run.mock.calls[0]![0] as string[];
    expect(argv[0]).toBe(bin);
    expect(argv.join(" ")).toContain("-title");
    expect(argv.join(" ")).toContain("Cursor Watch");
    expect(argv.join(" ")).toContain("-group");
    expect(argv.join(" ")).toContain("cursor-watch-reminder-conv-42");
    expect(argv.join(" ")).toContain("-open");
    expect(argv.join(" ")).toContain("conversationId=conv-42");
    expect(argv.join(" ")).not.toContain("display alert");
    expect(argv[0]).not.toBe("/usr/bin/afplay");
  });

  it("adds -sound Glass when sound true", () => {
    const run = vi.fn();
    notifyReminder({
      record: record(),
      sound: true,
      panelUrl: "http://127.0.0.1:7423/",
      run,
    });
    expect(run).toHaveBeenCalledTimes(1);
    const argv = run.mock.calls[0]![0] as string[];
    expect(argv).toContain("-sound");
    expect(argv).toContain("Glass");
  });

  it("falls back title when chatName missing", () => {
    const run = vi.fn();
    notifyReminder({
      record: record({ chatName: undefined }),
      sound: false,
      panelUrl: "http://127.0.0.1:7423/",
      run,
    });
    const argv = run.mock.calls[0]![0] as string[];
    expect(argv.join(" ")).toContain("Cursor Watch");
  });

  it("truncates long markdown summary", () => {
    const run = vi.fn();
    const long = "字".repeat(500);
    notifyReminder({
      record: record({ summary: long }),
      sound: false,
      panelUrl: "http://127.0.0.1:7423/",
      run,
    });
    const argv = run.mock.calls[0]![0] as string[];
    expect(argv.join(" ").length).toBeLessThan(2000);
    expect(argv.join(" ")).toContain("…");
  });
});

describe("buildDisplayNotificationScript", () => {
  it("builds osascript fallback without alert", () => {
    const script = buildDisplayNotificationScript({
      title: "Cursor Watch",
      body: "hi",
      subtitle: "sub",
      sound: false,
    });
    expect(script).toContain("display notification");
    expect(script).not.toContain("display alert");
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
cd /Users/zhangcheng/idea/Cursors/cursor-watch && npx vitest run tests/notify.test.ts
```

Expected: FAIL — `buildTerminalNotifierArgv` / `resolveTerminalNotifierBin` not exported (or alert-era assertions already removed and imports missing).

- [ ] **Step 4: Commit** — skip unless user asked to commit.

---

### Task 2: Implement notify.ts + notify-worker argv IPC

**Files:**
- Modify: `cursor-watch/src/reminders/notify.ts`
- Modify: `cursor-watch/src/reminders/notify-worker.mjs`
- Test: `cursor-watch/tests/notify.test.ts`

**Interfaces:**
- Consumes: vendored bin at `cursor-watch/vendor/mac/terminal-notifier.app/Contents/MacOS/terminal-notifier`
- Produces: exports listed in Task 1

- [ ] **Step 1: Implement `notify.ts` helpers + `notifyReminder`**

Replace delivery logic in `cursor-watch/src/reminders/notify.ts` with (keep worker start/stop/send/defaultRun as today; rewrite comment header and notify body):

```ts
import { existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReminderRecord } from "./types.js";

/**
 * macOS delivery:
 * - Prefer vendored terminal-notifier (Notification Center banner).
 * - Fallback: osascript display notification (may be silent on some machines).
 * - notify-worker keeps a clean FD table (daemon chokidar → spawn EBADF).
 */

export type NotifyReminderOpts = {
  record: ReminderRecord;
  sound: boolean;
  panelUrl: string;
  run?: (argv: string[]) => void;
};

const DEFAULT_TITLE = "Cursor Watch";
const MAX_NOTIFY_BODY_CHARS = 160;

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = fileURLToPath(
  new URL("./notify-worker.mjs", import.meta.url),
);

let worker: ChildProcess | null = null;

export function resolveTerminalNotifierBin(): string | null {
  const bin = path.resolve(
    here,
    "../../vendor/mac/terminal-notifier.app/Contents/MacOS/terminal-notifier",
  );
  return existsSync(bin) ? bin : null;
}

export function buildTerminalNotifierArgv(opts: {
  bin: string;
  title: string;
  subtitle?: string;
  message: string;
  group: string;
  openUrl: string;
  sound: boolean;
}): string[] {
  const argv = [
    opts.bin,
    "-title",
    opts.title,
    "-message",
    opts.message,
    "-group",
    opts.group,
    "-open",
    opts.openUrl,
  ];
  if (opts.subtitle?.trim()) {
    argv.push("-subtitle", opts.subtitle.trim());
  }
  if (opts.sound) {
    argv.push("-sound", "Glass");
  }
  return argv;
}

export function buildReminderDeepLink(
  panelUrl: string,
  conversationId: string,
): string {
  const base = panelUrl.trim();
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}conversationId=${encodeURIComponent(conversationId)}`;
}

function escapeAppleScriptString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function truncateNotifyText(
  text: string,
  max = MAX_NOTIFY_BODY_CHARS,
): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

export function buildDisplayNotificationScript(opts: {
  title: string;
  body: string;
  subtitle: string;
  sound: boolean;
}): string {
  const title = escapeAppleScriptString(opts.title);
  const body = escapeAppleScriptString(opts.body);
  const subtitle = escapeAppleScriptString(opts.subtitle);
  let script = `display notification "${body}" with title "${title}" subtitle "${subtitle}"`;
  if (opts.sound) {
    script += ` sound name "Glass"`;
  }
  return script;
}

// … keep startNotifyWorker / stopNotifyWorker / sendViaWorker / defaultRun unchanged …

export function notifyReminder(opts: NotifyReminderOpts): void {
  const chatName = opts.record.chatName?.trim();
  const subtitle = chatName
    ? truncateNotifyText(chatName, 80)
    : undefined;
  const message = truncateNotifyText(
    opts.record.summary?.trim() || "本轮结束",
    120,
  );
  const openUrl = buildReminderDeepLink(
    opts.panelUrl,
    opts.record.conversationId,
  );
  const group = opts.record.notifyId;

  const bin = resolveTerminalNotifierBin();
  let argv: string[];
  if (bin) {
    argv = buildTerminalNotifierArgv({
      bin,
      title: DEFAULT_TITLE,
      subtitle,
      message,
      group,
      openUrl,
      sound: opts.sound,
    });
  } else {
    console.error("[cursor-watch] terminal-notifier missing");
    const script = buildDisplayNotificationScript({
      title: DEFAULT_TITLE,
      body: message,
      subtitle: subtitle || DEFAULT_TITLE,
      sound: opts.sound,
    });
    argv = ["/usr/bin/osascript", "-e", script];
  }

  if (opts.run) {
    opts.run(argv);
    return;
  }

  if (!sendViaWorker({ type: "notify", argv })) {
    defaultRun(argv);
  }
}
```

Delete `buildReminderAlertScript` and all `afplay` / `GLASS_SOUND` / alert constants from this file.

- [ ] **Step 2: Update `notify-worker.mjs`**

```js
#!/usr/bin/env node
/**
 * Lightweight notify sidecar — clean FD table.
 * IPC: { type: "notify", argv: string[] }
 * Legacy: { type: "notify", script: string } → osascript -e
 */
import { spawn } from "node:child_process";

function runDetached(cmd, args) {
  try {
    const child = spawn(cmd, args, {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", (err) => {
      console.error("[cursor-watch-notify] spawn error", err);
    });
    child.unref();
  } catch (err) {
    console.error("[cursor-watch-notify] failed", err);
  }
}

process.on("message", (msg) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "notify" && Array.isArray(msg.argv) && msg.argv.length > 0) {
    const [cmd, ...args] = msg.argv;
    if (typeof cmd === "string") runDetached(cmd, args);
    return;
  }
  if (msg.type === "notify" && typeof msg.script === "string") {
    runDetached("/usr/bin/osascript", ["-e", msg.script]);
  }
});

process.on("disconnect", () => {
  process.exit(0);
});
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
cd /Users/zhangcheng/idea/Cursors/cursor-watch && npx vitest run tests/notify.test.ts tests/reminders-pipeline.test.ts
```

Expected: all PASS.

- [ ] **Step 4: Manual banner probe**

```bash
cd /Users/zhangcheng/idea/Cursors/cursor-watch
BIN=vendor/mac/terminal-notifier.app/Contents/MacOS/terminal-notifier
"$BIN" -title "Cursor Watch" -subtitle "横幅测试" -message "Task2 probe" -group cursor-watch-banner-probe -sound Glass
# Restart daemon so it loads new notify.ts
npx cursor-watch stop 2>/dev/null; sleep 1
pkill -f 'notify-worker.mjs' 2>/dev/null || true
rm -f ~/.cursor-watch/daemon.pid
npx cursor-watch open
# Optional in-process:
npx tsx -e '
import { startNotifyWorker, stopNotifyWorker, notifyReminder } from "./src/reminders/notify.ts";
startNotifyWorker();
setTimeout(() => {
  notifyReminder({
    record: {
      conversationId: "banner-probe",
      chatName: "横幅测试",
      turnedEndedAt: Date.now(),
      summary: "本轮结束：vendor terminal-notifier",
      status: "pending",
      notifyId: "cursor-watch-reminder-banner-probe",
    },
    sound: true,
    panelUrl: "http://127.0.0.1:7423/",
  });
  console.log("sent");
}, 200);
setTimeout(() => { stopNotifyWorker(); process.exit(0); }, 1500);
'
```

Expected: macOS top-right banner titled **Cursor Watch** (not a modal alert). If missing: System Settings → Notifications → terminal-notifier → Allow.

- [ ] **Step 5: Commit** — skip unless user asked to commit.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Vendored terminal-notifier + LICENSE | Task 1 |
| Primary path worker → CLI | Task 2 |
| argv title/subtitle/message/group/open/sound | Task 2 |
| Fallback osascript display notification | Task 2 |
| Remove display alert main path | Task 2 |
| notify-worker clean FD / early start | unchanged daemon + Task 2 IPC |
| Unit tests for argv / sound / truncate | Task 1–2 |
| Manual banner verify | Task 2 Step 4 |
| Optional README tip | deferred (YAGNI; System Settings note in probe) |

**Placeholder scan:** none.  
**Type consistency:** `NotifyReminderOpts.run?: (argv: string[]) => void` unchanged; worker `{ type: "notify", argv: string[] }`.
