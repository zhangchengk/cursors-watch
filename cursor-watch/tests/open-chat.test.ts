import { describe, expect, it, vi } from "vitest";
import { focusChatInNewWindow, openChatInCursor } from "../src/open-chat.js";
import type { SessionState } from "../src/types.js";

function sess(over: Partial<SessionState> & Pick<SessionState, "id" | "workspacePath">): SessionState {
  return {
    projectKey: "p",
    workspaceLabel: "lab",
    status: "idle",
    summary: "s",
    currentAction: "a",
    lastActivityAt: 1,
    subagentCount: 0,
    subagentRunning: 0,
    transcriptPath: "/t",
    recentMessages: [],
    ...over,
  };
}

function bridgeStub(over: {
  focus?: ReturnType<typeof vi.fn>;
  hasClientForWorkspace?: (p: string) => boolean;
  clientIdsForWorkspace?: (p: string) => string[];
  onlineClientIds?: () => string[];
  isOnline?: () => boolean;
}) {
  return {
    isOnline: over.isOnline ?? (() => true),
    focus: over.focus ?? vi.fn().mockResolvedValue({ ok: true }),
    hasClientForWorkspace: over.hasClientForWorkspace ?? (() => true),
    clientIdsForWorkspace: over.clientIdsForWorkspace ?? (() => ["c-old"]),
    onlineClientIds: over.onlineClientIds ?? (() => ["c-old"]),
  };
}

describe("openChatInCursor", () => {
  it("404 when conversationId not found for path", async () => {
    const r = await openChatInCursor({
      conversationId: "missing",
      workspacePath: "/Users/u/A",
      sessions: [sess({ id: "real", workspacePath: "/Users/u/A" })],
      bridge: bridgeStub({}),
      openWorkspace: vi.fn(),
      activateCursor: vi.fn(),
      deferFocus: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.statusCode).toBe(404);
  });

  it("raises existing workspace window (no -n) before activate and Chat focus", async () => {
    const openWorkspace = vi.fn().mockResolvedValue({ ok: true });
    const activateCursor = vi.fn().mockResolvedValue(undefined);
    const focus = vi.fn().mockResolvedValue({ ok: true });
    const onFocusResult = vi.fn();
    const r = await openChatInCursor({
      conversationId: "real",
      workspacePath: "/Users/u/A",
      sessions: [sess({ id: "real", workspacePath: "/Users/u/A" })],
      openWorkspace,
      activateCursor,
      onFocusResult,
      bridge: bridgeStub({
        focus,
        hasClientForWorkspace: () => true,
        clientIdsForWorkspace: () => ["c-old"],
        onlineClientIds: () => ["c-old"],
      }),
    });
    expect(r).toEqual({ ok: true, stage: "opened" });
    expect(openWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: "/Users/u/A",
        newWindow: false,
      }),
    );
    expect(activateCursor).toHaveBeenCalled();
    expect(openWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      activateCursor.mock.invocationCallOrder[0],
    );
    await vi.waitFor(() => expect(onFocusResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
    ));
    expect(focus).toHaveBeenCalledWith({
      conversationId: "real",
      workspacePath: "/Users/u/A",
    });
  });

  it("still opens Chat when raising the existing window fails", async () => {
    const openWorkspace = vi.fn().mockResolvedValue({
      ok: false,
      error: "spawn failed",
    });
    const activateCursor = vi.fn().mockResolvedValue(undefined);
    const onFocusResult = vi.fn();
    const r = await openChatInCursor({
      conversationId: "real",
      workspacePath: "/Users/u/A",
      sessions: [sess({ id: "real", workspacePath: "/Users/u/A" })],
      openWorkspace,
      activateCursor,
      onFocusResult,
      bridge: bridgeStub({
        hasClientForWorkspace: () => true,
        clientIdsForWorkspace: () => ["c-old"],
        onlineClientIds: () => ["c-old"],
      }),
    });
    expect(r).toEqual({ ok: true, stage: "opened" });
    expect(activateCursor).toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(onFocusResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true }),
      ),
    );
  });

  it("opens -n when workspace not bridged", async () => {
    const openWorkspace = vi.fn().mockResolvedValue({ ok: true });
    const focus = vi.fn().mockResolvedValue({ ok: true });
    let ids: string[] = [];
    let has = false;
    const r = await openChatInCursor({
      conversationId: "real",
      workspacePath: "/Users/u/A",
      sessions: [sess({ id: "real", workspacePath: "/Users/u/A" })],
      openWorkspace,
      activateCursor: vi.fn().mockResolvedValue(undefined),
      onFocusResult: vi.fn(),
      bridge: bridgeStub({
        focus,
        hasClientForWorkspace: () => has,
        clientIdsForWorkspace: () => ids,
        onlineClientIds: () => ids,
      }),
      sleep: vi.fn().mockImplementation(async () => {
        has = true;
        ids = ["c-new"];
      }),
      newClientWaitMs: 500,
    });
    expect(r).toEqual({ ok: true, stage: "opened" });
    expect(openWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ newWindow: true }),
    );
  });

  it("allows reminder-only workspace paths", async () => {
    const r = await openChatInCursor({
      conversationId: "rem-1",
      workspacePath: "/Users/u/old",
      sessions: [sess({ id: "other", workspacePath: "/Users/u/A" })],
      reminders: [{ conversationId: "rem-1", workspacePath: "/Users/u/old" }],
      openWorkspace: vi.fn().mockResolvedValue({ ok: true }),
      activateCursor: vi.fn().mockResolvedValue(undefined),
      bridge: bridgeStub({
        hasClientForWorkspace: () => false,
        clientIdsForWorkspace: () => [],
        onlineClientIds: () => [],
      }),
      deferFocus: false,
    });
    expect(r).toEqual({ ok: true, stage: "opened" });
  });

  it("allows library-only workspace paths", async () => {
    const r = await openChatInCursor({
      conversationId: "lib-1",
      workspacePath: "/Users/u/archived",
      sessions: [sess({ id: "other", workspacePath: "/Users/u/A" })],
      libraryEntries: [{ conversationId: "lib-1", workspacePath: "/Users/u/archived" }],
      openWorkspace: vi.fn().mockResolvedValue({ ok: true }),
      activateCursor: vi.fn().mockResolvedValue(undefined),
      bridge: bridgeStub({
        hasClientForWorkspace: () => false,
        clientIdsForWorkspace: () => [],
        onlineClientIds: () => [],
      }),
      deferFocus: false,
    });
    expect(r).toEqual({ ok: true, stage: "opened" });
  });
});

