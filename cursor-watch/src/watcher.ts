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
import { shouldIgnoreWatchPath } from "./watch-path.js";

const workerPath = fileURLToPath(new URL("./scan-worker.ts", import.meta.url));

/** Depth from a project-key root covers agent-transcripts/.../subagents/*.jsonl. */
const PROJECT_WATCH_DEPTH = 5;

function listProjectDirs(projectsRoot: string): string[] {
  try {
    return fs
      .readdirSync(projectsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(projectsRoot, e.name));
  } catch {
    return [];
  }
}

export function startWatcher(
  projectsDir: string,
  homeDir: string,
  store: SessionStore,
): { close: () => Promise<void> } {
  let child: ChildProcess | null = null;
  const caches = new ScanCaches(homeDir);

  const runFullScan = () => {
    if (child) {
      // Controller coalesces via pendingFullScan; ignore overlapping fork.
      return;
    }

    child = fork(workerPath, [], {
      execArgv: ["--import", "tsx"],
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });
    const proc = child;
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
          store.replaceAll(msg);
          console.log(`[cursor-watch] sessions=${msg.length}`);
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

    proc.send({ projectsDir, homeDir });
  };

  const controller = createRefreshController({
    projectsDir,
    homeDir,
    store,
    caches,
    runFullScan,
  });

  const livePath = liveDir(homeDir);
  fs.mkdirSync(livePath, { recursive: true });

  // Watch each project-key dir (not the whole ~/.cursor/projects tree) plus live.
  // New project folders are picked up via a shallow projectsRoot watcher.
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

  const watcher = chokidar.watch([...listProjectDirs(projectsRoot), liveRoot], {
    ...watchOpts,
    depth: PROJECT_WATCH_DEPTH,
    ignored: ignoreWatchPath,
  });
  watcher.on("all", (event, p) => controller.onFsEvent(event, p));

  // Shallow watch: only immediate children of projectsRoot (new project keys).
  const projectsRootWatcher = chokidar.watch(projectsRoot, {
    ...watchOpts,
    depth: 1,
    ignored: (filePath: string, stats?: fs.Stats): boolean => {
      const resolved = path.resolve(filePath);
      if (resolved === projectsRoot) return false;
      const rel = path.relative(projectsRoot, resolved);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return true;
      if (rel.split(path.sep).length > 1) return true;
      if (stats && !stats.isDirectory()) return true;
      return false;
    },
  });
  projectsRootWatcher.on("addDir", (dirPath) => {
    const resolved = path.resolve(dirPath);
    const rel = path.relative(projectsRoot, resolved);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return;
    if (rel.includes(path.sep)) return;
    watcher.add(resolved);
  });

  controller.start();

  return {
    close: async () => {
      controller.close();
      if (child) {
        child.kill();
        child = null;
      }
      await Promise.all([watcher.close(), projectsRootWatcher.close()]);
    },
  };
}
