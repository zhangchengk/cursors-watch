import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CURSOR_WATCH_CONVERSATION_ID_ENV,
  loopLedgerFile,
} from "../src/constants.js";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

function fakeHome() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "cw-observe-ledger-"));
  homes.push(h);
  return h;
}

function observeScript() {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/hooks/cursor-watch-observe.mjs",
  );
}

function runObserve(home: string, payload: unknown) {
  return spawnSync(process.execPath, [observeScript()], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

describe("observe hook loop ledger", () => {
  it("preToolUse sentinel command appends ledger entry (fail-open exit 0)", () => {
    const home = fakeHome();
    const cmd = "echo AGENT_LOOP_TICK_abc; sleep 60; echo AGENT_LOOP_WAKE_abc";
    const r = runObserve(home, {
      hook_event_name: "preToolUse",
      conversation_id: "conv-loop",
      tool_name: "Shell",
      tool_input: { command: cmd },
    });
    expect(r.status).toBe(0);

    const ledgerPath = loopLedgerFile(home);
    expect(fs.existsSync(ledgerPath)).toBe(true);
    const entries = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as Array<{
      conversationId: string;
      seenAt: number;
      commandFingerprint: string;
      markedConversationId?: string;
    }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.conversationId).toBe("conv-loop");
    expect(entries[0]!.commandFingerprint).toContain("AGENT_LOOP_TICK_");
    expect(entries[0]!.seenAt).toBeGreaterThan(0);
    expect(entries[0]!.markedConversationId).toBeUndefined();

    // live snap still written
    const snap = JSON.parse(
      fs.readFileSync(
        path.join(home, ".cursor-watch", "live", "conv-loop.json"),
        "utf8",
      ),
    );
    expect(snap.lastEvent).toBe("preToolUse");
  });

  it("preToolUse with CURSOR_WATCH_CONVERSATION_ID sets markedConversationId", () => {
    const home = fakeHome();
    const cmd = `${CURSOR_WATCH_CONVERSATION_ID_ENV}=conv-marked echo AGENT_LOOP_WAKE_xyz; sleep 30`;
    const r = runObserve(home, {
      hook_event_name: "preToolUse",
      conversation_id: "conv-marked",
      tool_name: "Shell",
      tool_input: { command: cmd },
    });
    expect(r.status).toBe(0);

    const entries = JSON.parse(
      fs.readFileSync(loopLedgerFile(home), "utf8"),
    ) as Array<{ markedConversationId?: string; conversationId: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.conversationId).toBe("conv-marked");
    expect(entries[0]!.markedConversationId).toBe("conv-marked");
  });

  it("preToolUse non-sentinel does not create ledger file", () => {
    const home = fakeHome();
    const r = runObserve(home, {
      hook_event_name: "preToolUse",
      conversation_id: "conv-plain",
      tool_name: "Shell",
      tool_input: { command: "echo hi" },
    });
    expect(r.status).toBe(0);
    expect(fs.existsSync(loopLedgerFile(home))).toBe(false);
  });

  it("upserts ledger by conversationId on second sentinel", () => {
    const home = fakeHome();
    runObserve(home, {
      hook_event_name: "preToolUse",
      conversation_id: "conv-u",
      tool_name: "Shell",
      tool_input: { command: "echo AGENT_LOOP_TICK_old" },
    });
    runObserve(home, {
      hook_event_name: "preToolUse",
      conversation_id: "conv-u",
      tool_name: "Shell",
      tool_input: { command: "echo AGENT_LOOP_TICK_new; sleep 1" },
    });
    const entries = JSON.parse(
      fs.readFileSync(loopLedgerFile(home), "utf8"),
    ) as Array<{ conversationId: string; commandFingerprint: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.commandFingerprint).toContain("AGENT_LOOP_TICK_new");
  });
});
