import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

function isSurvivableFsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  const code = e.code ?? "";
  if (code === "EMFILE" || code === "EBADF") return true;
  const msg = typeof e.message === "string" ? e.message : "";
  return msg.includes("EMFILE") || msg.includes("EBADF");
}

function installProcessGuards(): void {
  const logFile = path.join(stateDir(), "daemon.log");
  const append = (line: string) => {
    try {
      fs.mkdirSync(stateDir(), { recursive: true });
      fs.appendFileSync(logFile, line + "\n", "utf8");
    } catch {
      /* ignore */
    }
    console.error(line);
  };
  // EMFILE/EBADF can surface while chokidar watches settle or when forking the
  // scan worker; log and keep serving rather than taking down the daemon.
  process.on("uncaughtException", (err) => {
    append(`[cursor-watch] uncaughtException ${err?.stack || err}`);
    if (!isSurvivableFsError(err)) process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    append(`[cursor-watch] unhandledRejection ${err instanceof Error ? err.stack : err}`);
    if (!isSurvivableFsError(err)) process.exit(1);
  });
}

export async function runDaemon(): Promise<void> {
  fs.mkdirSync(stateDir(), { recursive: true });
  installProcessGuards();
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
