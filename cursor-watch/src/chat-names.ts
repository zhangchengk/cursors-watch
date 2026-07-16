import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface ComposerHeaderMeta {
  chatName?: string;
  composerUpdatedAt?: number;
  hasUnread: boolean;
  subtitle?: string;
}

/** Candidate paths for Cursor global state (macOS + Linux). */
export function composerStateDbCandidates(home = os.homedir()): string[] {
  return [
    path.join(
      home,
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    ),
    path.join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb"),
  ];
}

type HeaderValue = {
  name?: unknown;
  hasUnreadMessages?: unknown;
  lastUpdatedAt?: unknown;
  subtitle?: unknown;
};

function parseHeaderMeta(value: string): ComposerHeaderMeta | null {
  let parsed: HeaderValue;
  try {
    parsed = JSON.parse(value) as HeaderValue;
  } catch {
    return null;
  }

  let chatName: string | undefined;
  if (typeof parsed.name === "string") {
    const trimmed = parsed.name.trim();
    if (trimmed) chatName = trimmed;
  }

  const hasUnread = parsed.hasUnreadMessages === true;

  let composerUpdatedAt: number | undefined;
  if (typeof parsed.lastUpdatedAt === "number" && Number.isFinite(parsed.lastUpdatedAt)) {
    composerUpdatedAt = parsed.lastUpdatedAt;
  }

  let subtitle: string | undefined;
  if (typeof parsed.subtitle === "string") {
    const trimmed = parsed.subtitle.trim();
    if (trimmed) subtitle = trimmed;
  }

  if (
    chatName === undefined &&
    composerUpdatedAt === undefined &&
    subtitle === undefined &&
    parsed.hasUnreadMessages !== true
  ) {
    return null;
  }

  return { chatName, composerUpdatedAt, hasUnread, subtitle };
}

/**
 * Load composerId → header meta from Cursor's composerHeaders table.
 * Returns empty map on any read failure (missing file, locked DB, schema drift).
 * Rows without a usable name may still appear when other fields are present.
 */
export function loadComposerHeadersMeta(
  dbPath: string,
): Map<string, ComposerHeaderMeta> {
  const out = new Map<string, ComposerHeaderMeta>();
  if (!dbPath || !fs.existsSync(dbPath)) return out;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare("SELECT composerId, value FROM composerHeaders")
      .all() as Array<{ composerId: string; value: string }>;
    for (const row of rows) {
      if (!row?.composerId || !row.value) continue;
      const meta = parseHeaderMeta(row.value);
      if (!meta) continue;
      out.set(row.composerId, meta);
    }
  } catch {
    /* locked / schema change / experimental sqlite quirks */
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Load from the first existing candidate DB under home. */
export function loadComposerHeadersMetaFromHome(
  home = os.homedir(),
): Map<string, ComposerHeaderMeta> {
  for (const p of composerStateDbCandidates(home)) {
    if (!fs.existsSync(p)) continue;
    return loadComposerHeadersMeta(p);
  }
  return new Map();
}

/**
 * Load composerId → chat name from Cursor's composerHeaders table.
 * Returns empty map on any read failure (missing file, locked DB, schema drift).
 */
export function loadComposerChatNames(dbPath: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, meta] of loadComposerHeadersMeta(dbPath)) {
    if (meta.chatName) out.set(id, meta.chatName);
  }
  return out;
}

/** Load from the first existing candidate DB under home. */
export function loadComposerChatNamesFromHome(
  home = os.homedir(),
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, meta] of loadComposerHeadersMetaFromHome(home)) {
    if (meta.chatName) out.set(id, meta.chatName);
  }
  return out;
}

export function pickSessionTitle(
  chatName: string | undefined,
  summary: string,
): string {
  const name = chatName?.trim();
  return name || summary;
}
