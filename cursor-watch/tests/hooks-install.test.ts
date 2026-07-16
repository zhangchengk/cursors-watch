import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { hooksStatus, installHooks, uninstallHooks } from "../src/hooks-install.js";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

function fakeHome() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "cw-home-"));
  homes.push(h);
  fs.mkdirSync(path.join(h, ".cursor"), { recursive: true });
  return h;
}

describe("hooks install", () => {
  it("merges without destroying existing hooks and uninstall is precise", () => {
    const home = fakeHome();
    const hooksJson = path.join(home, ".cursor", "hooks.json");
    fs.writeFileSync(
      hooksJson,
      JSON.stringify({
        version: 1,
        hooks: {
          beforeShellExecution: [{ command: "./hooks/other.sh" }],
        },
      }),
    );
    installHooks(home);
    const after = JSON.parse(fs.readFileSync(hooksJson, "utf8"));
    expect(after.hooks.beforeShellExecution).toHaveLength(1);
    expect(after.hooks.preToolUse.some((x: { command: string }) => x.command.includes("cursor-watch-observe"))).toBe(true);
    expect(after.hooks.afterAgentResponse.length).toBeGreaterThan(0);
    expect(after.hooks.stop.length).toBeGreaterThan(0);
    for (const key of ["preToolUse", "afterAgentResponse", "stop"] as const) {
      const ours = after.hooks[key].filter((x: { command: string }) =>
        x.command.includes("cursor-watch-observe"),
      );
      expect(ours).toHaveLength(1);
      expect(ours[0].timeout).toBe(2);
      expect(ours[0].failClosed).toBeUndefined();
    }
    expect(hooksStatus(home).installed).toBe(true);
    uninstallHooks(home);
    const gone = JSON.parse(fs.readFileSync(hooksJson, "utf8"));
    expect(gone.hooks.beforeShellExecution).toHaveLength(1);
    expect(gone.hooks.preToolUse ?? []).toHaveLength(0);
    expect(hooksStatus(home).installed).toBe(false);
  });

  it("observe script writes live snapshot and always exits 0", () => {
    const home = fakeHome();
    const script = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/hooks/cursor-watch-observe.mjs",
    );
    const payload = JSON.stringify({
      hook_event_name: "preToolUse",
      conversation_id: "test-id",
      tool_name: "Shell",
      tool_input: { command: "echo hi" },
    });
    const r = spawnSync(process.execPath, [script], {
      input: payload,
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    expect(r.status).toBe(0);
    const snapPath = path.join(home, ".cursor-watch", "live", "test-id.json");
    expect(fs.existsSync(snapPath)).toBe(true);
    const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
    expect(snap.conversationId).toBe("test-id");
    expect(snap.lastEvent).toBe("preToolUse");
    expect(snap.liveHint).toBe("Shell");
    expect(snap.stoppedAt).toBeNull();

    const empty = spawnSync(process.execPath, [script], {
      input: "",
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    expect(empty.status).toBe(0);
  });
});
