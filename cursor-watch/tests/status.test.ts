import { describe, expect, it } from "vitest";
import { RUNNING_WINDOW_MS } from "../src/constants.js";
import { inferSessionFields } from "../src/infer/status.js";
import type { ParsedTranscript } from "../src/parser/transcript.js";

function base(over: Partial<ParsedTranscript> = {}): ParsedTranscript {
  return {
    id: "1",
    transcriptPath: "/t.jsonl",
    summary: "hello",
    lastRole: "assistant",
    lastToolFailed: false,
    hadToolUseRecently: false,
    lastMessageHadToolUse: false,
    lastActivityAt: 10_000_000,
    recentMessages: [],
    rawUserTexts: ["hello"],
    ...over,
  };
}

describe("inferSessionFields", () => {
  const now = 10_000_000;

  it("marks waiting when last role is assistant and no recent tools", () => {
    const r = inferSessionFields({
      parsed: base({ lastRole: "assistant", lastActivityAt: now - 60_000 }),
      now,
      shellRunning: false,
      shellExitCode: null,
      subagentRunning: 0,
    });
    expect(r.status).toBe("waiting");
    expect(r.currentAction).toMatch(/等待/);
    expect(r.waitingSince).toBe(now - 60_000);
  });

  it("marks running when recent tool_use", () => {
    const r = inferSessionFields({
      parsed: base({
        hadToolUseRecently: true,
        lastToolName: "Shell",
        lastToolCommand: "mvn test",
        lastMessageHadToolUse: true,
        lastActivityAt: now - 10_000,
      }),
      now,
      shellRunning: false,
      shellExitCode: null,
      subagentRunning: 0,
    });
    expect(r.status).toBe("running");
    expect(r.currentAction).toContain("Shell");
    expect(r.currentAction).toContain("mvn test");
  });

  it("marks running when shellRunning and session recently active", () => {
    const r = inferSessionFields({
      parsed: base({ lastRole: "assistant", lastActivityAt: now - 10_000 }),
      now,
      shellRunning: true,
      shellExitCode: null,
      subagentRunning: 0,
    });
    expect(r.status).toBe("running");
  });

  it("does not stay running on stale lastMessageHadToolUse", () => {
    const r = inferSessionFields({
      parsed: base({
        lastRole: "assistant",
        lastMessageHadToolUse: true,
        lastToolName: "AwaitShell",
        lastToolCommand: "cat /tmp/result.json",
        lastActivityAt: now - RUNNING_WINDOW_MS - 1,
      }),
      now,
      shellRunning: false,
      shellExitCode: null,
      subagentRunning: 0,
    });
    expect(r.status).toBe("waiting");
  });

  it("does not stay running on stale shellRunning alone", () => {
    const r = inferSessionFields({
      parsed: base({
        lastRole: "assistant",
        lastActivityAt: now - RUNNING_WINDOW_MS - 60_000,
      }),
      now,
      shellRunning: true,
      shellExitCode: null,
      subagentRunning: 0,
    });
    expect(r.status).toBe("waiting");
  });

  it("marks error on tool failure or nonzero exit", () => {
    expect(
      inferSessionFields({
        parsed: base({ lastToolFailed: true }),
        now,
        shellRunning: false,
        shellExitCode: null,
        subagentRunning: 0,
      }).status,
    ).toBe("error");
    expect(
      inferSessionFields({
        parsed: base(),
        now,
        shellRunning: false,
        shellExitCode: 1,
        subagentRunning: 0,
      }).status,
    ).toBe("error");
  });

  it("marks subagent when child running and parent otherwise idle-ish", () => {
    const r = inferSessionFields({
      parsed: base({ lastRole: "assistant", hadToolUseRecently: false }),
      now,
      shellRunning: false,
      shellExitCode: null,
      subagentRunning: 2,
    });
    expect(r.status).toBe("subagent");
    expect(r.currentAction).toContain("2");
  });

  it("marks idle when last role is user (your turn done, agent not replied) inside window", () => {
    const r = inferSessionFields({
      parsed: base({ lastRole: "user", lastActivityAt: now - 10_000 }),
      now,
      shellRunning: false,
      shellExitCode: null,
      subagentRunning: 0,
    });
    expect(r.status).toBe("idle");
  });
});
