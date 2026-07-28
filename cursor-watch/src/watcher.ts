import fs from "node:fs";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";
import { liveDir } from "./constants.js";
import { createRefreshController } from "./refresh-controller.js";
import { createScanFinishGuard } from "./scan-finish-guard.js";
import { ScanCaches } from "./scan-caches.js";
import type { SessionState } from "./types.js";
import type { SessionStore } from "./store.js";
import {
  listWatchRoots,
  projectWatchSubdirs,
  shouldIgnoreWatchPath,
} from "./watch-path.js";
import { composerDbWatchPaths } from "./scan-caches.js";

const workerPath = fileURLToPath(new URL("./scan-worker.ts", import.meta.url));

/** Depth from agent-transcripts/ covers sess/sess.jsonl and sess/subagents/*.jsonl. */
const PROJECT_WATCH_DEPTH = 4;

export type StartWatcherOptions = {
  /** After pipeline upsert — typically ReminderHub.notifyChanged for WS. */
  onReminderChanged?: () => void;
  /** After store.replaceAll from a full scan (remind newly ended turns). */
  onSessionsReplaced?: (
    sessions: SessionState[],
    previous: SessionState[],
  ) => void;
};

export function startWatcher(
  projectsDir: string,
  homeDir: string,
  store: SessionStore,
  opts?: StartWatcherOptions,
): { close: () => Promise<void> } {
  let child: ChildProcess | null = null;
  const caches = new ScanCaches(homeDir);

  const runFullScan = () => {
    if (child) {
      // Controller coalesces via pendingFullScan; ignore overlapping fork.
      return;
    }

    // ignore stdio: with thousands of chokidar FDs, pipe-based fork can throw
    // spawn EBADF and take down the daemon if uncaught.
    let proc: ChildProcess;
    try {
      proc = fork(workerPath, [], {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
    } catch (err) {
      console.error("[cursor-watch] scan fork failed", err);
      child = null;
      setImmediate(() => controller.notifyFullScanComplete());
      return;
    }
    child = proc;
    const { finish, isCurrent } = createScanFinishGuard(
      proc,
      () => child,
      () => {
        child = null;
      },
      () => controller.notifyFullScanComplete(),
    );

    proc.on("message", (msg: SessionState[] | { error: string }) => {
      if (!isCurrent()) {
        // Stale process after a newer fork — kill sender only.
        proc.kill();
        return;
      }
      if (!Array.isArray(msg)) {
        console.error("[cursor-watch] scan failed", msg.error);
      } else {
        try {
          const previous = store.getSessions();
          store.replaceAll(msg);
          console.log(`[cursor-watch] sessions=${msg.length}`);
          opts?.onSessionsReplaced?.(msg, previous);
        } catch (err) {
          console.error("[cursor-watch] store update failed", err);
        }
      }
      proc.kill();
      finish();
    });
    proc.on("error", (err) => {
      console.error("[cursor-watch] scan failed", err);
      finish();
    });
    proc.on("exit", (code) => {
      if (code && code !== 0 && isCurrent()) {
        console.error("[cursor-watch] scan worker exited", code);
      }
      finish();
    });

    try {
      proc.send({ projectsDir, homeDir });
    } catch (err) {
      console.error("[cursor-watch] scan send failed", err);
      proc.kill();
      finish();
    }
  };

  const controller = createRefreshController({
    projectsDir,
    homeDir,
    store,
    caches,
    runFullScan,
    onReminderChanged: opts?.onReminderChanged,
  });

  const livePath = liveDir(homeDir);
  fs.mkdirSync(livePath, { recursive: true });

  // Watch live + each project's agent-transcripts/terminals only (not whole tree).
  const projectsRoot = path.resolve(projectsDir);
  const liveRoot = path.resolve(livePath);
  fs.mkdirSync(projectsRoot, { recursive: true });

  const ignoreWatchPath = (filePath: string, stats?: fs.Stats): boolean =>
    shouldIgnoreWatchPath(
      filePath,
      { projectsDir: projectsRoot, liveDir: liveRoot },
      stats,
    );

  const watchOpts = {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  } as const;

  const watcher = chokidar.watch(listWatchRoots(projectsRoot, liveRoot), {
    ...watchOpts,
    depth: PROJECT_WATCH_DEPTH,
    ignored: ignoreWatchPath,
  });
  watcher.on("all", (event, p) => controller.onFsEvent(event, p));
  watcher.on("error", (err) => {
    console.error("[cursor-watch] watcher error", err);
  });

  // Shallow watch: new project keys under projectsRoot → add their target subdirs.
  const projectsRootWatcher = chokidar.watch(projectsRoot, {
    ...watchOpts,
    depth: 2,
    ignored: (filePath: string, stats?: fs.Stats): boolean => {
      const resolved = path.resolve(filePath);
      if (resolved === projectsRoot) return false;
      const rel = path.relative(projectsRoot, resolved);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return true;
      const parts = rel.split(path.sep);
      if (parts.length === 1) return false; // project key
      if (parts.length === 2) {
        return parts[1] !== "agent-transcripts" && parts[1] !== "terminals";
      }
      return true;
    },
  });
  const addProjectPaths = (projectDir: string) => {
    for (const p of projectWatchSubdirs(projectDir)) {
      watcher.add(p);
    }
  };
  projectsRootWatcher.on("addDir", (dirPath) => {
    const resolved = path.resolve(dirPath);
    const rel = path.relative(projectsRoot, resolved);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return;
    const parts = rel.split(path.sep);
    if (parts.length === 1) {
      addProjectPaths(resolved);
      return;
    }
    if (
      parts.length === 2 &&
      (parts[1] === "agent-transcripts" || parts[1] === "terminals")
    ) {
      watcher.add(resolved);
    }
  });
  projectsRootWatcher.on("error", (err) => {
    console.error("[cursor-watch] projectsRoot watcher error", err);
  });

  // Cursor unread/title live in state.vscdb (often via WAL) — not under projects/.
  // Watch WAL only; the main DB can be tens of GB and must not be watched.
  const composerDbPaths = composerDbWatchPaths(homeDir);
  const composerDbWatcher =
    composerDbPaths.length > 0
      ? chokidar.watch(composerDbPaths, {
          ignoreInitial: true,
          awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
          // Avoid deep scans / content hashing of huge sqlite files.
          usePolling: false,
          alwaysStat: false,
        })
      : null;
  if (composerDbWatcher) {
    composerDbWatcher.on("all", () => controller.onComposerDbEvent());
    composerDbWatcher.on("error", (err) => {
      console.error("[cursor-watch] composer db watcher error", err);
    });
  }

  controller.start();

  return {
    close: async () => {
      controller.close();
      if (child) {
        child.kill();
        child = null;
      }
      await Promise.all([
        watcher.close(),
        projectsRootWatcher.close(),
        composerDbWatcher ? composerDbWatcher.close() : Promise.resolve(),
      ]);
    },
  };
}
