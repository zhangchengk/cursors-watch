import fs from "node:fs";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";
import { liveDir } from "./constants.js";
import type { SessionState } from "./types.js";
import type { SessionStore } from "./store.js";

const workerPath = fileURLToPath(new URL("./scan-worker.ts", import.meta.url));

export function startWatcher(
  projectsDir: string,
  homeDir: string,
  store: SessionStore,
): { close: () => Promise<void> } {
  let child: ChildProcess | null = null;
  let scanInFlight = false;
  let pendingRefresh = false;

  const refresh = () => {
    if (scanInFlight) {
      pendingRefresh = true;
      return;
    }
    scanInFlight = true;
    pendingRefresh = false;

    child = fork(workerPath, [], {
      execArgv: ["--import", "tsx"],
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    const finish = () => {
      child = null;
      scanInFlight = false;
      if (pendingRefresh) {
        pendingRefresh = false;
        schedule();
      }
    };

    child.on("message", (msg: SessionState[] | { error: string }) => {
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
      child?.kill();
      finish();
    });
    child.on("error", (err) => {
      console.error("[cursor-watch] scan failed", err);
      finish();
    });
    child.on("exit", (code) => {
      if (scanInFlight) {
        if (code && code !== 0) {
          console.error("[cursor-watch] scan worker exited", code);
        }
        finish();
      }
    });

    child.send({ projectsDir, homeDir });
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
      pendingRefresh = false;
      if (child) {
        child.kill();
        child = null;
      }
      scanInFlight = false;
      await watcher.close();
    },
  };
}
