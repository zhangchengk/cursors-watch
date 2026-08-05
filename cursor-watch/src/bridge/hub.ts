import { randomUUID } from "node:crypto";
import type {
  BridgeFocusResult,
  BridgeRegisterInfo,
  BridgeServerToClient,
} from "./types.js";

type Client = {
  info: BridgeRegisterInfo;
  send: (msg: unknown) => void;
  lastHeartbeatAt: number;
};

type PendingFocus = {
  resolve: (r: BridgeFocusResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type BridgeHubOptions = {
  heartbeatTtlMs?: number;
  focusTimeoutMs?: number;
  now?: () => number;
};

export class BridgeHub {
  private readonly heartbeatTtlMs: number;
  private readonly focusTimeoutMs: number;
  private readonly now: () => number;
  private readonly clients = new Map<string, Client>();
  private readonly pending = new Map<string, PendingFocus>();

  constructor(opts?: BridgeHubOptions) {
    this.heartbeatTtlMs = opts?.heartbeatTtlMs ?? 15_000;
    this.focusTimeoutMs = opts?.focusTimeoutMs ?? 8_000;
    this.now = opts?.now ?? Date.now;
  }

  register(
    clientId: string,
    info: BridgeRegisterInfo,
    send: (msg: unknown) => void,
  ): void {
    const id = clientId?.trim();
    if (!id) return;
    this.clients.set(id, {
      info,
      send,
      lastHeartbeatAt: this.now(),
    });
  }

  heartbeat(clientId: string): void {
    const c = this.clients.get(clientId);
    if (!c) return;
    c.lastHeartbeatAt = this.now();
  }

  unregister(clientId: string): void {
    this.clients.delete(clientId);
  }

  isOnline(): boolean {
    return this.pickOnlineClient() !== null;
  }

  status(): { online: boolean; extensionVersion?: string } {
    const picked = this.pickOnlineClient();
    if (!picked) return { online: false };
    return { online: true, extensionVersion: picked.client.info.extensionVersion };
  }

  async focus(req: {
    conversationId: string;
    workspacePath: string;
  }): Promise<BridgeFocusResult> {
    const picked = this.pickOnlineClient();
    if (!picked) {
      return { ok: false, error: "桥未连接" };
    }

    const requestId = randomUUID();
    const msg: BridgeServerToClient = {
      type: "focus",
      requestId,
      conversationId: req.conversationId,
      workspacePath: req.workspacePath,
    };

    return new Promise<BridgeFocusResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, error: "focus timeout" });
      }, this.focusTimeoutMs);

      this.pending.set(requestId, { resolve, timer });
      try {
        picked.client.send(msg);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  onClientMessage(clientId: string, msg: unknown): void {
    if (!msg || typeof msg !== "object") return;
    const m = msg as Record<string, unknown>;
    const type = m.type;

    if (type === "heartbeat") {
      this.heartbeat(clientId);
      return;
    }

    if (type === "register") {
      // Allow re-register over existing WS with same send via register() from server.
      return;
    }

    if (type === "focus-result") {
      const requestId = typeof m.requestId === "string" ? m.requestId : "";
      const pending = this.pending.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      if (m.ok === true) {
        pending.resolve({ ok: true });
      } else {
        const error =
          typeof m.error === "string" && m.error.trim()
            ? m.error.trim()
            : "focus failed";
        pending.resolve({ ok: false, error });
      }
    }
  }

  private pickOnlineClient(): { clientId: string; client: Client } | null {
    const now = this.now();
    let best: { clientId: string; client: Client } | null = null;
    for (const [clientId, client] of this.clients) {
      if (now - client.lastHeartbeatAt > this.heartbeatTtlMs) continue;
      if (
        !client.info.capabilities.includes("canvas.openAgentByConversationId")
      ) {
        continue;
      }
      if (!best || client.lastHeartbeatAt > best.client.lastHeartbeatAt) {
        best = { clientId, client };
      }
    }
    return best;
  }
}
