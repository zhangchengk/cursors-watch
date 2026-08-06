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

  /** Online bridge client ids whose workspacePaths include this folder. */
  clientIdsForWorkspace(workspacePath: string): string[] {
    const now = this.now();
    const out: string[] = [];
    for (const [clientId, client] of this.clients) {
      if (now - client.lastHeartbeatAt > this.heartbeatTtlMs) continue;
      if (
        !client.info.capabilities.includes("canvas.openAgentByConversationId")
      ) {
        continue;
      }
      if (workspacePathsMatch(workspacePath, client.info.workspacePaths)) {
        out.push(clientId);
      }
    }
    return out;
  }

  /** All online bridge clients that can focus (any workspace, including empty). */
  onlineClientIds(): string[] {
    const now = this.now();
    const out: string[] = [];
    for (const [clientId, client] of this.clients) {
      if (now - client.lastHeartbeatAt > this.heartbeatTtlMs) continue;
      if (
        !client.info.capabilities.includes("canvas.openAgentByConversationId")
      ) {
        continue;
      }
      out.push(clientId);
    }
    return out;
  }

  status(): { online: boolean; extensionVersion?: string; workspaces?: string[] } {
    const picked = this.pickOnlineClient();
    if (!picked) return { online: false };
    const workspaces = [
      ...new Set(
        [...this.clients.values()]
          .filter((c) => this.now() - c.lastHeartbeatAt <= this.heartbeatTtlMs)
          .flatMap((c) => c.info.workspacePaths ?? []),
      ),
    ];
    return {
      online: true,
      extensionVersion: picked.client.info.extensionVersion,
      workspaces,
    };
  }

  async focus(req: {
    conversationId: string;
    workspacePath: string;
    /** Prefer these bridge client ids (e.g. freshly opened window). */
    preferClientIds?: string[];
  }): Promise<BridgeFocusResult> {
    const prefer = (req.preferClientIds ?? [])
      .map((id) => id.trim())
      .filter(Boolean);

    // Prefer workspace-matched window. Only fall back to any online client when
    // no client has reported workspacePaths yet (legacy / empty window).
    let picked = this.pickOnlineClient(req.workspacePath, {
      requireWorkspaceMatch: true,
      preferClientIds: prefer,
    });

    // Open Chat jump: when caller requires a specific new-window client and it
    // is gone, do NOT fall back to an older window (would replace that Chat).
    if (prefer.length > 0 && !picked) {
      return {
        ok: false,
        error: "目标新窗口桥已断开，未改动其它 Cursor 窗口",
      };
    }
    // If prefer was set and pickOnlineClient returned a non-preferred match
    // because preferred ids were offline — pickOnlineClient only returns
    // bestPreferred when prefer is non-empty and matched; otherwise bestMatch.
    // Guard: when prefer was requested, only accept preferred clients.
    if (prefer.length > 0 && picked && !prefer.includes(picked.clientId)) {
      return {
        ok: false,
        error: "目标新窗口桥已断开，未改动其它 Cursor 窗口",
      };
    }

    if (!picked) {
      const anyWithPaths = this.anyOnlineClientReportingWorkspaces();
      if (anyWithPaths) {
        return {
          ok: false,
          error: "没有对应该工程的 Cursor 窗口（请先打开该文件夹）",
        };
      }
      picked = this.pickOnlineClient(undefined, {
        preferClientIds: prefer,
      });
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
    opts?: {
      requireWorkspaceMatch?: boolean;
      preferClientIds?: string[];
    },
  ): { clientId: string; client: Client } | null {
    const now = this.now();
    const requireMatch = opts?.requireWorkspaceMatch === true;
    const prefer = new Set(
      (opts?.preferClientIds ?? []).map((id) => id.trim()).filter(Boolean),
    );
    let bestPreferred: { clientId: string; client: Client } | null = null;
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
      const matchesWs =
        !!preferredWorkspace &&
        workspacePathsMatch(preferredWorkspace, client.info.workspacePaths);
      if (matchesWs) {
        if (
          !bestMatch ||
          client.lastHeartbeatAt > bestMatch.client.lastHeartbeatAt
        ) {
          bestMatch = { clientId, client };
        }
        if (prefer.has(clientId)) {
          if (
            !bestPreferred ||
            client.lastHeartbeatAt > bestPreferred.client.lastHeartbeatAt
          ) {
            bestPreferred = { clientId, client };
          }
        }
      } else if (!preferredWorkspace && prefer.has(clientId)) {
        if (
          !bestPreferred ||
          client.lastHeartbeatAt > bestPreferred.client.lastHeartbeatAt
        ) {
          bestPreferred = { clientId, client };
        }
      }
    }

    if (bestPreferred) return bestPreferred;
    // When caller asked for specific clients, never silently fall back.
    if (prefer.size > 0) return null;
    if (requireMatch) return bestMatch;
    return bestMatch ?? bestAny;
  }
}
