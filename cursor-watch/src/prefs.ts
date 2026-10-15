import fs from "node:fs";
import { prefsFile, stateDir } from "./constants.js";

export const UI_THEMES = ["phosphor", "blueprint", "ink", "brass"] as const;
export type UiTheme = (typeof UI_THEMES)[number];

export interface LibraryHeaderRefreshLast {
  at: number;
  refreshed: number;
  skippedNoHeader: number;
  failed: number;
}

export interface WatchPrefs {
  notificationSound: boolean;
  workspaceAliases: Record<string, string>;
  uiTheme: UiTheme;
  /** Written only by library header refresh apply; not patchable via PUT. */
  libraryHeaderRefreshLast?: LibraryHeaderRefreshLast;
}

export const DEFAULT_WATCH_PREFS: WatchPrefs = {
  notificationSound: false,
  workspaceAliases: {},
  uiTheme: "blueprint",
};

export type WatchPrefsPatchResult =
  | { ok: true; prefs: WatchPrefs }
  | { ok: false; error: string };

function ensureStateDir(home: string): void {
  fs.mkdirSync(stateDir(home), { recursive: true });
}

export function isUiTheme(raw: unknown): raw is UiTheme {
  return typeof raw === "string" && (UI_THEMES as readonly string[]).includes(raw);
}

export function normalizeUiTheme(raw: unknown): UiTheme {
  return isUiTheme(raw) ? raw : DEFAULT_WATCH_PREFS.uiTheme;
}

/** Keep only absolute-path keys with trimmed non-empty nickname values. */
export function normalizeWorkspaceAliases(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const pathKey = key.trim();
    if (!pathKey) continue;
    if (typeof value !== "string") continue;
    const nick = value.trim();
    if (!nick) continue;
    out[pathKey] = nick;
  }
  return out;
}

/**
 * Validate a client-submitted aliases map for PUT.
 * Empty / non-string values are rejected (deletion = omit key).
 */
export function parseWorkspaceAliasesInput(
  raw: unknown,
): { ok: true; aliases: Record<string, string> } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "workspaceAliases must be an object" };
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const pathKey = typeof key === "string" ? key.trim() : "";
    if (!pathKey) {
      return { ok: false, error: "workspaceAliases keys must be non-empty paths" };
    }
    if (typeof value !== "string") {
      return { ok: false, error: "workspaceAliases values must be strings" };
    }
    const nick = value.trim();
    if (!nick) {
      return {
        ok: false,
        error: "workspaceAliases values must be non-empty; omit key to delete",
      };
    }
    out[pathKey] = nick;
  }
  return { ok: true, aliases: out };
}

export function applyWatchPrefsPatch(
  current: WatchPrefs,
  body: unknown,
): WatchPrefsPatchResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  const o = body as Record<string, unknown>;
  const hasSound = Object.prototype.hasOwnProperty.call(o, "notificationSound");
  const hasAliases = Object.prototype.hasOwnProperty.call(o, "workspaceAliases");
  const hasTheme = Object.prototype.hasOwnProperty.call(o, "uiTheme");
  if (!hasSound && !hasAliases && !hasTheme) {
    return {
      ok: false,
      error: "notificationSound, workspaceAliases, and/or uiTheme required",
    };
  }

  let notificationSound = current.notificationSound;
  let workspaceAliases = { ...current.workspaceAliases };
  let uiTheme = current.uiTheme;

  if (hasSound) {
    if (typeof o.notificationSound !== "boolean") {
      return { ok: false, error: "notificationSound must be boolean" };
    }
    notificationSound = o.notificationSound;
  }

  if (hasAliases) {
    const parsed = parseWorkspaceAliasesInput(o.workspaceAliases);
    if (!parsed.ok) return parsed;
    workspaceAliases = parsed.aliases;
  }

  if (hasTheme) {
    if (!isUiTheme(o.uiTheme)) {
      return {
        ok: false,
        error: `uiTheme must be one of: ${UI_THEMES.join(", ")}`,
      };
    }
    uiTheme = o.uiTheme;
  }

  return {
    ok: true,
    prefs: { notificationSound, workspaceAliases, uiTheme },
  };
}

function coerceLibraryHeaderRefreshLast(raw: unknown): LibraryHeaderRefreshLast | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.at !== "number" || !Number.isFinite(o.at)) return undefined;
  if (typeof o.refreshed !== "number" || !Number.isFinite(o.refreshed)) return undefined;
  if (typeof o.skippedNoHeader !== "number" || !Number.isFinite(o.skippedNoHeader)) {
    return undefined;
  }
  if (typeof o.failed !== "number" || !Number.isFinite(o.failed)) return undefined;
  return {
    at: o.at,
    refreshed: o.refreshed,
    skippedNoHeader: o.skippedNoHeader,
    failed: o.failed,
  };
}

function coerceLoadedPrefs(raw: unknown): WatchPrefs | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.notificationSound !== "boolean") return null;
  const last = coerceLibraryHeaderRefreshLast(o.libraryHeaderRefreshLast);
  return {
    notificationSound: o.notificationSound,
    workspaceAliases: normalizeWorkspaceAliases(o.workspaceAliases),
    uiTheme: normalizeUiTheme(o.uiTheme),
    ...(last ? { libraryHeaderRefreshLast: last } : {}),
  };
}

function cloneDefaults(): WatchPrefs {
  return {
    notificationSound: DEFAULT_WATCH_PREFS.notificationSound,
    workspaceAliases: {},
    uiTheme: DEFAULT_WATCH_PREFS.uiTheme,
  };
}

export function loadWatchPrefs(home: string): WatchPrefs {
  const file = prefsFile(home);
  if (!fs.existsSync(file)) return cloneDefaults();
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    const prefs = coerceLoadedPrefs(raw);
    if (!prefs) return cloneDefaults();
    return prefs;
  } catch {
    return cloneDefaults();
  }
}

export function saveWatchPrefs(home: string, prefs: WatchPrefs): void {
  ensureStateDir(home);
  const file = prefsFile(home);
  const tmp = `${file}.${process.pid}.tmp`;
  const existing = loadWatchPrefs(home);
  const next: WatchPrefs = {
    notificationSound: prefs.notificationSound,
    workspaceAliases: normalizeWorkspaceAliases(prefs.workspaceAliases),
    uiTheme: normalizeUiTheme(prefs.uiTheme),
    libraryHeaderRefreshLast:
      prefs.libraryHeaderRefreshLast ?? existing.libraryHeaderRefreshLast,
  };
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

export function saveLibraryHeaderRefreshLast(
  home: string,
  summary: LibraryHeaderRefreshLast,
): void {
  const current = loadWatchPrefs(home);
  saveWatchPrefs(home, { ...current, libraryHeaderRefreshLast: summary });
}
