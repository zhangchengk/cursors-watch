import { spawn } from "node:child_process";
import fs from "node:fs";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { listenHost, listenPort, pidFile, stateDir } from "./constants.js";
import { runDaemon } from "./daemon.js";
import {
  daemonSpawnShellCommand,
  shouldRaiseNofile,
} from "./nofile.js";

async function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

function readPid(): number | null {
  try {
    const n = Number(fs.readFileSync(pidFile(), "utf8").trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function daemonLogPath(): string {
  return `${stateDir()}/daemon.log`;
}

async function ensureDaemon(): Promise<void> {
  const host = listenHost();
  const port = listenPort();
  if (await isPortOpen(host, port)) return;

  fs.mkdirSync(stateDir(), { recursive: true });
  const self = fileURLToPath(import.meta.url);
  // Redirect via shell (not inherited fds) so later fork() of the scan worker
  // does not hit spawn EBADF from a closed/duped log fd.
  const shellCmd = daemonSpawnShellCommand(
    process.execPath,
    ["--import", "tsx"],
    self,
    ["daemon"],
    daemonLogPath(),
  );
  const child = spawn("bash", ["-c", shellCmd], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  for (let i = 0; i < 40; i++) {
    if (await isPortOpen(host, port)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("daemon failed to start on port " + port);
}

async function openBrowser(url: string): Promise<void> {
  spawn("open", [url], { stdio: "ignore", detached: true }).unref();
}

/** Re-exec under a higher NOFILE soft limit when launched as `daemon` directly. */
function reexecDaemonWithRaisedNofile(): boolean {
  if (!shouldRaiseNofile()) return false;
  const self = fileURLToPath(import.meta.url);
  const shellCmd = daemonSpawnShellCommand(
    process.execPath,
    process.execArgv,
    self,
    process.argv.slice(2),
  );
  const child = spawn("bash", ["-c", shellCmd], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
  return true;
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "open";
  if (cmd === "daemon") {
    if (reexecDaemonWithRaisedNofile()) return;
    await runDaemon();
    return;
  }
  if (cmd === "status") {
    const host = listenHost();
    const port = listenPort();
    const up = await isPortOpen(host, port);
    const pid = readPid();
    console.log(
      JSON.stringify({ up, host, port, pid, pidAlive: pid ? pidAlive(pid) : false }, null, 2),
    );
    return;
  }
  if (cmd === "stop") {
    const pid = readPid();
    if (pid && pidAlive(pid)) {
      process.kill(pid, "SIGTERM");
      console.log("sent SIGTERM to", pid);
    } else {
      console.log("daemon not running");
    }
    return;
  }
  if (cmd === "open") {
    await ensureDaemon();
    const url = `http://${listenHost()}:${listenPort()}/`;
    await openBrowser(url);
    console.log(url);
    return;
  }
  if (cmd === "hooks") {
    const sub = process.argv[3];
    const { installHooks, uninstallHooks, hooksStatus } = await import("./hooks-install.js");
    if (sub === "install") {
      const r = installHooks();
      console.log("installed", r.scriptPath);
      return;
    }
    if (sub === "uninstall") {
      console.log(JSON.stringify(uninstallHooks(), null, 2));
      return;
    }
    if (sub === "status") {
      console.log(JSON.stringify(hooksStatus(), null, 2));
      return;
    }
    console.error("usage: cursor-watch hooks <install|uninstall|status>");
    process.exit(1);
  }
  console.error("usage: cursor-watch <open|status|stop|daemon|hooks>");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
