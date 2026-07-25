import {
  FULL_SCAN_INTERVAL_MS,
  INCREMENTAL_DEBOUNCE_MS,
  VISIBILITY_PRUNE_MS,
  liveDir,
} from "./constants.js";
import {
  applyLivePatch as defaultApplyLivePatch,
  rescanParentSession as defaultRescanParentSession,
  rescanProjectShells as defaultRescanProjectShells,
  syncComposerHeaders as defaultSyncComposerHeaders,
} from "./incremental-scan.js";
import type { ScanCaches } from "./scan-caches.js";
import type { SessionStore } from "./store.js";
import { pruneInvisibleSessions } from "./visibility-prune.js";
import { classifyWatchPath } from "./watch-path.js";

const FULL_SCAN_DEBOUNCE_MS = 300;
const HEADERS_SYNC_DEBOUNCE_MS = 300;

export type IncrementalHandlers = {
  applyLivePatch: typeof defaultApplyLivePatch;
  rescanParentSession: typeof defaultRescanParentSession;
  rescanProjectShells: typeof defaultRescanProjectShells;
  syncComposerHeaders: typeof defaultSyncComposerHeaders;
};

export function createRefreshController(opts: {
  projectsDir: string;
  homeDir: string;
  store: SessionStore;
  caches: ScanCaches;
  runFullScan: () => void;
  now?: () => number;
  incremental?: Partial<IncrementalHandlers>;
  /** Forwarded to applyLivePatch → onEffectiveTurnEnd (WS reminders). */
  onReminderChanged?: () => void;
}): {
  onFsEvent: (event: string, filePath: string) => void;
  onComposerDbEvent: () => void;
  start: () => void;
  close: () => void;
  notifyFullScanComplete: () => void;
} {
  const applyLivePatch = opts.incremental?.applyLivePatch ?? defaultApplyLivePatch;
  const rescanParentSession =
    opts.incremental?.rescanParentSession ?? defaultRescanParentSession;
  const rescanProjectShells =
    opts.incremental?.rescanProjectShells ?? defaultRescanProjectShells;
  const syncComposerHeaders =
    opts.incremental?.syncComposerHeaders ?? defaultSyncComposerHeaders;
  const nowFn = opts.now ?? Date.now;
  const liveRoot = liveDir(opts.homeDir);

  let fullScanInFlight = false;
  let pendingFullScan = false;
  let scanGeneration = 0;
  let fullScanTimer: ReturnType<typeof setTimeout> | null = null;
  let headersSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let pruneTimer: ReturnType<typeof setInterval> | null = null;
  const keyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingIncrementalKeys = new Set<string>();

  function doFullScan(): void {
    if (fullScanInFlight) {
      pendingFullScan = true;
      return;
    }
    fullScanInFlight = true;
    opts.runFullScan();
  }

  function scheduleFullScan(): void {
    if (fullScanTimer) clearTimeout(fullScanTimer);
    fullScanTimer = setTimeout(() => {
      fullScanTimer = null;
      doFullScan();
    }, FULL_SCAN_DEBOUNCE_MS);
  }

  function scheduleKey(key: string): void {
    const existing = keyTimers.get(key);
    if (existing) clearTimeout(existing);
    keyTimers.set(
      key,
      setTimeout(() => {
        keyTimers.delete(key);
        flushKey(key);
      }, INCREMENTAL_DEBOUNCE_MS),
    );
  }

  function flushHeadersSync(): void {
    if (fullScanInFlight) {
      pendingIncrementalKeys.add("headers:");
      return;
    }
    try {
      syncComposerHeaders({
        store: opts.store,
        caches: opts.caches,
        homeDir: opts.homeDir,
        now: nowFn(),
      });
    } catch (err) {
      console.error("[cursor-watch] composer headers sync failed", err);
    }
  }

  function onComposerDbEvent(): void {
    if (headersSyncTimer) clearTimeout(headersSyncTimer);
    headersSyncTimer = setTimeout(() => {
      headersSyncTimer = null;
      flushHeadersSync();
    }, HEADERS_SYNC_DEBOUNCE_MS);
  }

  function flushKey(key: string): void {
    if (fullScanInFlight) {
      pendingIncrementalKeys.add(key);
      return;
    }
    if (key === "headers:") {
      flushHeadersSync();
      return;
    }
    executeIncremental(key);
  }

  function executeIncremental(key: string): void {
    const gen = scanGeneration;
    const now = nowFn();
    try {
      if (key.startsWith("live:")) {
        const conversationId = key.slice("live:".length);
        applyLivePatch({
          conversationId,
          store: opts.store,
          caches: opts.caches,
          homeDir: opts.homeDir,
          projectsDir: opts.projectsDir,
          now,
          onReminderChanged: opts.onReminderChanged,
        });
        return;
      }

      if (key.startsWith("shell:")) {
        const projectKey = key.slice("shell:".length);
        rescanProjectShells({
          projectsDir: opts.projectsDir,
          projectKey,
          store: opts.store,
          caches: opts.caches,
          homeDir: opts.homeDir,
          now,
        });
        return;
      }

      if (key.startsWith("session:")) {
        const rest = key.slice("session:".length);
        const colon = rest.indexOf(":");
        if (colon < 0) {
          scheduleFullScan();
          return;
        }
        const projectKey = rest.slice(0, colon);
        const sessionId = rest.slice(colon + 1);
        const next = rescanParentSession({
          projectsDir: opts.projectsDir,
          homeDir: opts.homeDir,
          projectKey,
          sessionId,
          caches: opts.caches,
          now,
        });
        if (gen !== scanGeneration) return;
        if (next) opts.store.upsert(next);
        else opts.store.remove(sessionId);
        return;
      }

      scheduleFullScan();
    } catch (err) {
      console.error("[cursor-watch] incremental refresh failed", err);
      scheduleFullScan();
    }
  }

  function notifyFullScanComplete(): void {
    scanGeneration += 1;
    fullScanInFlight = false;
    // Worker loaded fresh headers; drop daemon cache so incremental cannot
    // overwrite hasUnread with a stale false.
    opts.caches.invalidateHeaders();
    if (pendingFullScan) {
      pendingFullScan = false;
      doFullScan();
      return;
    }
    if (pendingIncrementalKeys.size === 0) return;
    const keys = [...pendingIncrementalKeys];
    pendingIncrementalKeys.clear();
    for (const key of keys) {
      if (key === "headers:") flushHeadersSync();
      else scheduleKey(key);
    }
  }

  function onFsEvent(event: string, filePath: string): void {
    // Directory create/remove (session/subagents/terminals folders) is noise —
    // classifyWatchPath would return unknown and wrongly force a full scan.
    if (event === "addDir" || event === "unlinkDir") {
      return;
    }

    const classified = classifyWatchPath(filePath, {
      projectsDir: opts.projectsDir,
      liveDir: liveRoot,
    });

    switch (classified.kind) {
      case "unknown":
        scheduleFullScan();
        return;
      case "live":
        scheduleKey(`live:${classified.conversationId}`);
        return;
      case "terminal":
        scheduleKey(`shell:${classified.projectKey}`);
        return;
      case "transcript_main":
        scheduleKey(
          `session:${classified.projectKey}:${classified.sessionId}`,
        );
        return;
      case "transcript_subagent":
        scheduleKey(
          `session:${classified.projectKey}:${classified.parentId}`,
        );
        return;
    }
  }

  function start(): void {
    doFullScan();
    intervalId = setInterval(doFullScan, FULL_SCAN_INTERVAL_MS);
    pruneTimer = setInterval(() => {
      try {
        pruneInvisibleSessions({ store: opts.store });
      } catch (err) {
        console.error("[cursor-watch] visibility prune failed", err);
      }
    }, VISIBILITY_PRUNE_MS);
  }

  function close(): void {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (pruneTimer) {
      clearInterval(pruneTimer);
      pruneTimer = null;
    }
    if (fullScanTimer) {
      clearTimeout(fullScanTimer);
      fullScanTimer = null;
    }
    if (headersSyncTimer) {
      clearTimeout(headersSyncTimer);
      headersSyncTimer = null;
    }
    for (const t of keyTimers.values()) clearTimeout(t);
    keyTimers.clear();
    pendingIncrementalKeys.clear();
    pendingFullScan = false;
    fullScanInFlight = false;
  }

  return {
    onFsEvent,
    onComposerDbEvent,
    start,
    close,
    notifyFullScanComplete,
  };
}
