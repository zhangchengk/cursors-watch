import { randomUUID } from "node:crypto";
import type {
  BridgeFocusResult,
  BridgeRegisterInfo,
  BridgeServerToClient,
} from "./types.js";
import { workspacePathsMatch } from "./types.js";

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
      info: {
        ...info,
        workspacePaths: info.workspacePaths ?? [],
      },
      send,
      lastHeartbeatAt: this.now(),
    });
  }

  heartbeat(clientId: string, workspacePaths?: string[]): void {
    const c = this.clients.get(clientId);
    if (!c) return;
    c.lastHeartbeatAt = this.now();
    if (workspacePaths) {
      c.info = { ...c.info, workspacePaths };
    }
  }

  unregister(clientId: string): void {
    this.clients.delete(clientId);
  }

  isOnline(workspacePath?: string): boolean {
    return this.pickOnlineClient(workspacePath) !== null;
  }

  /** True when an online client reports this workspace folder. */
  hasClientForWorkspace(workspacePath: string): boolean {
    return this.pickOnlineClient(workspacePath, { requireWorkspaceMatch: true }) !== null;
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
    // Prefer workspace-matched window. Only fall back to any online client when
    // no client has reported workspacePaths yet (legacy / empty window).
    let picked = this.pickOnlineClient(req.workspacePath, {
      requireWorkspaceMatch: true,
    });
    if (!picked) {
      const anyWithPaths = this.anyOnlineClientReportingWorkspaces();
      if (anyWithPaths) {
        return {
          ok: false,
          error: "没有对应该工程的 Cursor 窗口（请先打开该文件夹）",
        };
      }
      picked = this.pickOnlineClient();
    }
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
      const paths = Array.isArray(m.workspacePaths)
        ? m.workspacePaths.filter((p): p is string => typeof p === "string")
        : undefined;
      this.heartbeat(clientId, paths);
      return;
    }

    if (type === "register") {
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

  private anyOnlineClientReportingWorkspaces(): boolean {
    const now = this.now();
    for (const client of this.clients.values()) {
      if (now - client.lastHeartbeatAt > this.heartbeatTtlMs) continue;
      if ((client.info.workspacePaths?.length ?? 0) > 0) return true;
    }
    return false;
  }

  private pickOnlineClient(
    preferredWorkspace?: string,
    opts?: { requireWorkspaceMatch?: boolean },
  ): { clientId: string; client: Client } | null {
    const now = this.now();
    const requireMatch = opts?.requireWorkspaceMatch === true;
    let bestMatch: { clientId: string; client: Client } | null = null;
    let bestAny: { clientId: string; client: Client } | null = null;

    for (const [clientId, client] of this.clients) {
      if (now - client.lastHeartbeatAt > this.heartbeatTtlMs) continue;
      if (
        !client.info.capabilities.includes("canvas.openAgentByConversationId")
      ) {
        continue;
      }
      if (!bestAny || client.lastHeartbeatAt > bestAny.client.lastHeartbeatAt) {
        bestAny = { clientId, client };
      }
      if (
        preferredWorkspace &&
        workspacePathsMatch(preferredWorkspace, client.info.workspacePaths)
      ) {
        if (
          !bestMatch ||
          client.lastHeartbeatAt > bestMatch.client.lastHeartbeatAt
        ) {
          bestMatch = { clientId, client };
        }
      }
    }

    if (requireMatch) return bestMatch;
    return bestMatch ?? bestAny;
  }
}
