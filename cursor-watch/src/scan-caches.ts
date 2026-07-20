import fs from "node:fs";
import {
  type ComposerHeaderMeta,
  composerStateDbCandidates,
  loadComposerHeadersMetaFromHome,
} from "./chat-names.js";
import { HEADERS_CACHE_TTL_MS } from "./constants.js";
import {
  buildWorkspaceIndex,
  resolveWorkspace as resolveWorkspacePath,
  type WorkspaceIndex,
} from "./workspace.js";

export type ScanCachesDeps = {
  loadHeaders?: (home: string) => Map<string, ComposerHeaderMeta>;
  dbMtimeMs?: (home: string) => number;
  buildIndex?: (home: string) => WorkspaceIndex;
  now?: () => number;
};

/** Paths whose mtime should invalidate composer header cache (main + WAL). */
export function composerDbArtifactPaths(homeDir: string): string[] {
  const out: string[] = [];
  for (const p of composerStateDbCandidates(homeDir)) {
    out.push(p, `${p}-wal`, `${p}-shm`);
  }
  return out;
}

/**
 * Paths safe to chokidar-watch for unread/title changes.
 * Prefer WAL only — the main state.vscdb can be tens of GB.
 */
export function composerDbWatchPaths(homeDir: string): string[] {
  const out: string[] = [];
  for (const p of composerStateDbCandidates(homeDir)) {
    const wal = `${p}-wal`;
    if (fs.existsSync(wal)) out.push(wal);
    else if (fs.existsSync(p)) out.push(p);
  }
  return out;
}

/** Max mtimeMs among composer state DB + WAL/SHM artifacts; 0 if none. */
export function maxComposerDbMtimeMs(homeDir: string): number {
  let max = 0;
  for (const p of composerDbArtifactPaths(homeDir)) {
    try {
      if (!fs.existsSync(p)) continue;
      const m = fs.statSync(p).mtimeMs;
      if (m > max) max = m;
    } catch {
      /* ignore missing / permission */
    }
  }
  return max;
}

export class ScanCaches {
  private readonly homeDir: string;
  private readonly loadHeaders: (home: string) => Map<string, ComposerHeaderMeta>;
  private readonly dbMtimeMs: (home: string) => number;
  private readonly buildIndex: (home: string) => WorkspaceIndex;
  private readonly now: () => number;

  private headers: Map<string, ComposerHeaderMeta> | undefined;
  private headersMtime = -1;
  private headersLoadedAt = 0;
  private index: WorkspaceIndex | undefined;

  constructor(homeDir: string, deps?: ScanCachesDeps) {
    this.homeDir = homeDir;
    this.loadHeaders = deps?.loadHeaders ?? loadComposerHeadersMetaFromHome;
    this.dbMtimeMs = deps?.dbMtimeMs ?? maxComposerDbMtimeMs;
    this.buildIndex = deps?.buildIndex ?? buildWorkspaceIndex;
    this.now = deps?.now ?? Date.now;
  }

  /** Drop cached headers so the next getHeaders() reloads from disk. */
  invalidateHeaders(): void {
    this.headers = undefined;
    this.headersMtime = -1;
    this.headersLoadedAt = 0;
  }

  /** Reload headers if db/WAL mtime changed, TTL expired, or first call. */
  getHeaders(): Map<string, ComposerHeaderMeta> {
    const mtime = this.dbMtimeMs(this.homeDir);
    const now = this.now();
    const ttlExpired =
      this.headers !== undefined &&
      now - this.headersLoadedAt >= HEADERS_CACHE_TTL_MS;
    if (
      this.headers === undefined ||
      mtime > this.headersMtime ||
      ttlExpired
    ) {
      this.headers = this.loadHeaders(this.homeDir);
      this.headersMtime = mtime;
      this.headersLoadedAt = now;
    }
    return this.headers;
  }

  getHeader(id: string): ComposerHeaderMeta | undefined {
    return this.getHeaders().get(id);
  }

  /** Rebuild workspace index (call on full scan / when resolve misses). */
  rebuildWorkspaceIndex(): void {
    this.index = this.buildIndex(this.homeDir);
  }

  resolveWorkspace(projectKey: string): {
    workspacePath: string;
    workspaceLabel: string;
  } {
    if (!this.index) this.rebuildWorkspaceIndex();
    let result = resolveWorkspacePath(projectKey, this.homeDir, this.index);
    if (!result.workspacePath) {
      this.rebuildWorkspaceIndex();
      result = resolveWorkspacePath(projectKey, this.homeDir, this.index);
    }
    return result;
  }
}
