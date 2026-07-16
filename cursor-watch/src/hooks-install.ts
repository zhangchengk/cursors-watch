import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOOK_COMMAND_MARKER,
  HOOK_SCRIPT_NAME,
  cursorUserHooksDir,
  cursorUserHooksJson,
  liveDir,
} from "./constants.js";

const MANAGED_EVENTS = ["preToolUse", "afterAgentResponse", "stop"] as const;

type HookEntry = { command: string; timeout?: number; failClosed?: boolean; [k: string]: unknown };
type HooksFile = {
  version?: number;
  hooks?: Record<string, HookEntry[]>;
};

function templateScriptPath(): string {
  return path.join(fileURLToPath(new URL("./hooks/cursor-watch-observe.mjs", import.meta.url)));
}

function isOurs(entry: HookEntry): boolean {
  return typeof entry?.command === "string" && entry.command.includes(HOOK_COMMAND_MARKER);
}

function hookCommand(): string {
  // User hooks cwd is ~/.cursor/; relative path keeps install portable.
  return `./hooks/${HOOK_SCRIPT_NAME}`;
}

function ourEntry(): HookEntry {
  return { command: hookCommand(), timeout: 2 };
}

function readHooksFile(hooksJson: string): HooksFile {
  try {
    const raw = fs.readFileSync(hooksJson, "utf8");
    const parsed = JSON.parse(raw) as HooksFile;
    if (!parsed || typeof parsed !== "object") return { version: 1, hooks: {} };
    if (!parsed.hooks || typeof parsed.hooks !== "object") parsed.hooks = {};
    return parsed;
  } catch {
    return { version: 1, hooks: {} };
  }
}

function writeHooksFile(hooksJson: string, data: HooksFile): void {
  fs.mkdirSync(path.dirname(hooksJson), { recursive: true });
  fs.writeFileSync(hooksJson, JSON.stringify(data, null, 2) + "\n");
}

function copyObserveScript(scriptPath: string): void {
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.copyFileSync(templateScriptPath(), scriptPath);
  try {
    fs.chmodSync(scriptPath, 0o755);
  } catch {
    /* best-effort on platforms without chmod */
  }
}

function isLiveDirWritable(home?: string): boolean {
  const dir = liveDir(home);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export function installHooks(home?: string): { hooksJson: string; scriptPath: string } {
  const hooksJson = cursorUserHooksJson(home);
  const scriptPath = path.join(cursorUserHooksDir(home), HOOK_SCRIPT_NAME);
  copyObserveScript(scriptPath);

  const data = readHooksFile(hooksJson);
  const hooks = data.hooks ?? (data.hooks = {});
  const entry = ourEntry();

  for (const event of MANAGED_EVENTS) {
    const list = Array.isArray(hooks[event]) ? hooks[event]! : [];
    const others = list.filter((e) => !isOurs(e));
    hooks[event] = [...others, entry];
  }

  data.version = data.version ?? 1;
  writeHooksFile(hooksJson, data);
  return { hooksJson, scriptPath };
}

export function uninstallHooks(home?: string): { removed: boolean } {
  const hooksJson = cursorUserHooksJson(home);
  const scriptPath = path.join(cursorUserHooksDir(home), HOOK_SCRIPT_NAME);
  let removed = false;

  if (fs.existsSync(hooksJson)) {
    const data = readHooksFile(hooksJson);
    const hooks = data.hooks ?? {};
    for (const event of MANAGED_EVENTS) {
      const list = Array.isArray(hooks[event]) ? hooks[event]! : [];
      const kept = list.filter((e) => !isOurs(e));
      if (kept.length !== list.length) removed = true;
      if (kept.length === 0) delete hooks[event];
      else hooks[event] = kept;
    }
    data.hooks = hooks;
    writeHooksFile(hooksJson, data);
  }

  try {
    if (fs.existsSync(scriptPath)) {
      fs.unlinkSync(scriptPath);
      removed = true;
    }
  } catch {
    /* ignore */
  }

  return { removed };
}

export function hooksStatus(home?: string): {
  installed: boolean;
  hooksJson: string;
  scriptPath: string;
  liveDirWritable: boolean;
} {
  const hooksJson = cursorUserHooksJson(home);
  const scriptPath = path.join(cursorUserHooksDir(home), HOOK_SCRIPT_NAME);
  const scriptOk = fs.existsSync(scriptPath);

  let hooksOk = false;
  try {
    const data = readHooksFile(hooksJson);
    hooksOk = MANAGED_EVENTS.every((event) => {
      const list = data.hooks?.[event];
      return Array.isArray(list) && list.some(isOurs);
    });
  } catch {
    hooksOk = false;
  }

  return {
    installed: scriptOk && hooksOk,
    hooksJson,
    scriptPath,
    liveDirWritable: isLiveDirWritable(home),
  };
}
