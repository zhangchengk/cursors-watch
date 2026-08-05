# cursor-watch Open-Chat Focus Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove (or falsify) that a minimal Cursor extension can repeatedly focus an existing Agent chat by `conversationId` on this machine’s Cursor version — before any daemon IPC, panel `↗` wiring, or default-install work.

**Architecture:** Ship a tiny private extension under `cursor-watch/extensions/cursor-watch-bridge/`. It exposes Command Palette commands to (1) dump `composer*` / chat-related command ids, (2) attempt focus-by-id via internal `executeCommand` variants, (3) optionally fall back to a CDP probe. Pure helpers for classifying probe outcomes live in a small TS module tested with vitest. Verdict is written to spike-notes; **no** `/api/open-chat`, bridge register, or App packaging in this plan.

**Tech Stack:** Cursor/VS Code Extension API (`vscode`), TypeScript, existing repo vitest (for pure helpers only), macOS.

**Spec:** `docs/superpowers/specs/2026-08-05-cursor-watch-open-chat-design.md` (§4 Spike only)

## Global Constraints

- **Spike only** — do not implement daemon register, `POST /api/open-chat`, panel `↗` changes, hooks auto-install, or VSIX bundling into the App.
- Prefer **internal composer/chat commands**; CDP only if commands cannot focus by id; CDP success = **脆弱过线**, not full 过线.
- Identity under test: Watch `SessionState.id` / hooks `conversationId` / `composerHeaders.composerId` — use a real id from the user’s machine.
- Record **Cursor version** (`Cursor → About` or `cursor --version`) in every spike-notes run.
- macOS only; localhost product constraints unchanged.
- Commits: only when the user explicitly asks (workspace rule overrides plan “frequent commit” steps — skip Commit steps unless requested).
- Do not claim product readiness if verdict is 未过.

---

## File map

| File | Responsibility |
|------|----------------|
| `cursor-watch/extensions/cursor-watch-bridge/package.json` | Extension manifest + contributed commands |
| `cursor-watch/extensions/cursor-watch-bridge/tsconfig.json` | Extension compile options |
| `cursor-watch/extensions/cursor-watch-bridge/src/extension.ts` | Activate; register probe / focus / dump commands |
| `cursor-watch/extensions/cursor-watch-bridge/src/focus-probe.ts` | List candidate commands; try focus strategies; return structured `ProbeAttempt` |
| `cursor-watch/extensions/cursor-watch-bridge/src/spike-verdict.ts` | Pure: map probe attempts → `过线` / `脆弱过线` / `未过` |
| `cursor-watch/extensions/cursor-watch-bridge/scripts/cdp-focus.mjs` | Optional CDP focus sidecar (only if command path fails) |
| `cursor-watch/tests/spike-verdict.test.ts` | Unit tests for verdict classifier |
| `cursor-watch/tests/focus-probe-prefer.test.ts` | Unit tests for command preference order |
| `docs/superpowers/specs/2026-08-05-cursor-watch-open-chat-spike-notes.md` | Manual run log + final verdict |

---

### Task 1: Spike verdict helper (TDD) + notes template

**Files:**
- Create: `cursor-watch/extensions/cursor-watch-bridge/src/spike-verdict.ts`
- Create: `cursor-watch/tests/spike-verdict.test.ts`
- Create: `docs/superpowers/specs/2026-08-05-cursor-watch-open-chat-spike-notes.md` (template only)

**Interfaces:**
- Produces:
  - `export type SpikeVerdict = "pass" | "fragile_pass" | "fail"`
  - `export type ProbeAttempt = { strategy: "command" | "cdp"; ok: boolean; detail: string }`
  - `export function classifySpikeVerdict(attempts: ProbeAttempt[]): SpikeVerdict`
    - any `command` with `ok: true` → `"pass"`
    - else any `cdp` with `ok: true` → `"fragile_pass"`
    - else `"fail"`

- [ ] **Step 1: Write failing tests**

