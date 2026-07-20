import fs from "node:fs";
import {
  type ComposerHeaderMeta,
  composerStateDbCandidates,
  loadComposerHeadersMetaFromHome,
} from "./chat-names.js";
import {
  buildWorkspaceIndex,
  resolveWorkspace as resolveWorkspacePath,
  type WorkspaceIndex,
} from "./workspace.js";

export type ScanCachesDeps = {
  loadHeaders?: (home: string) => Map<string, ComposerHeaderMeta>;
  dbMtimeMs?: (home: string) => number;
  buildIndex?: (home: string) => WorkspaceIndex;
};

/** Max mtimeMs among existing composer state DB candidates; 0 if none. */
export function maxComposerDbMtimeMs(homeDir: string): number {
  let max = 0;
  for (const p of composerStateDbCandidates(homeDir)) {
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

  private headers: Map<string, ComposerHeaderMeta> | undefined;
  private headersMtime = -1;
  private index: WorkspaceIndex | undefined;

  constructor(homeDir: string, deps?: ScanCachesDeps) {
    this.homeDir = homeDir;
    this.loadHeaders = deps?.loadHeaders ?? loadComposerHeadersMetaFromHome;
    this.dbMtimeMs = deps?.dbMtimeMs ?? maxComposerDbMtimeMs;
    this.buildIndex = deps?.buildIndex ?? buildWorkspaceIndex;
  }

  /** Reload headers if db mtime changed (or first call). */
  getHeaders(): Map<string, ComposerHeaderMeta> {
    const mtime = this.dbMtimeMs(this.homeDir);
    if (this.headers === undefined || mtime > this.headersMtime) {
      this.headers = this.loadHeaders(this.homeDir);
      this.headersMtime = mtime;
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
