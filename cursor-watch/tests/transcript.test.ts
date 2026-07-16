import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTranscriptText } from "../src/parser/transcript.js";

const fix = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("parseTranscriptText", () => {
  it("extracts summary, recent messages, last tool, roles", () => {
    const text = fs.readFileSync(path.join(fix, "sample-parent.jsonl"), "utf8");
    const parsed = parseTranscriptText(text, {
      id: "abc",
      transcriptPath: "/tmp/abc.jsonl",
    });
    expect(parsed.id).toBe("abc");
    expect(parsed.summary).toContain("修复 sonar");
    expect(parsed.summary.length).toBeLessThanOrEqual(50);
    expect(parsed.lastRole).toBe("assistant");
    expect(parsed.lastToolName).toBe("Read"); // last *seen* tool in file
    expect(parsed.lastMessageHadToolUse).toBe(false); // last message has no tool_use
    expect(parsed.hadToolUseRecently).toBe(false);
    expect(parsed.recentMessages.length).toBeLessThanOrEqual(3);
    expect(parsed.recentMessages.at(-1)?.text).toContain("还要继续吗");
  });

  it("detects recent tool_use when event timestamps are provided via now-window", () => {
    const now = 1_000_000;
    const text = [
      JSON.stringify({
        role: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Shell", input: { command: "mvn test" } }],
        },
        // parser accepts optional top-level timestamp ms
        timestamp: now - 30_000,
      }),
    ].join("\n");
    const parsed = parseTranscriptText(
      text,
      { id: "t1", transcriptPath: "/tmp/t1.jsonl" },
      now,
    );
    expect(parsed.lastToolName).toBe("Shell");
    expect(parsed.lastToolCommand).toBe("mvn test");
    expect(parsed.hadToolUseRecently).toBe(true);
    expect(parsed.lastActivityAt).toBe(now - 30_000);
  });
});
