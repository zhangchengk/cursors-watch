import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import chokidar from "chokidar";
import { liveDir } from "./constants.js";
import type { SessionState } from "./types.js";
import type { SessionStore } from "./store.js";

export function startWatcher(
  projectsDir: string,
  homeDir: string,
  store: SessionStore,
): { close: () => Promise<void> } {
  let scanWorker: Worker | null = null;

  const refresh = () => {
    if (scanWorker) {
      void scanWorker.terminate();
      scanWorker = null;
    }
    scanWorker = new Worker(new URL("./scan-worker.ts", import.meta.url), {
      workerData: { projectsDir, homeDir },
      execArgv: process.execArgv,
    });
    scanWorker.on("message", (msg: SessionState[] | { error: string }) => {
      scanWorker = null;
      if (!Array.isArray(msg)) {
        console.error("[cursor-watch] scan failed", msg.error);
        return;
      }
      try {
        store.replaceAll(msg);
      } catch (err) {
        console.error("[cursor-watch] scan failed", err);
      }
    });
    scanWorker.on("error", (err) => {
      scanWorker = null;
      console.error("[cursor-watch] scan failed", err);
    });
  };

  let timer: NodeJS.Timeout | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  };

  setImmediate(refresh);

  const livePath = liveDir(homeDir);
  fs.mkdirSync(livePath, { recursive: true });

  const watcher = chokidar.watch(
    [
      path.join(projectsDir, "**/agent-transcripts/**/*.jsonl"),
      path.join(projectsDir, "**/terminals/*.txt"),
      livePath,
    ],
    {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      depth: 8,
    },
  );
  watcher.on("all", schedule);

  return {
    close: async () => {
      if (timer) clearTimeout(timer);
      if (scanWorker) await scanWorker.terminate();
      await watcher.close();
    },
  };
}
