import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CURSOR_WATCH_CONVERSATION_ID_ENV } from "../src/constants.js";
import { isActiveLoop, type ProcessRow } from "../src/loop-ledger/active.js";
import { recordLoopLedgerEntry } from "../src/loop-ledger/store.js";

const homes: string[] = [];
const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

function tempHome(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "cw-loop-active-"));
  homes.push(h);
  return h;
}

function procs(...rows: ProcessRow[]): () => ProcessRow[] {
  return () => rows;
}

describe("isActiveLoop", () => {
  it("returns false when no ledger entry for conversation (inactive)", () => {
    const home = tempHome();
    expect(
      isActiveLoop({
        homeDir: home,
        conversationId: "c1",
        listProcesses: procs({
          pid: 1,
          command: "echo AGENT_LOOP_TICK_x; sleep 60",
        }),
        now: 1_000,
      }),
    ).toBe(false);
  });

  it("returns false when ledger exists but no sentinel process (inactive)", () => {
    const home = tempHome();
    recordLoopLedgerEntry(home, {
      conversationId: "c1",
      seenAt: 1_000,
      commandFingerprint: "echo AGENT_LOOP_TICK_c1",
    });
    expect(
      isActiveLoop({
        homeDir: home,
        conversationId: "c1",
        listProcesses: procs({ pid: 1, command: "npm test" }),
        now: 2_000,
      }),
    ).toBe(false);
  });

  it("returns true when sentinel process includes ledger fingerprint within 24h (active)", () => {
    const home = tempHome();
    const fp = "echo AGENT_LOOP_TICK_c1; sleep 60; echo AGENT_LOOP_WAKE_c1";
    recordLoopLedgerEntry(home, {
      conversationId: "c1",
      seenAt: 1_000,
      commandFingerprint: fp,
    });
    expect(
      isActiveLoop({
        homeDir: home,
        conversationId: "c1",
        listProcesses: procs({ pid: 42, command: `/bin/bash -c ${fp}` }),
        now: 1_000 + DAY_MS - 1,
      }),
    ).toBe(true);
  });

  it("returns false when fingerprint matches but ledger seenAt older than 24h (stale)", () => {
    const home = tempHome();
    const fp = "echo AGENT_LOOP_TICK_c1";
    recordLoopLedgerEntry(home, {
      conversationId: "c1",
      seenAt: 1_000,
      commandFingerprint: fp,
    });
    expect(
      isActiveLoop({
        homeDir: home,
        conversationId: "c1",
        listProcesses: procs({ pid: 42, command: fp }),
        now: 1_000 + DAY_MS + 1,
      }),
    ).toBe(false);
  });

  it("returns false for conversation B when only A has fingerprint-matching loop (wrong conversation)", () => {
    const home = tempHome();
    const fpA = "echo AGENT_LOOP_TICK_aaa; sleep 60";
    const fpB = "echo AGENT_LOOP_TICK_bbb; sleep 60";
    recordLoopLedgerEntry(home, {
      conversationId: "cA",
      seenAt: 5_000,
      commandFingerprint: fpA,
    });
    recordLoopLedgerEntry(home, {
      conversationId: "cB",
      seenAt: 5_000,
      commandFingerprint: fpB,
    });
    const listProcesses = procs({ pid: 7, command: fpA });
    expect(
      isActiveLoop({
        homeDir: home,
        conversationId: "cA",
        listProcesses,
        now: 6_000,
      }),
    ).toBe(true);
    expect(
      isActiveLoop({
        homeDir: home,
        conversationId: "cB",
        listProcesses,
        now: 6_000,
      }),
    ).toBe(false);
  });

  it("returns true when process argv contains CURSOR_WATCH_CONVERSATION_ID for this conversation (marked env)", () => {
    const home = tempHome();
    recordLoopLedgerEntry(home, {
      conversationId: "c1",
      seenAt: 1_000,
      commandFingerprint: "echo AGENT_LOOP_TICK_other",
      markedConversationId: "c1",
    });
    const cmd = `CURSOR_WATCH_CONVERSATION_ID=c1 echo AGENT_LOOP_WAKE_xyz; sleep 60`;
    expect(
      isActiveLoop({
        homeDir: home,
        conversationId: "c1",
        listProcesses: procs({ pid: 9, command: cmd }),
        now: 2_000,
      }),
    ).toBe(true);
    expect(cmd).toContain(`${CURSOR_WATCH_CONVERSATION_ID_ENV}=c1`);
  });

  it("with markedConversationId: ignores unmarked sentinel that only matches another fingerprint", () => {
    const home = tempHome();
    recordLoopLedgerEntry(home, {
      conversationId: "c1",
      seenAt: 1_000,
      commandFingerprint: "echo AGENT_LOOP_TICK_c1",
      markedConversationId: "c1",
    });
    expect(
      isActiveLoop({
        homeDir: home,
        conversationId: "c1",
        listProcesses: procs({
          pid: 3,
          command: "echo AGENT_LOOP_TICK_c1; sleep 60",
        }),
        now: 2_000,
      }),
    ).toBe(false);
  });

  it("never returns true solely because another conversation in the same project has a loop", () => {
    const home = tempHome();
    recordLoopLedgerEntry(home, {
      conversationId: "c-other",
      seenAt: 1_000,
      commandFingerprint: "echo AGENT_LOOP_TICK_shared",
    });
    // Queried conversation has no ledger entry at all
    expect(
      isActiveLoop({
        homeDir: home,
        conversationId: "c-me",
        listProcesses: procs({
          pid: 1,
          command: "echo AGENT_LOOP_TICK_shared; sleep 60",
        }),
        now: 2_000,
      }),
    ).toBe(false);
  });
});
