#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EVENTS = new Set(["preToolUse", "afterAgentResponse", "stop"]);

let raw = "";
try {
  raw = fs.readFileSync(0, "utf8");
} catch {
  process.exit(0);
}

try {
  const input = raw.trim() ? JSON.parse(raw) : {};
  const event = input.hook_event_name || input.event || "";
  const id =
    input.conversation_id ||
    input.session_id ||
    input.composer_id ||
    "";
  if (!id || !EVENTS.has(event)) {
    process.exit(0);
  }
  const home = os.homedir();
  const dir = path.join(home, ".cursor-watch", "live");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.json`);
  let prev = null;
  try {
    prev = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* none */
  }
  const now = Date.now();
  const isStop = event === "stop";
  let hint = "";
  if (typeof input.tool_name === "string") hint = input.tool_name;
  else if (input.tool_input && typeof input.tool_input.command === "string") {
    hint = `Shell: ${input.tool_input.command}`.slice(0, 200);
  } else if (typeof input.text === "string") hint = input.text.slice(0, 120);
  else if (prev && prev.liveHint) hint = prev.liveHint;
  const snap = {
    conversationId: id,
    lastEvent: event,
    lastLiveAt: isStop ? (prev?.lastLiveAt ?? now) : now,
    stoppedAt: isStop ? now : null,
    liveHint: hint,
    updatedAt: now,
  };
  fs.writeFileSync(file, JSON.stringify(snap));
} catch {
  /* swallow — never block the agent */
}
process.exit(0);
