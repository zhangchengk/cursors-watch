#!/usr/bin/env node
/**
 * Lightweight notify sidecar — clean FD table.
 * IPC: { type: "notify", argv: string[] }
 * Legacy: { type: "notify", script: string } → osascript -e
 */
import { spawn } from "node:child_process";

function runDetached(cmd, args) {
  try {
    const child = spawn(cmd, args, {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", (err) => {
      console.error("[cursor-watch-notify] spawn error", err);
    });
    child.unref();
  } catch (err) {
    console.error("[cursor-watch-notify] failed", err);
  }
}

process.on("message", (msg) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "notify" && Array.isArray(msg.argv) && msg.argv.length > 0) {
    const [cmd, ...args] = msg.argv;
    if (typeof cmd === "string") runDetached(cmd, args);
    return;
  }
  if (msg.type === "notify" && typeof msg.script === "string") {
    runDetached("/usr/bin/osascript", ["-e", msg.script]);
  }
});

process.on("disconnect", () => {
  process.exit(0);
});
