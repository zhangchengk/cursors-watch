import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyWatchPath, shouldIgnoreWatchPath } from "../src/watch-path.js";

const projectsDir = "/Users/u/.cursor/projects";
const liveDir = "/Users/u/.cursor-watch/live";

describe("classifyWatchPath", () => {
  it("classifies live json", () => {
    const r = classifyWatchPath(path.join(liveDir, "abc-123.json"), {
      projectsDir,
      liveDir,
    });
    expect(r).toEqual({
      kind: "live",
      conversationId: "abc-123",
      filePath: path.join(liveDir, "abc-123.json"),
    });
  });

  it("classifies terminal", () => {
    const filePath = path.join(projectsDir, "Users-u-idea-A", "terminals", "1.txt");
    const r = classifyWatchPath(filePath, { projectsDir, liveDir });
    expect(r).toMatchObject({ kind: "terminal", projectKey: "Users-u-idea-A" });
  });

  it("classifies main transcript and subagent", () => {
    const main = path.join(
      projectsDir,
      "Users-u-idea-A",
      "agent-transcripts",
      "sess-1",
      "sess-1.jsonl",
    );
    expect(classifyWatchPath(main, { projectsDir, liveDir })).toMatchObject({
      kind: "transcript_main",
      sessionId: "sess-1",
      projectKey: "Users-u-idea-A",
    });
    const sub = path.join(
      projectsDir,
      "Users-u-idea-A",
      "agent-transcripts",
      "sess-1",
      "subagents",
      "child-9.jsonl",
    );
    expect(classifyWatchPath(sub, { projectsDir, liveDir })).toMatchObject({
      kind: "transcript_subagent",
      parentId: "sess-1",
      childId: "child-9",
    });
  });

  it("returns unknown for unrelated paths", () => {
    expect(
      classifyWatchPath("/tmp/x", { projectsDir, liveDir }).kind,
    ).toBe("unknown");
  });
});

describe("shouldIgnoreWatchPath", () => {
  const opts = { projectsDir, liveDir };
  const file = { isDirectory: () => false };
  const dir = { isDirectory: () => true };

  it("keeps project roots, live root, and target files", () => {
    expect(shouldIgnoreWatchPath(projectsDir, opts)).toBe(false);
    expect(shouldIgnoreWatchPath(liveDir, opts)).toBe(false);
    expect(
      shouldIgnoreWatchPath(path.join(liveDir, "c.json"), opts, file),
    ).toBe(false);
    expect(
      shouldIgnoreWatchPath(
        path.join(projectsDir, "P", "agent-transcripts", "s", "s.jsonl"),
        opts,
        file,
      ),
    ).toBe(false);
    expect(
      shouldIgnoreWatchPath(
        path.join(projectsDir, "P", "terminals", "1.txt"),
        opts,
        file,
      ),
    ).toBe(false);
  });

  it("ignores non-target files under projects and live", () => {
    expect(
      shouldIgnoreWatchPath(path.join(liveDir, "x.txt"), opts, file),
    ).toBe(true);
    expect(
      shouldIgnoreWatchPath(path.join(projectsDir, "P", "other", "x"), opts, file),
    ).toBe(true);
    expect(
      shouldIgnoreWatchPath(
        path.join(projectsDir, "P", "agent-transcripts", "s", "s.md"),
        opts,
        file,
      ),
    ).toBe(true);
  });

  it("does not ignore intermediate target directories", () => {
    expect(
      shouldIgnoreWatchPath(
        path.join(projectsDir, "P", "agent-transcripts"),
        opts,
        dir,
      ),
    ).toBe(false);
    expect(
      shouldIgnoreWatchPath(path.join(projectsDir, "P", "terminals"), opts, dir),
    ).toBe(false);
  });
});
