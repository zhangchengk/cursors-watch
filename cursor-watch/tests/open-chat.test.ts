import { describe, expect, it, vi } from "vitest";
import { openChatInCursor } from "../src/open-chat.js";
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

describe("openChatInCursor", () => {
  it("404 when conversationId not found for path", async () => {
    const r = await openChatInCursor({
      conversationId: "missing",
      workspacePath: "/Users/u/A",
      sessions: [sess({ id: "real", workspacePath: "/Users/u/A" })],
      bridge: { isOnline: () => true, focus: vi.fn() },
      openWorkspace: vi.fn(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("focus");
      expect(r.statusCode).toBe(404);
    }
  });

  it("403 when workspace path not allow-listed", async () => {
    const r = await openChatInCursor({
      conversationId: "real",
      workspacePath: "/evil",
      sessions: [sess({ id: "real", workspacePath: "/Users/u/A" })],
      bridge: { isOnline: () => true, focus: vi.fn() },
      openWorkspace: vi.fn(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("workspace");
      expect(r.statusCode).toBe(403);
    }
  });

  it("stage workspace when openWorkspace fails", async () => {
    const r = await openChatInCursor({
      conversationId: "real",
      workspacePath: "/Users/u/A",
      sessions: [sess({ id: "real", workspacePath: "/Users/u/A" })],
      bridge: { isOnline: () => true, focus: vi.fn() },
      openWorkspace: vi.fn().mockResolvedValue({ ok: false, error: "boom", statusCode: 500 }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe("workspace");
  });

  it("stage bridge when offline after wait", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const r = await openChatInCursor({
      conversationId: "real",
      workspacePath: "/Users/u/A",
      sessions: [sess({ id: "real", workspacePath: "/Users/u/A" })],
      openWorkspace: vi.fn().mockResolvedValue({ ok: true }),
      bridge: { isOnline: () => false, focus: vi.fn() },
      sleep,
      retryDelayMs: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe("bridge");
    expect(sleep).toHaveBeenCalled();
  });

  it("stage focus when focus fails after retry", async () => {
    const focus = vi.fn().mockResolvedValue({ ok: false, error: "nope" });
    const openWorkspace = vi.fn().mockResolvedValue({ ok: true });
    const r = await openChatInCursor({
      conversationId: "real",
      workspacePath: "/Users/u/A",
      sessions: [sess({ id: "real", workspacePath: "/Users/u/A" })],
      openWorkspace,
      bridge: { isOnline: () => true, focus },
      sleep: vi.fn().mockResolvedValue(undefined),
      retryDelayMs: 5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("focus");
      expect(r.error).toMatch(/未能定位到 Chat/);
    }
    expect(focus).toHaveBeenCalledTimes(2);
    expect(openWorkspace).toHaveBeenCalledTimes(2);
  });

  it("ok on happy path", async () => {
    const focus = vi.fn().mockResolvedValue({ ok: true });
    const r = await openChatInCursor({
      conversationId: "real",
      workspacePath: "/Users/u/A",
      sessions: [sess({ id: "real", workspacePath: "/Users/u/A" })],
      openWorkspace: vi.fn().mockResolvedValue({ ok: true }),
      bridge: { isOnline: () => true, focus },
    });
    expect(r).toEqual({ ok: true });
    expect(focus).toHaveBeenCalledWith({
      conversationId: "real",
      workspacePath: "/Users/u/A",
    });
  });
});
