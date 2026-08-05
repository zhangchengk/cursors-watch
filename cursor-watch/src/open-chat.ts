import type { BridgeHub } from "./bridge/hub.js";
import type { BridgeFocusResult } from "./bridge/types.js";
import {
  isAllowedWorkspacePath,
  openWorkspaceInCursor,
  type OpenWorkspaceResult,
} from "./open-workspace.js";
import type { SessionState } from "./types.js";

export type OpenChatStage = "workspace" | "bridge" | "focus";

export type OpenChatResult =
  | { ok: true }
  | { ok: false; stage: OpenChatStage; error: string; statusCode?: number };

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function openChatInCursor(opts: {
  conversationId: string;
  workspacePath: string;
  sessions: SessionState[];
  openWorkspace?: (args: {
    workspacePath: string;
    sessions: SessionState[];
  }) => Promise<OpenWorkspaceResult>;
  bridge: Pick<BridgeHub, "isOnline" | "focus" | "hasClientForWorkspace">;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
  /** After open workspace, wait for a bridge client that reports this folder */
  workspaceBridgeWaitMs?: number;
}): Promise<OpenChatResult> {
  const conversationId = opts.conversationId?.trim() ?? "";
  const workspacePath = opts.workspacePath?.trim() ?? "";
  const sleep = opts.sleep ?? defaultSleep;
  const retryDelayMs = opts.retryDelayMs ?? 2500;
  const workspaceBridgeWaitMs = opts.workspaceBridgeWaitMs ?? 4000;
  const openWorkspace = opts.openWorkspace ?? openWorkspaceInCursor;

  if (!isAllowedWorkspacePath(workspacePath, opts.sessions)) {
    return {
      ok: false,
      stage: "workspace",
      error: "不允许打开该路径",
      statusCode: 403,
    };
  }

  const session = opts.sessions.find(
    (s) => s.id === conversationId && s.workspacePath === workspacePath,
  );
  if (!session) {
    return {
      ok: false,
      stage: "focus",
      error: "会话不存在",
      statusCode: 404,
    };
  }

  const ws1 = await openWorkspace({
    workspacePath,
    sessions: opts.sessions,
  });
  if (!ws1.ok) {
    return {
      ok: false,
      stage: "workspace",
      error: ws1.error,
      statusCode: ws1.statusCode,
    };
  }

  // Prefer the Cursor window that already has this folder open.
  const deadline = Date.now() + workspaceBridgeWaitMs;
  while (
    !opts.bridge.hasClientForWorkspace?.(workspacePath) &&
    Date.now() < deadline
  ) {
    await sleep(200);
  }

  if (!opts.bridge.isOnline(workspacePath) && !opts.bridge.isOnline()) {
    await sleep(retryDelayMs);
    if (!opts.bridge.isOnline(workspacePath) && !opts.bridge.isOnline()) {
      return {
        ok: false,
        stage: "bridge",
        error: "桥未连接：请确认已装扩展且 Cursor 已打开",
      };
    }
  }

  const tryFocus = (): Promise<BridgeFocusResult> =>
    opts.bridge.focus({ conversationId, workspacePath });

  let focusResult = await tryFocus();
  if (focusResult.ok) return { ok: true };

  await sleep(retryDelayMs);
  const ws2 = await openWorkspace({
    workspacePath,
    sessions: opts.sessions,
  });
  if (!ws2.ok) {
    return {
      ok: false,
      stage: "workspace",
      error: ws2.error,
      statusCode: ws2.statusCode,
    };
  }

  const deadline2 = Date.now() + workspaceBridgeWaitMs;
  while (
    !opts.bridge.hasClientForWorkspace?.(workspacePath) &&
    Date.now() < deadline2
  ) {
    await sleep(200);
  }

  focusResult = await tryFocus();
  if (focusResult.ok) return { ok: true };

  return {
    ok: false,
    stage: "focus",
    error: "未能定位到 Chat",
  };
}
