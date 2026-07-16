import path from "node:path";
import chokidar from "chokidar";
import { scanProjects } from "./scanner.js";
import type { SessionStore } from "./store.js";

export function startWatcher(
  projectsDir: string,
  homeDir: string,
  store: SessionStore,
): { close: () => Promise<void> } {
  const refresh = () => {
    try {
      store.replaceAll(scanProjects(projectsDir, homeDir));
    } catch (err) {
      console.error("[cursor-watch] scan failed", err);
    }
  };

  refresh();

  let timer: NodeJS.Timeout | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  };

  const watcher = chokidar.watch(
    [
      path.join(projectsDir, "**/agent-transcripts/**/*.jsonl"),
      path.join(projectsDir, "**/terminals/*.txt"),
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
      await watcher.close();
    },
  };
}
