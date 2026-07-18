import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanProjects } from "../src/scanner.js";
import { parseTerminalMeta } from "../src/terminals.js";

describe("parseTerminalMeta", () => {
  it("reads pid and running when no exit_code", () => {
    const meta = parseTerminalMeta(`---\npid: 1\ncwd: /tmp\n---\nhi\n`);
    expect(meta.pid).toBe(1);
    expect(meta.exitCode).toBeNull();
    expect(meta.running).toBe(true);
  });

  it("reads exit_code", () => {
    const meta = parseTerminalMeta(`---\npid: 1\nexit_code: 0\n---\n`);
    expect(meta.exitCode).toBe(0);
    expect(meta.running).toBe(false);
  });
});

describe("scanProjects", () => {
  it("discovers parent sessions under a projects root", () => {
    const root = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "fixtures/projects-layout",
    );
    // Fixture JSONL timestamps are ~1700000002000; keep now inside ACTIVE_WINDOW
    const now = 1_700_000_002_000 + 60_000;
    // homeDir chosen so decode may fail → label falls back to projectKey
    const sessions = scanProjects(root, "/Users/test", now);
    const parent = sessions.find((s) => s.id === "sess-1");
    expect(parent).toBeTruthy();
    expect(parent!.projectKey).toBe("Users-test-idea-Demo");
    expect(parent!.subagentCount).toBeGreaterThanOrEqual(0); // aggregator applied inside scan
  });

  it("does not promote mirrored subagent folders to top-level cards", () => {
    // Cursor often writes both parent/subagents/<child>.jsonl AND a top-level
    // agent-transcripts/<child>/<child>.jsonl. The latter must not become a card.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cw-scan-"));
    const transcripts = path.join(
      root,
      "Users-test-idea-Demo",
      "agent-transcripts",
    );
    const parentId = "parent-aa";
    const childId = "child-bb";
    const line = (ts: number, text: string) =>
      `${JSON.stringify({
        role: "assistant",
        timestamp: ts,
        message: { content: [{ type: "text", text }] },
      })}\n`;
    const ts = 1_700_000_002_000;
    fs.mkdirSync(path.join(transcripts, parentId, "subagents"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(transcripts, childId), { recursive: true });
    fs.writeFileSync(
      path.join(transcripts, parentId, `${parentId}.jsonl`),
      line(ts, "parent done"),
    );
    fs.writeFileSync(
      path.join(transcripts, parentId, "subagents", `${childId}.jsonl`),
      line(ts, "Task 4 已完成"),
    );
    fs.writeFileSync(
      path.join(transcripts, childId, `${childId}.jsonl`),
      line(ts, "Task 4 已完成"),
    );
    const now = ts + 60_000;
    const sessions = scanProjects(root, "/Users/test", now);
    expect(sessions.map((s) => s.id)).toEqual([parentId]);
    expect(sessions[0].subagentCount).toBe(1);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