Create `cursor-watch/tests/spike-verdict.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifySpikeVerdict } from "../extensions/cursor-watch-bridge/src/spike-verdict.js";

describe("classifySpikeVerdict", () => {
  it("pass when any command strategy succeeds", () => {
    expect(
      classifySpikeVerdict([
        { strategy: "command", ok: false, detail: "nope" },
        { strategy: "command", ok: true, detail: "composer.focusComposer" },
        { strategy: "cdp", ok: true, detail: "would be ignored" },
      ]),
    ).toBe("pass");
  });

  it("fragile_pass when only cdp succeeds", () => {
    expect(
      classifySpikeVerdict([
        { strategy: "command", ok: false, detail: "x" },
        { strategy: "cdp", ok: true, detail: "selected chat" },
      ]),
    ).toBe("fragile_pass");
  });

  it("fail when nothing succeeds", () => {
    expect(
      classifySpikeVerdict([{ strategy: "command", ok: false, detail: "x" }]),
    ).toBe("fail");
  });

  it("fail on empty attempts", () => {
    expect(classifySpikeVerdict([])).toBe("fail");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd /Users/zhangcheng/idea/Cursors/cursor-watch && npx vitest run tests/spike-verdict.test.ts
```

Expected: FAIL (cannot resolve `spike-verdict` module).

- [ ] **Step 3: Minimal implementation**

Create `cursor-watch/extensions/cursor-watch-bridge/src/spike-verdict.ts`:

```ts
export type SpikeVerdict = "pass" | "fragile_pass" | "fail";

export type ProbeAttempt = {
  strategy: "command" | "cdp";
  ok: boolean;
  detail: string;
};

export function classifySpikeVerdict(attempts: ProbeAttempt[]): SpikeVerdict {
  if (attempts.some((a) => a.strategy === "command" && a.ok)) return "pass";
  if (attempts.some((a) => a.strategy === "cdp" && a.ok)) return "fragile_pass";
  return "fail";
}
```

If vitest cannot import from `extensions/` due to tsconfig includes, either:
- add the path to vitest/`tsconfig` includes minimally, **or**
- move `spike-verdict.ts` to `cursor-watch/src/bridge/spike-verdict.ts` and import from both places — prefer **keeping under extensions/** and adjusting config only if needed.

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /Users/zhangcheng/idea/Cursors/cursor-watch && npx vitest run tests/spike-verdict.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Write spike-notes template**

Create `docs/superpowers/specs/2026-08-05-cursor-watch-open-chat-spike-notes.md`:

```markdown
# Open-Chat Focus Spike Notes

**Spec:** `2026-08-05-cursor-watch-open-chat-design.md` §4  
**Status:** in progress  

## Environment

| Field | Value |
|-------|-------|
| Date | |
| macOS | |
| Cursor version | |
| Extension path | `cursor-watch/extensions/cursor-watch-bridge` |
| Test conversationId | |
| Workspace path | |

## Command dump (composer / chat related)

```text
(paste filtered getCommands output)
```

## Attempts

| # | strategy | command / method | args | ok? | notes |
|---|----------|------------------|------|-----|-------|
| 1 | command | | | | |

## Repeatability

- [ ] Focus succeeded once
- [ ] Switched away / closed agent tab, focused again with same id
- [ ] Second success = repeatable

## Verdict

- [ ] `pass` (command path)
- [ ] `fragile_pass` (CDP only) — needs product re-approval + version pin
- [ ] `fail`

**classifySpikeVerdict inputs used:** (paste JSON of ProbeAttempt[])

**Next:** per spec — pass → product plan; fragile_pass → wait for re-approval; fail → stop or change success criteria.
```

---

### Task 2: Minimal extension scaffold + command dump

**Files:**
- Create: `cursor-watch/extensions/cursor-watch-bridge/package.json`
- Create: `cursor-watch/extensions/cursor-watch-bridge/tsconfig.json`
- Create: `cursor-watch/extensions/cursor-watch-bridge/src/extension.ts`
- Create: `cursor-watch/extensions/cursor-watch-bridge/src/focus-probe.ts`

**Interfaces:**
- Produces:
  - Extension id: `cursor-watch.bridge` (package name `cursor-watch-bridge`)
  - Commands:
    - `cursor-watch.bridge.dumpCommands` — write filtered command ids to Output channel `Cursors Watch Bridge`
    - `cursor-watch.bridge.focusById` — prompt for id; run probe (filled in Task 3)

- [ ] **Step 1: Manifest**

`cursor-watch/extensions/cursor-watch-bridge/package.json`:

```json
{
  "name": "cursor-watch-bridge",
  "displayName": "Cursors Watch Bridge (Spike)",
  "description": "Spike: focus Agent chat by conversationId for Cursors Watch",
  "version": "0.0.1",
  "publisher": "cursor-watch",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "activationEvents": [
    "onCommand:cursor-watch.bridge.dumpCommands",
    "onCommand:cursor-watch.bridge.focusById"
  ],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "cursor-watch.bridge.dumpCommands",
        "title": "Cursors Watch Bridge: Dump composer/chat commands"
      },
      {
        "command": "cursor-watch.bridge.focusById",
        "title": "Cursors Watch Bridge: Focus chat by conversationId"
      }
    ]
  },
  "scripts": {
    "compile": "tsc -p .",
    "watch": "tsc -p . -w"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "typescript": "^5.4.0"
  }
}
```

`cursor-watch/extensions/cursor-watch-bridge/tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "out",
    "rootDir": "src",
    "lib": ["ES2022"],
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 2: focus-probe dump helper**

`cursor-watch/extensions/cursor-watch-bridge/src/focus-probe.ts`:

```ts
import type * as vscode from "vscode";
import type { ProbeAttempt } from "./spike-verdict";

const INTERESTING =
  /composer|aichat|agent|chat\.|cursor\.chat|backgroundAgent/i;

export const PREFERRED_FOCUS_COMMANDS = [
  "composer.focusComposer",
  "composer.selectComposer",
  "composer.openComposer",
  "composer.showComposer",
  "composer.openChatAsEditor",
  "composer.resumeCurrentComposer",
  "aichat.open",
  "workbench.action.chat.open",
] as const;

export async function listInterestingCommands(
  getCommands: (filterInternal?: boolean) => Thenable<string[]>,
): Promise<string[]> {
  const all = await getCommands(false);
  return all.filter((id) => INTERESTING.test(id)).sort();
}

export function preferredFocusCommands(allInteresting: string[]): string[] {
  const set = new Set(allInteresting);
  const out: string[] = [];
  for (const id of PREFERRED_FOCUS_COMMANDS) {
    if (set.has(id)) out.push(id);
  }
  for (const id of allInteresting) {
    if (out.includes(id)) continue;
    if (/composer\.(focus|select|open)/i.test(id)) out.push(id);
  }
  return out;
}

export type FocusProbeDeps = {
  executeCommand: (command: string, ...args: unknown[]) => Thenable<unknown>;
  getCommands: (filterInternal?: boolean) => Thenable<string[]>;
  log: (line: string) => void;
  /** Human confirms the correct chat is visible. Default provided by extension.ts */
  confirmVisualFocus?: () => Promise<boolean>;
};

