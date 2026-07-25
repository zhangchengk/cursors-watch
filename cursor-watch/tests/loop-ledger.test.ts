import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CURSOR_WATCH_CONVERSATION_ID_ENV,
  LOOP_SENTINEL_MARKERS,
  loopLedgerFile,
} from "../src/constants.js";
import {
  fingerprintCommand,
  isLoopSentinelCommand,
} from "../src/loop-ledger/detect.js";
import {
  clearLoopLedgerEntry,
  listLoopLedger,
  recordLoopLedgerEntry,
} from "../src/loop-ledger/store.js";
import type { LoopLedgerEntry } from "../src/loop-ledger/types.js";

const homes: string[] = [];

afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

function tempHome(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "cw-loop-ledger-"));
  homes.push(h);
  return h;
}

describe("constants", () => {
  it("LOOP_SENTINEL_MARKERS are exact tick/wake prefixes", () => {
    expect(LOOP_SENTINEL_MARKERS).toEqual(["AGENT_LOOP_TICK_", "AGENT_LOOP_WAKE_"]);
  });

  it("loopLedgerFile is under stateDir", () => {
    const home = "/tmp/fake-home";
    expect(loopLedgerFile(home)).toBe(
      path.join(home, ".cursor-watch", "loop-ledger.json"),
    );
  });

  it("exports CURSOR_WATCH_CONVERSATION_ID env name", () => {
    expect(CURSOR_WATCH_CONVERSATION_ID_ENV).toBe("CURSOR_WATCH_CONVERSATION_ID");
  });
});

describe("isLoopSentinelCommand", () => {
  it("detects AGENT_LOOP_TICK_ marker", () => {
    expect(
      isLoopSentinelCommand(
        'echo AGENT_LOOP_TICK_abc; sleep 60; echo AGENT_LOOP_WAKE_abc',
      ),
    ).toBe(true);
  });

  it("detects AGENT_LOOP_WAKE_ alone", () => {
    expect(isLoopSentinelCommand("printf AGENT_LOOP_WAKE_xyz")).toBe(true);
  });

  it("rejects unrelated shell commands", () => {
    expect(isLoopSentinelCommand("npm test")).toBe(false);
    expect(isLoopSentinelCommand("sleep 60")).toBe(false);
    expect(isLoopSentinelCommand("echo AGENT_LOOP")).toBe(false);
    expect(isLoopSentinelCommand("")).toBe(false);
  });
});

describe("fingerprintCommand", () => {
  it("normalizes whitespace", () => {
    expect(fingerprintCommand("  echo   AGENT_LOOP_TICK_x  \n sleep 1 ")).toBe(
      "echo AGENT_LOOP_TICK_x sleep 1",
    );
  });

  it("truncates long commands", () => {
    const long = `echo AGENT_LOOP_TICK_${"x".repeat(500)}`;
    const fp = fingerprintCommand(long);
    expect(fp.length).toBeLessThanOrEqual(200);
    expect(fp.startsWith("echo AGENT_LOOP_TICK_")).toBe(true);
  });
});

describe("loop ledger store", () => {
  it("listLoopLedger returns [] when file missing", () => {
    const home = tempHome();
    expect(listLoopLedger(home)).toEqual([]);
  });

  it("record then list persists entry", () => {
    const home = tempHome();
    const entry: LoopLedgerEntry = {
      conversationId: "c1",
      seenAt: 1000,
      commandFingerprint: "echo AGENT_LOOP_TICK_c1",
    };
    recordLoopLedgerEntry(home, entry);
    expect(listLoopLedger(home)).toEqual([entry]);
    expect(fs.existsSync(loopLedgerFile(home))).toBe(true);
  });

  it("upserts by conversationId on re-record", () => {
    const home = tempHome();
    recordLoopLedgerEntry(home, {
      conversationId: "c1",
      seenAt: 1000,
      commandFingerprint: "fp-old",
    });
    recordLoopLedgerEntry(home, {
      conversationId: "c1",
      seenAt: 2000,
      commandFingerprint: "fp-new",
      markedConversationId: "c1",
    });
    const listed = listLoopLedger(home);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual({
      conversationId: "c1",
      seenAt: 2000,
      commandFingerprint: "fp-new",
      markedConversationId: "c1",
    });
  });

  it("keeps separate conversations", () => {
    const home = tempHome();
    recordLoopLedgerEntry(home, {
      conversationId: "c1",
      seenAt: 1,
      commandFingerprint: "a",
    });
    recordLoopLedgerEntry(home, {
      conversationId: "c2",
      seenAt: 2,
      commandFingerprint: "b",
    });
    expect(listLoopLedger(home).map((e) => e.conversationId).sort()).toEqual([
      "c1",
      "c2",
    ]);
  });

  it("clearLoopLedgerEntry removes only that conversation", () => {
    const home = tempHome();
    recordLoopLedgerEntry(home, {
      conversationId: "c1",
      seenAt: 1,
      commandFingerprint: "a",
    });
    recordLoopLedgerEntry(home, {
      conversationId: "c2",
      seenAt: 2,
      commandFingerprint: "b",
    });
    clearLoopLedgerEntry(home, "c1");
    expect(listLoopLedger(home)).toEqual([
      { conversationId: "c2", seenAt: 2, commandFingerprint: "b" },
    ]);
  });
});
