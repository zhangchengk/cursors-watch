#!/usr/bin/env node
/**
 * Lightweight notify sidecar — clean FD table.
 * IPC: { type: "notify", argv: string[] }
 *      { type: "drain" }
 * Also polls ~/.cursor-watch/notify-queue/*.json (durable handoff).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function stateDir() {
  return (
    process.env.CURSOR_WATCH_STATE_DIR ||
    path.join(os.homedir(), ".cursor-watch")
  );
}

function queueDir() {
  return path.join(stateDir(), "notify-queue");
}

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

function drainQueue() {
  const dir = queueDir();
  let names;
  try {
    fs.mkdirSync(dir, { recursive: true });
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch (err) {
    console.error("[cursor-watch-notify] queue read failed", err);
    return;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      const raw = fs.readFileSync(full, "utf8");
      fs.unlinkSync(full);
      const msg = JSON.parse(raw);
      const argv = msg && Array.isArray(msg.argv) ? msg.argv : null;
      if (argv && typeof argv[0] === "string") {
        runDetached(argv[0], argv.slice(1));
      }
    } catch (err) {
      console.error("[cursor-watch-notify] queue item failed", full, err);
      try {
        fs.unlinkSync(full);
      } catch {
        /* ignore */
      }
    }
  }
}

process.on("message", (msg) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "drain" || msg.type === "notify") {
    // Parent always enqueues argv to notify-queue; worker only drains (no double-fire).
    drainQueue();
  }
});

process.on("disconnect", () => {
  process.exit(0);
});

fs.mkdirSync(queueDir(), { recursive: true });
drainQueue();
setInterval(drainQueue, 500);
