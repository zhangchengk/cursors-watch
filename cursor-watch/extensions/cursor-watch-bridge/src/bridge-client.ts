import * as vscode from "vscode";

const CAPABILITY = "canvas.openAgentByConversationId"; // register capability only; not used for focus

export type BridgeClientOptions = {
  port?: number;
  extensionVersion: string;
  log: (line: string) => void;
  executeFocus: (conversationId: string, workspacePath?: string) => Promise<void>;
  clientId?: string;
  getWorkspacePaths?: () => string[];
};

function defaultWorkspacePaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

/**
 * Connects to Cursors Watch daemon `/ws/bridge` and handles focus RPCs.
 */
export function startBridgeClient(opts: BridgeClientOptions): { dispose: () => void } {
  const port =
    opts.port ?? (Number(process.env.CURSOR_WATCH_PORT || "7423") || 7423);
  const clientId =
    opts.clientId ??
    (typeof vscode.env.sessionId === "string" && vscode.env.sessionId.trim()
      ? `ext-session-${vscode.env.sessionId}`
      : `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const getWorkspacePaths = opts.getWorkspacePaths ?? defaultWorkspacePaths;
  let ws: WebSocket | null = null;
  let disposed = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = 1000;

  const clearHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const send = (msg: unknown) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  };

  const connect = () => {
    if (disposed) return;
    const url = `ws://127.0.0.1:${port}/ws/bridge`;
    opts.log(`bridge connecting ${url}`);
    try {
      ws = new WebSocket(url);
    } catch (err) {
      opts.log(`bridge connect error: ${err instanceof Error ? err.message : String(err)}`);
      scheduleReconnect();
      return;
    }

    ws.addEventListener("open", () => {
      backoffMs = 1000;
      const workspacePaths = getWorkspacePaths();
      opts.log(`bridge connected workspaces=${workspacePaths.join(",") || "(none)"}`);
      send({
        type: "register",
        clientId,
        extensionVersion: opts.extensionVersion,
        capabilities: [CAPABILITY],
        workspacePaths,
      });
      clearHeartbeat();
      heartbeatTimer = setInterval(() => {
        send({
          type: "heartbeat",
          clientId,
          workspacePaths: getWorkspacePaths(),
        });
      }, 5000);
    });

    ws.addEventListener("message", (ev) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      const m = msg as Record<string, unknown>;
      if (m.type !== "focus") return;
      const requestId = typeof m.requestId === "string" ? m.requestId : "";
      const conversationId =
        typeof m.conversationId === "string" ? m.conversationId.trim() : "";
      const workspacePath =
        typeof m.workspacePath === "string" ? m.workspacePath.trim() : "";
      void (async () => {
        if (!conversationId) {
          send({
            type: "focus-result",
            requestId,
            ok: false,
            error: "missing conversationId",
          });
          return;
        }
        try {
          const mine = getWorkspacePaths();
          if (
            workspacePath &&
            mine.length > 0 &&
            !mine.some(
              (p) =>
                p === workspacePath ||
                p.replace(/\/$/, "") === workspacePath.replace(/\/$/, ""),
            )
          ) {
            opts.log(
              `skip focus: workspace mismatch want=${workspacePath} have=${mine.join(",")}`,
            );
            send({
              type: "focus-result",
              requestId,
              ok: false,
              error: "wrong Cursor window for workspace",
            });
            return;
          }
          opts.log(`focus ${conversationId} in ${mine.join(",") || "(empty)"}`);
          await opts.executeFocus(conversationId, workspacePath || undefined);
          send({ type: "focus-result", requestId, ok: true });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          opts.log(`focus failed: ${error}`);
          send({ type: "focus-result", requestId, ok: false, error });
        }
      })();
    });

    ws.addEventListener("close", () => {
      clearHeartbeat();
      opts.log("bridge disconnected");
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      /* close handler schedules reconnect */
    });
  };

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer) return;
    const wait = backoffMs;
    backoffMs = Math.min(backoffMs * 2, 30_000);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, wait);
  };

  connect();

  return {
    dispose() {
      disposed = true;
      clearHeartbeat();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      ws = null;
    },
  };
}

function tabUri(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input as { uri?: vscode.Uri } | undefined;
  if (input && typeof input === "object" && input.uri instanceof vscode.Uri) {
    return input.uri;
  }
  return undefined;
}

/** If the chat is already an editor tab, reveal it instead of replacing the active one. */
export async function revealExistingComposerTab(
  conversationId: string,
): Promise<boolean> {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const uri = tabUri(tab);
      if (!uri) continue;
      const blob = `${uri.scheme}:${uri.path}?${uri.query}#${uri.fragment}`;
      if (!blob.includes(conversationId)) continue;
      try {
        await vscode.commands.executeCommand("vscode.open", uri);
        return true;
      } catch {
        try {
          await vscode.window.showTextDocument(uri, { preview: false, preserveFocus: false });
          return true;
        } catch {
          /* try next */
        }
      }
    }
  }
  return false;
}

/**
 * Open / focus Agent chat without clobbering the currently active chat tab.
 *
 * Only:
 * 1) reveal existing tab if already open
 * 2) openComposer with openInNewTab
 *
 * Never falls back to canvas.openAgentByConversationId (in-place replace).
 */
export async function focusLocalAgentByConversationId(
  conversationId: string,
): Promise<void> {
  if (await revealExistingComposerTab(conversationId)) {
    return;
  }

  // Command signature is (composerId: string, opts?), NOT {type,id,...}
  // (object-as-first-arg → Cursor minified "n.startsWith is not a function").
  await vscode.commands.executeCommand("composer.openComposer", conversationId, {
    openInNewTab: true,
  });
}
