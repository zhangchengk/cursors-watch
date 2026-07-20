import { spawnSync } from "node:child_process";

const TARGET_NOFILE = 65536;
const ENV_FLAG = "CURSOR_WATCH_NOFILE_RAISED";

/** Best-effort soft NOFILE limit (bash `ulimit -n`). */
export function softNofileLimit(): number {
  try {
    const out = spawnSync("bash", ["-c", "ulimit -n"], {
      encoding: "utf8",
      timeout: 2000,
    });
    const n = Number((out.stdout || "").trim());
    return Number.isFinite(n) && n > 0 ? n : 256;
  } catch {
    return 256;
  }
}

/**
 * Build a bash -c snippet that raises NOFILE then execs node with the same args.
 * Used when spawning the detached daemon so GUI/launchd soft limits (often 256)
 * do not EMFILE during chokidar watch setup.
 */
export function daemonSpawnShellCommand(
  execPath: string,
  execArgv: string[],
  scriptPath: string,
  argvTail: string[],
  logPath?: string,
): string {
  const parts = [
    execPath,
    ...execArgv,
    scriptPath,
    ...argvTail,
  ].map((p) => JSON.stringify(p));
  const redirect = logPath ? ` >>${JSON.stringify(logPath)} 2>&1` : "";
  return (
    `ulimit -n ${TARGET_NOFILE} 2>/dev/null || ulimit -n 8192 2>/dev/null || true; ` +
    `export ${ENV_FLAG}=1; ` +
    `exec ${parts.join(" ")}${redirect}`
  );
}

export function nofileAlreadyRaised(): boolean {
  return process.env[ENV_FLAG] === "1";
}

export function shouldRaiseNofile(): boolean {
  if (nofileAlreadyRaised()) return false;
  return softNofileLimit() < 8192;
}
