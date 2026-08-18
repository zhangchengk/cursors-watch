import { describe, expect, it } from "vitest";
import { isLibraryEntryStale } from "../src/library/stale.js";
import type { LibraryEntry } from "../src/library/types.js";
import type { SessionState } from "../src/types.js";

function entry(
  over: Partial<LibraryEntry> & Pick<LibraryEntry, "conversationId" | "mark">,
): LibraryEntry {
  return {
    folderId: null,
    updatedAt: 1,
    ...over,
  };
}

describe("isLibraryEntryStale", () => {
  it("stale when transcriptPath missing on disk", () => {
    expect(
      isLibraryEntryStale(
        entry({ conversationId: "c1", mark: "todo", transcriptPath: "/no/such/file.jsonl" }),
        [],
        () => false,
      ),
    ).toBe(true);
  });

  it("not stale when transcriptPath exists even if not in sessions", () => {
    expect(
      isLibraryEntryStale(
        entry({
          conversationId: "c1",
          mark: "archive",
          transcriptPath: "/exists.jsonl",
          workspacePath: "/ws",
        }),
        [],
        () => true,
      ),
    ).toBe(false);
  });

  it("not stale when session matches and no transcriptPath", () => {
    const sessions = [
      {
        id: "c1",
        workspacePath: "/ws",
        projectKey: "p",
        workspaceLabel: "ws",
        status: "idle",
        summary: "s",
        currentAction: "",
        lastActivityAt: 1,
        subagentCount: 0,
        subagentRunning: 0,
        transcriptPath: "/t",
        recentMessages: [],
      } satisfies SessionState,
    ];
    expect(
      isLibraryEntryStale(
        entry({ conversationId: "c1", mark: "todo", workspacePath: "/ws" }),
        sessions,
      ),
    ).toBe(false);
  });

  it("stale when no path and no session", () => {
    expect(isLibraryEntryStale(entry({ conversationId: "c1", mark: "todo" }), [])).toBe(true);
  });

  it("not stale when stored transcriptPath is gone but the session is still in the store", () => {
    const sessions = [
      {
        id: "c1",
        workspacePath: "/ws",
        projectKey: "p",
        workspaceLabel: "ws",
        status: "idle",
        summary: "s",
        currentAction: "",
        lastActivityAt: 1,
        subagentCount: 0,
        subagentRunning: 0,
        transcriptPath: "/new.jsonl",
        recentMessages: [],
      } satisfies SessionState,
    ];
    expect(
      isLibraryEntryStale(
        entry({
          conversationId: "c1",
          mark: "todo",
          transcriptPath: "/old.jsonl",
          workspacePath: "/ws",
        }),
        sessions,
        (p) => p === "/new.jsonl",
      ),
    ).toBe(false);
  });

  it("not stale when transcript is at conventional path even if not in the running session list", () => {
    const conversationId = "0da65b02-5652-48da-9563-12207f3c4ceb";
    const workspacePath = "/Users/me/idea/datad";
    const projectsDir = "/projects";
    const jsonl = `${projectsDir}/Users-me-idea-datad/agent-transcripts/${conversationId}/${conversationId}.jsonl`;
    expect(
      isLibraryEntryStale(
        entry({ conversationId, mark: "archive", workspacePath }),
        [],
        (p) => p === jsonl,
        { projectsDir },
      ),
    ).toBe(false);
  });
});