/** Task 3 fills this in; Task 2 ships empty attempts. */
export async function probeFocusByConversationId(
  _conversationId: string,
  _deps: FocusProbeDeps,
): Promise<ProbeAttempt[]> {
  return [];
}
```

- [ ] **Step 3: extension.ts**

`cursor-watch/extensions/cursor-watch-bridge/src/extension.ts`:

```ts
import * as vscode from "vscode";
import { listInterestingCommands, probeFocusByConversationId } from "./focus-probe";
import { classifySpikeVerdict } from "./spike-verdict";

export function activate(context: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel("Cursors Watch Bridge");

  context.subscriptions.push(
    out,
    vscode.commands.registerCommand("cursor-watch.bridge.dumpCommands", async () => {
      const ids = await listInterestingCommands((f) => vscode.commands.getCommands(f));
      out.clear();
      out.appendLine(`Cursor commands matching composer|chat|agent (${ids.length}):`);
      for (const id of ids) out.appendLine(id);
      out.show(true);
      void vscode.window.showInformationMessage(`Dumped ${ids.length} commands to Output`);
    }),

    vscode.commands.registerCommand("cursor-watch.bridge.focusById", async () => {
      const conversationId = await vscode.window.showInputBox({
        prompt: "conversationId / composerId",
        placeHolder: "uuid from Watch card / composerHeaders",
      });
      if (!conversationId?.trim()) return;

      const attempts = await probeFocusByConversationId(conversationId.trim(), {
        executeCommand: (c, ...a) => vscode.commands.executeCommand(c, ...a),
        getCommands: (f) => vscode.commands.getCommands(f),
        log: (line) => out.appendLine(line),
        confirmVisualFocus: async () => {
          const pick = await vscode.window.showInformationMessage(
            "Did the correct Agent chat focus?",
            "Yes",
            "No",
          );
          return pick === "Yes";
        },
      });
      const verdict = classifySpikeVerdict(attempts);
      out.appendLine(`Verdict: ${verdict}`);
      out.appendLine(JSON.stringify(attempts, null, 2));
      out.show(true);
      void vscode.window.showInformationMessage(`Spike verdict: ${verdict}`);
    }),
  );
}

