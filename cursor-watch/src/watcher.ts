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

const workerPath = fileURLToPath(new URL("./scan-worker.ts", import.meta.url));

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

  // chokidar v4+ dropped glob support; watch directory roots and filter.
  const projectsRoot = path.resolve(projectsDir);
  const liveRoot = path.resolve(livePath);
  const ignoreWatchPath = (filePath: string, stats?: fs.Stats): boolean => {
    const resolved = path.resolve(filePath);
    if (resolved === projectsRoot || resolved === liveRoot) return false;

    if (resolved === liveRoot || resolved.startsWith(liveRoot + path.sep)) {
      if (!stats || stats.isDirectory()) return false;
      return path.extname(resolved) !== ".json";
    }

    const rel = path.relative(projectsRoot, resolved);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return true;
    const segments = rel.split(path.sep);
    if (segments.length === 1) return false;

    const kind = segments[1];
    if (kind !== "agent-transcripts" && kind !== "terminals") return true;
    if (!stats || stats.isDirectory()) return false;
    if (kind === "agent-transcripts") return path.extname(resolved) !== ".jsonl";
    return path.extname(resolved) !== ".txt";
  };

  const watcher = chokidar.watch([projectsRoot, liveRoot], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    depth: 8,
    ignored: ignoreWatchPath,
  });
  watcher.on("all", (event, p) => controller.onFsEvent(event, p));

  controller.start();

  return {
    close: async () => {
      controller.close();
      if (child) {
        child.kill();
        child = null;
      }
      await watcher.close();
    },
  };
}
