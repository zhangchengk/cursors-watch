import {
  FULL_SCAN_INTERVAL_MS,
  INCREMENTAL_DEBOUNCE_MS,
  liveDir,
} from "./constants.js";
import {
  applyLivePatch as defaultApplyLivePatch,
  rescanParentSession as defaultRescanParentSession,
  rescanProjectShells as defaultRescanProjectShells,
} from "./incremental-scan.js";
import type { ScanCaches } from "./scan-caches.js";
import type { SessionStore } from "./store.js";
import { classifyWatchPath } from "./watch-path.js";

const FULL_SCAN_DEBOUNCE_MS = 300;

export type IncrementalHandlers = {
  applyLivePatch: typeof defaultApplyLivePatch;
  rescanParentSession: typeof defaultRescanParentSession;
  rescanProjectShells: typeof defaultRescanProjectShells;
};

export function createRefreshController(opts: {
  projectsDir: string;
  homeDir: string;
  store: SessionStore;
  caches: ScanCaches;
  runFullScan: () => void;
  now?: () => number;
  incremental?: IncrementalHandlers;
}): {
  onFsEvent: (event: string, filePath: string) => void;
  start: () => void;
  close: () => void;
  notifyFullScanComplete: () => void;
} {
  const applyLivePatch = opts.incremental?.applyLivePatch ?? defaultApplyLivePatch;
  const rescanParentSession =
    opts.incremental?.rescanParentSession ?? defaultRescanParentSession;
  const rescanProjectShells =
    opts.incremental?.rescanProjectShells ?? defaultRescanProjectShells;
  const nowFn = opts.now ?? Date.now;
  const liveRoot = liveDir(opts.homeDir);

  let fullScanInFlight = false;
  let pendingFullScan = false;
  let scanGeneration = 0;
  let fullScanTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
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

  function flushKey(key: string): void {
    if (fullScanInFlight) {
      pendingIncrementalKeys.add(key);
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
    if (pendingFullScan) {
      pendingFullScan = false;
      doFullScan();
      return;
    }
    if (pendingIncrementalKeys.size === 0) return;
    const keys = [...pendingIncrementalKeys];
    pendingIncrementalKeys.clear();
    for (const key of keys) scheduleKey(key);
  }

  function onFsEvent(_event: string, filePath: string): void {
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
  }

  function close(): void {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (fullScanTimer) {
      clearTimeout(fullScanTimer);
      fullScanTimer = null;
    }
    for (const t of keyTimers.values()) clearTimeout(t);
    keyTimers.clear();
    pendingIncrementalKeys.clear();
    pendingFullScan = false;
    fullScanInFlight = false;
  }

  return {
    onFsEvent,
    start,
    close,
    notifyFullScanComplete,
  };
}