export function deactivate() {}
```

- [ ] **Step 4: Install deps + compile**

```bash
cd /Users/zhangcheng/idea/Cursors/cursor-watch/extensions/cursor-watch-bridge
npm install
npm run compile
```

Expected: `out/extension.js` exists; no TS errors.

- [ ] **Step 5: Install into Cursor + dump commands**

```bash
cd /Users/zhangcheng/idea/Cursors/cursor-watch/extensions/cursor-watch-bridge
npx --yes @vscode/vsce package --allow-missing-repository
"/Applications/Cursor.app/Contents/Resources/app/bin/cursor" --install-extension ./*.vsix
```

Reload Cursor window. Command Palette → **Cursors Watch Bridge: Dump composer/chat commands**. Paste Output into spike-notes 「Command dump」.

Expected: non-empty list including `composer*` ids (exact set is version-dependent).

---

### Task 3: Command-path focus probe

**Files:**
- Modify: `cursor-watch/extensions/cursor-watch-bridge/src/focus-probe.ts`
- Create: `cursor-watch/tests/focus-probe-prefer.test.ts`
- Update: spike-notes after manual runs

**Interfaces:**
- Consumes: `FocusProbeDeps`, `ProbeAttempt`, `preferredFocusCommands`
- Produces: `probeFocusByConversationId` that tries argument shapes; sets `ok: true` only when `confirmVisualFocus()` returns true for that attempt (or after a batch — prefer confirm once after first non-throwing candidate that might have worked; simplest: after each non-throwing execute, ask confirm; stop on Yes)

- [ ] **Step 1: Unit test for preferredFocusCommands**

Create `cursor-watch/tests/focus-probe-prefer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { preferredFocusCommands } from "../extensions/cursor-watch-bridge/src/focus-probe.js";

describe("preferredFocusCommands", () => {
  it("orders PREFERRED first then other composer open/focus", () => {
    expect(
      preferredFocusCommands([
        "composer.openChatAsEditor",
        "zzz.other",
        "composer.focusComposer",
      ]),
    ).toEqual(["composer.focusComposer", "composer.openChatAsEditor"]);
  });
});
```

Run:

```bash
cd /Users/zhangcheng/idea/Cursors/cursor-watch && npx vitest run tests/focus-probe-prefer.test.ts
```

Expected: PASS (implementation already in Task 2).

- [ ] **Step 2: Implement probeFocusByConversationId**

Replace the stub in `focus-probe.ts` with:

```ts
export async function probeFocusByConversationId(
  conversationId: string,
  deps: FocusProbeDeps,
): Promise<ProbeAttempt[]> {
  const attempts: ProbeAttempt[] = [];
  const interesting = await listInterestingCommands(deps.getCommands);
  const commands = preferredFocusCommands(interesting);
  deps.log(`Interesting commands: ${interesting.length}; trying ${commands.length}`);

  const shapes: Array<{ label: string; args: unknown[] }> = [
    { label: "string", args: [conversationId] },
    { label: "{composerId}", args: [{ composerId: conversationId }] },
    { label: "{conversationId}", args: [{ conversationId }] },
    { label: "{id}", args: [{ id: conversationId }] },
  ];

  const confirm = deps.confirmVisualFocus ?? (async () => false);

  for (const command of commands) {
    for (const shape of shapes) {
      const detailBase = `${command} ${shape.label}`;
      try {
        deps.log(`try ${detailBase}`);
        await deps.executeCommand(command, ...shape.args);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attempts.push({
          strategy: "command",
          ok: false,
          detail: `${detailBase} threw: ${msg}`,
        });
        continue;
      }

      const visualOk = await confirm();
      attempts.push({
        strategy: "command",
        ok: visualOk,
        detail: `${detailBase} no-throw; visual=${visualOk}`,
      });
      if (visualOk) return attempts;
    }
  }

  return attempts;
}
```

- [ ] **Step 3: Compile + reinstall + unit tests**

```bash
cd /Users/zhangcheng/idea/Cursors/cursor-watch/extensions/cursor-watch-bridge && npm run compile
npx --yes @vscode/vsce package --allow-missing-repository
"/Applications/Cursor.app/Contents/Resources/app/bin/cursor" --install-extension ./*.vsix --force
cd /Users/zhangcheng/idea/Cursors/cursor-watch && npx vitest run tests/spike-verdict.test.ts tests/focus-probe-prefer.test.ts
```

Expected: unit tests PASS; extension reloads.

- [ ] **Step 4: Manual focus acceptance**

1. Open the workspace that owns a known Watch session.
2. Copy a real `conversationId` from Watch / `composerHeaders`.
3. Focus a **different** chat (or close Agents UI).
4. Run **Cursors Watch Bridge: Focus chat by conversationId**, paste id.
5. Answer Yes/No on each confirm prompt until one works or all fail.
6. Switch away; repeat with same id (repeatability).
7. Fill spike-notes Attempts + Repeatability.

If visual repeatable focus via commands → Task 4 **skip**; go Task 5 with `pass`.

---

### Task 4: CDP fallback probe (only if Task 3 visual focus failed)

**Files:**
- Create: `cursor-watch/extensions/cursor-watch-bridge/scripts/cdp-focus.mjs`
- Modify: `cursor-watch/extensions/cursor-watch-bridge/src/focus-probe.ts` — after command loop, prompt for CDP sidecar result
- Update: spike-notes

**Interfaces:**
- Produces: `tryFocusChatViaCdp(opts: { conversationId: string; log: (s: string) => void; confirm: () => Promise<boolean> }): Promise<ProbeAttempt>`

- [ ] **Step 1: Skip gate**

If Task 3 already achieved visual repeatable focus → **skip entire Task 4**; note “CDP not attempted”.

- [ ] **Step 2: Sidecar CDP script (not in-extension WS)**

CDP runs as a **Node sidecar** (avoids extension-host WebSocket/deps pain):

Create `cursor-watch/extensions/cursor-watch-bridge/scripts/cdp-focus.mjs` that:

1. `GET http://127.0.0.1:9222/json/list`
2. Picks a `page` / `webview` target whose title/url looks like the Cursor workbench
3. Connects via the target’s `webSocketDebuggerUrl` using Node built-in `websocket` (Node 22+) or `ws` if needed — prefer Node 22 `WebSocket` global
4. Sends CDP `Runtime.evaluate` to search the DOM for the `conversationId` string (or chat title argv) and `.click()` the matching row
5. Prints `OK` or `FAIL` + selector used to stdout

Require Cursor launched with:

```bash
open -a Cursor --args --remote-debugging-port=9222
```

Run:

```bash
node cursor-watch/extensions/cursor-watch-bridge/scripts/cdp-focus.mjs <conversationId>
```

In `focus-probe.ts`, when all command attempts failed, append one CDP attempt by prompting the human:

```ts
deps.log("Command path failed. Run: node .../cdp-focus.mjs <id> then confirm.");
const visual = await confirm();
attempts.push({
  strategy: "cdp",
  ok: visual,
  detail: visual ? "sidecar cdp-focus.mjs + visual yes" : "sidecar cdp visual no",
});
```

Mark script header: `// FRAGILE: DOM selectors break across Cursor versions.`

- [ ] **Step 3: Manual CDP run**

1. Relaunch Cursor with `--remote-debugging-port=9222`.
2. Run the sidecar with a real id; tune selectors until click works or abandon.
3. Run extension `focusById` (or just record Yes/No in notes) after sidecar.
4. Record selectors + Cursor version; verdict `fragile_pass` or `fail`.

---

### Task 5: Finalize spike-notes + stop/go recommendation

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-cursor-watch-open-chat-spike-notes.md`

- [ ] **Step 1: Fill Environment + Verdict checkboxes**

- [ ] **Step 2: Append Recommendation**

```markdown
## Recommendation

- If **pass**: open product implementation plan (register bridge, `/api/open-chat`, default install) — new plan file, do not extend this spike plan.
- If **fragile_pass**: stop for human re-approval; pin Cursor version; list breakage risks.
- If **fail**: do not implement open-chat product; change success criteria in design spec or park the feature.
```

- [ ] **Step 3: Unit tests still green**

```bash
cd /Users/zhangcheng/idea/Cursors/cursor-watch && npx vitest run tests/spike-verdict.test.ts tests/focus-probe-prefer.test.ts
```

Expected: PASS.

- [ ] **Step 4: Hand back to human with verdict**

Do not start product work in this plan.

---

## Spec coverage (self-review)

| Spec §4 requirement | Task |
|---------------------|------|
| Minimal extension | Task 2 |
| Real conversationId probe | Task 3 |
| Prefer internal commands | Task 3 |
| CDP only if needed; fragile | Task 4 |
| Record Cursor version + evidence | Task 5 / notes |
| 过线 / 脆弱过线 / 未过 | `classifySpikeVerdict` + Task 5 |
| No daemon / panel / install | Global Constraints |
| Repeatability | Task 3 Step 4 / notes |
| Identity = composerId | Manual id from Watch / headers |

## Out of scope (later product plan)

- `POST /api/bridge/register`, heartbeat, `POST /api/open-chat`
- Panel `↗` → open-chat
- App default install hooks + VSIX
- Startup self-check
- Notification entry
