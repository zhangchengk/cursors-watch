import fs from "node:fs";
import os from "node:os";
import {
  cursorProjectsDir,
  listenHost,
  listenPort,
  pidFile,
  stateDir,
} from "./constants.js";
import { buildServer } from "./server.js";
import { SessionStore } from "./store.js";
import { startWatcher } from "./watcher.js";

export async function runDaemon(): Promise<void> {
  fs.mkdirSync(stateDir(), { recursive: true });
  const pf = pidFile();
  fs.writeFileSync(pf, String(process.pid), "utf8");

  const store = new SessionStore();
  const app = await buildServer(store);
  const host = listenHost();
  const port = listenPort();
  // Bind HTTP before startWatcher so the initial scan cannot block listen
  // (setImmediate still runs across await buildServer if watcher starts first).
  await app.listen({ host, port });
  console.log(`[cursor-watch] listening on http://${host}:${port}`);
  const watcher = startWatcher(cursorProjectsDir(), os.homedir(), store);

  const shutdown = async () => {
    await watcher.close();
    await app.close();
    try {
      if (fs.existsSync(pf) && fs.readFileSync(pf, "utf8").trim() === String(process.pid)) {
        fs.unlinkSync(pf);
      }
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
