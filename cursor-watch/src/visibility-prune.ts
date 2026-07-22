import { isSessionVisible, workspaceDirExists } from "./aggregator.js";
import type { SessionStore } from "./store.js";

export function pruneInvisibleSessions(opts: {
  store: SessionStore;
  now?: number;
  workspaceExists?: (workspacePath: string) => boolean;
}): number {
  const now = opts.now ?? Date.now();
  const workspaceExists = opts.workspaceExists ?? workspaceDirExists;
  let removed = 0;
  for (const s of opts.store.getSessions()) {
    if (!isSessionVisible(s, now, workspaceExists)) {
      opts.store.remove(s.id);
      removed += 1;
    }
  }
  return removed;
}
