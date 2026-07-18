import { describe, expect, it, vi } from "vitest";
import {
  isAllowedWorkspacePath,
  openWorkspaceInCursor,
} from "../src/open-workspace.js";
import type { SessionState } from "../src/types.js";

function sess(path: string): SessionState {
  return {
    id: "1",
    projectKey: "p",
    workspacePath: path,
    workspaceLabel: "lab",
    status: "idle",
    summary: "s",
    currentAction: "a",
    lastActivityAt: 1,
    subagentCount: 0,
    subagentRunning: 0,
    transcriptPath: "/t",
    recentMessages: [],
  };
}

describe("isAllowedWorkspacePath", () => {
  it("allows only paths present on current sessions", () => {
    const sessions = [sess("/Users/u/idea/A"), sess("/Users/u/idea/B")];
    expect(isAllowedWorkspacePath("/Users/u/idea/A", sessions)).toBe(true);
    expect(isAllowedWorkspacePath("/Users/u/idea/C", sessions)).toBe(false);
    expect(isAllowedWorkspacePath("", sessions)).toBe(false);
  });
});

describe("openWorkspaceInCursor", () => {
  it("rejects paths not in allowlist without spawning", async () => {
    const spawn = vi.fn();
    const r = await openWorkspaceInCursor({
      workspacePath: "/evil",
      sessions: [sess("/Users/u/idea/A")],
      spawnCursor: spawn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/不允许|allow/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns cursor with allowed path (no -r)", async () => {
    const spawn = vi.fn().mockResolvedValue(undefined);
    const r = await openWorkspaceInCursor({
      workspacePath: "/Users/u/idea/A",
      sessions: [sess("/Users/u/idea/A")],
      spawnCursor: spawn,
    });
    expect(r.ok).toBe(true);
    expect(spawn).toHaveBeenCalledWith(["/Users/u/idea/A"]);
  });
});