describe("focusChatInNewWindow", () => {
  it("reuses existing workspace client when -n did not add a newcomer", async () => {
    const focus = vi.fn().mockResolvedValue({ ok: true });
    const r = await focusChatInNewWindow({
      conversationId: "real",
      workspacePath: "/Users/u/A",
      clientsBefore: new Set(["c-old"]),
      bridge: bridgeStub({
        focus,
        clientIdsForWorkspace: () => ["c-old"],
        onlineClientIds: () => ["c-old"],
      }),
      sleep: vi.fn().mockResolvedValue(undefined),
      newClientWaitMs: 900,
    });
    expect(r.ok).toBe(true);
    expect(focus).toHaveBeenCalledWith({
      conversationId: "real",
      workspacePath: "/Users/u/A",
    });
  });

  it("prefers newcomer clients when they appear", async () => {
    const focus = vi.fn().mockResolvedValue({ ok: true });
    let ids = ["c-old"];
    const r = await focusChatInNewWindow({
      conversationId: "real",
      workspacePath: "/Users/u/A",
      clientsBefore: new Set(["c-old"]),
      bridge: bridgeStub({
        focus,
        clientIdsForWorkspace: () => ids,
        onlineClientIds: () => ids,
      }),
      sleep: vi.fn().mockImplementation(async () => {
        ids = ["c-old", "c-new"];
      }),
      newClientWaitMs: 500,
    });
    expect(r.ok).toBe(true);
    expect(focus).toHaveBeenCalledWith({
      conversationId: "real",
      workspacePath: "/Users/u/A",
      preferClientIds: ["c-new"],
    });
  });
});
