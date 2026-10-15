import { DatabaseSync } from "node:sqlite";
import type { LibraryEntry, LibraryMark } from "./library/types.js";
import {
  bumpComposerHeaderOnDb,
  probeComposerHeaderOnDb,
  resolveComposerStateDbPath,
} from "./composer-headers-write.js";
import { isCursorRunning } from "./cursor-process.js";
import type { LibraryHeaderRefreshLast } from "./prefs.js";
import { saveLibraryHeaderRefreshLast } from "./prefs.js";

export type LibraryRefreshTarget = {
  conversationId: string;
  mark: LibraryMark;
  title?: string;
};

export type LibraryHeaderRefreshSample = LibraryRefreshTarget;

export type LibraryHeaderRefreshSuccess = {
  ok: true;
  dryRun: boolean;
  batchTs: number | null;
  /** False when state.vscdb was not found under home. */
  stateDbFound: boolean;
  targetCount: number;
  refreshed: number;
  skippedNoHeader: number;
  failed: number;
  samples: LibraryHeaderRefreshSample[];
};

export type LibraryHeaderRefreshFailure = {
  ok: false;
  statusCode: 409 | 400;
  error: string;
};

export type LibraryHeaderRefreshResult =
  | LibraryHeaderRefreshSuccess
  | LibraryHeaderRefreshFailure;

const SAMPLE_LIMIT = 8;

export function listLibraryRefreshTargets(
  entries: Pick<LibraryEntry, "conversationId" | "mark" | "title">[],
): LibraryRefreshTarget[] {
  const seen = new Set<string>();
  const out: LibraryRefreshTarget[] = [];
  for (const e of entries) {
    if (e.mark !== "todo" && e.mark !== "archive") continue;
    const id = e.conversationId?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      conversationId: id,
      mark: e.mark,
      title: typeof e.title === "string" ? e.title : undefined,
    });
  }
  return out;
}

function probeCountsAsSkippedNoHeader(
  status: ReturnType<typeof probeComposerHeaderOnDb>["status"],
): boolean {
  return status === "missing" || status === "empty_value";
}

function pushSample(
  samples: LibraryHeaderRefreshSample[],
  t: LibraryRefreshTarget,
): void {
  if (samples.length >= SAMPLE_LIMIT) return;
  samples.push({
    conversationId: t.conversationId,
    mark: t.mark,
    title: t.title,
  });
}

export type RunLibraryHeaderRefreshOpts = {
  home: string;
  entries: Pick<LibraryEntry, "conversationId" | "mark" | "title">[];
  dryRun?: boolean;
  batchTs?: number;
  dbPath?: string | null;
  resolveDbPath?: (home: string) => string | null;
  checkCursorRunning?: () => boolean;
  saveLastSummary?: (home: string, summary: LibraryHeaderRefreshLast) => void;
};

export function runLibraryHeaderRefresh(
  opts: RunLibraryHeaderRefreshOpts,
): LibraryHeaderRefreshResult {
  const dryRun = opts.dryRun === true;
  const targets = listLibraryRefreshTargets(opts.entries);
  const targetCount = targets.length;
  const resolveDb = opts.resolveDbPath ?? resolveComposerStateDbPath;
  const dbPath = opts.dbPath !== undefined ? opts.dbPath : resolveDb(opts.home);
  const checkCursor = opts.checkCursorRunning ?? isCursorRunning;

  if (!dryRun) {
    if (process.platform !== "darwin") {
      return {
        ok: false,
        statusCode: 400,
        error: "library header refresh apply is macOS only",
      };
    }
    if (checkCursor()) {
      return {
        ok: false,
        statusCode: 409,
        error: "quit Cursor completely before refreshing composer headers",
      };
    }
    if (!dbPath) {
      return {
        ok: false,
        statusCode: 400,
        error: "Cursor state.vscdb not found",
      };
    }
  }

  const batchTs = dryRun ? null : (opts.batchTs ?? Date.now());

  if (!dbPath) {
    return {
      ok: true,
      dryRun,
      batchTs,
      stateDbFound: false,
      targetCount,
      refreshed: 0,
      skippedNoHeader: 0,
      failed: 0,
      samples: [],
    };
  }

  let refreshed = 0;
  let skippedNoHeader = 0;
  let failed = 0;
  const samples: LibraryHeaderRefreshSample[] = [];

  let db: DatabaseSync | undefined;
  try {
    db = dryRun
      ? new DatabaseSync(dbPath, { readOnly: true })
      : new DatabaseSync(dbPath);
    for (const t of targets) {
      const probe = probeComposerHeaderOnDb(db, t.conversationId);
      if (probeCountsAsSkippedNoHeader(probe.status)) {
        skippedNoHeader++;
        continue;
      }
      if (probe.status === "invalid_json") {
        failed++;
        continue;
      }
      if (dryRun) {
        refreshed++;
        pushSample(samples, t);
        continue;
      }
      const bump = bumpComposerHeaderOnDb(db, t.conversationId, batchTs as number);
      if (bump.ok) {
        refreshed++;
        pushSample(samples, t);
      } else if (bump.error === "no header row") {
        skippedNoHeader++;
      } else {
        failed++;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, statusCode: 400, error: msg };
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }

  if (!dryRun && batchTs != null) {
    const save = opts.saveLastSummary ?? saveLibraryHeaderRefreshLast;
    save(opts.home, {
      at: batchTs,
      refreshed,
      skippedNoHeader,
      failed,
    });
  }

  return {
    ok: true,
    dryRun,
    batchTs,
    stateDbFound: true,
    targetCount,
    refreshed,
    skippedNoHeader,
    failed,
    samples,
  };
}
