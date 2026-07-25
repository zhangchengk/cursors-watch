import fs from "node:fs";
import { prefsFile, stateDir } from "./constants.js";

export interface WatchPrefs {
  notificationSound: boolean;
}

export const DEFAULT_WATCH_PREFS: WatchPrefs = {
  notificationSound: false,
};

function ensureStateDir(home: string): void {
  fs.mkdirSync(stateDir(home), { recursive: true });
}

function isWatchPrefs(raw: unknown): raw is WatchPrefs {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return typeof o.notificationSound === "boolean";
}

export function loadWatchPrefs(home: string): WatchPrefs {
  const file = prefsFile(home);
  if (!fs.existsSync(file)) return { ...DEFAULT_WATCH_PREFS };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!isWatchPrefs(raw)) return { ...DEFAULT_WATCH_PREFS };
    return { notificationSound: raw.notificationSound };
  } catch {
    return { ...DEFAULT_WATCH_PREFS };
  }
}

export function saveWatchPrefs(home: string, prefs: WatchPrefs): void {
  ensureStateDir(home);
  const file = prefsFile(home);
  const tmp = `${file}.${process.pid}.tmp`;
  const next: WatchPrefs = {
    notificationSound: prefs.notificationSound,
  };
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}
