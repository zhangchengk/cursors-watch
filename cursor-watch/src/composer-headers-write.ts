import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { composerStateDbCandidates } from "./chat-names.js";

export function resolveComposerStateDbPath(home: string): string | null {
  for (const p of composerStateDbCandidates(home)) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export type ComposerHeaderProbe =
  | { status: "missing" }
  | { status: "empty_value" }
  | { status: "invalid_json" }
  | { status: "ready" };

export type BumpHeaderResult =
  | { ok: true }
  | { ok: false; error: string };

export function probeComposerHeaderOnDb(
  db: DatabaseSync,
  composerId: string,
): ComposerHeaderProbe {
  const row = db
    .prepare("SELECT value FROM composerHeaders WHERE composerId = ?")
    .get(composerId) as { value: string } | undefined;
  if (!row) return { status: "missing" };
  if (typeof row.value !== "string" || !row.value.trim()) {
    return { status: "empty_value" };
  }
  try {
    JSON.parse(row.value) as Record<string, unknown>;
    return { status: "ready" };
  } catch {
    return { status: "invalid_json" };
  }
}

export function probeComposerHeader(
  dbPath: string,
  composerId: string,
): ComposerHeaderProbe {
  if (!dbPath || !composerId.trim()) return { status: "missing" };
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    return probeComposerHeaderOnDb(db, composerId);
  } catch {
    return { status: "missing" };
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

/** Bump lastUpdatedAt on an already-open writable database connection. */
export function bumpComposerHeaderOnDb(
  db: DatabaseSync,
  composerId: string,
  ts: number,
): BumpHeaderResult {
  const probe = probeComposerHeaderOnDb(db, composerId);
  if (probe.status === "missing" || probe.status === "empty_value") {
    return { ok: false, error: "no header row" };
  }
  if (probe.status === "invalid_json") {
    return { ok: false, error: "invalid header JSON" };
  }
  try {
    const row = db
      .prepare("SELECT value FROM composerHeaders WHERE composerId = ?")
      .get(composerId) as { value: string };
    const parsed = JSON.parse(row.value) as Record<string, unknown>;
    parsed.lastUpdatedAt = ts;
    db.prepare("UPDATE composerHeaders SET value = ? WHERE composerId = ?").run(
      JSON.stringify(parsed),
      composerId,
    );
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * UPDATE composerHeaders.value JSON lastUpdatedAt only; row must exist with valid JSON.
 */
export function bumpComposerHeaderLastUpdatedAt(
  dbPath: string,
  composerId: string,
  ts: number,
): BumpHeaderResult {
  if (!dbPath || !composerId.trim()) {
    return { ok: false, error: "missing dbPath or composerId" };
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath);
    return bumpComposerHeaderOnDb(db, composerId, ts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

export function readComposerHeaderLastUpdatedAt(
  dbPath: string,
  composerId: string,
): number | null {
  if (!dbPath) return null;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const probe = probeComposerHeaderOnDb(db, composerId);
    if (probe.status !== "ready") return null;
    const row = db
      .prepare("SELECT value FROM composerHeaders WHERE composerId = ?")
      .get(composerId) as { value: string };
    const parsed = JSON.parse(row.value) as { lastUpdatedAt?: unknown };
    return typeof parsed.lastUpdatedAt === "number" && Number.isFinite(parsed.lastUpdatedAt)
      ? parsed.lastUpdatedAt
      : null;
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}
