import { describe, expect, it, vi } from "vitest";
import { BridgeHub } from "../src/bridge/hub.js";

describe("BridgeHub", () => {
  it("isOnline false when empty", () => {
    expect(new BridgeHub().isOnline()).toBe(false);
  });

  it("isOnline true after register + fresh heartbeat", () => {
    const hub = new BridgeHub({ heartbeatTtlMs: 10_000 });
    const send = vi.fn();
    hub.register(
      "c1",
      { extensionVersion: "0.1.0", capabilities: ["canvas.openAgentByConversationId"] },
      send,
    );
    hub.heartbeat("c1");
    expect(hub.isOnline()).toBe(true);
  });

  it("isOnline false when heartbeat expired", () => {
    let now = 1_000;
    const hub = new BridgeHub({ heartbeatTtlMs: 100, now: () => now });
    hub.register(
      "c1",
      { extensionVersion: "0.1.0", capabilities: ["canvas.openAgentByConversationId"] },
      vi.fn(),
    );
    hub.heartbeat("c1");
    now = 1_250;
    expect(hub.isOnline()).toBe(false);
  });

  it("focus sends focus msg and resolves on focus-result ok", async () => {
    const hub = new BridgeHub({ focusTimeoutMs: 1_000 });
    const send = vi.fn((msg: unknown) => {
      const m = msg as { type: string; requestId: string };
      if (m.type === "focus") {
        hub.onClientMessage("c1", {
          type: "focus-result",
          requestId: m.requestId,
          ok: true,
        });
      }
    });
    hub.register(
      "c1",
      { extensionVersion: "0.1.0", capabilities: ["canvas.openAgentByConversationId"] },
      send,
    );
    hub.heartbeat("c1");
    const r = await hub.focus({
      conversationId: "abc",
      workspacePath: "/tmp/proj",
    });
    expect(r).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "focus",
        conversationId: "abc",
        workspacePath: "/tmp/proj",
      }),
    );
  });

  it("focus times out when no result", async () => {
    const hub = new BridgeHub({ focusTimeoutMs: 30 });
    hub.register(
      "c1",
      { extensionVersion: "0.1.0", capabilities: ["canvas.openAgentByConversationId"] },
      vi.fn(),
    );
    hub.heartbeat("c1");
    const r = await hub.focus({ conversationId: "abc", workspacePath: "/tmp/p" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/timeout|超时/i);
  });

  it("focus fails when no online bridge", async () => {
    const hub = new BridgeHub();
    const r = await hub.focus({ conversationId: "abc", workspacePath: "/tmp/p" });
    expect(r.ok).toBe(false);
  });
});
