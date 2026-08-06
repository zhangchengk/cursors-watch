import type { BridgeHub } from "./bridge/hub.js";
import type { BridgeFocusResult } from "./bridge/types.js";
import {
  activateCursorApp,
  isAllowedWorkspacePath,
  openWorkspaceInCursor,
  type OpenWorkspaceResult,
} from "./open-workspace.js";
import type { SessionState } from "./types.js";

export type OpenChatStage = "workspace" | "bridge" | "focus" | "opened";

export type OpenChatResult =
  | { ok: true; stage: "opened" }
  | { ok: false; stage: Exclude<OpenChatStage, "opened">; error: string; statusCode?: number };

export type OpenChatFocusResult =
  | { ok: true; conversationId: string; workspacePath: string }
  | { ok: false; conversationId: string; workspacePath: string; error: string };

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type OpenChatBridge = Pick<
  BridgeHub,
  | "isOnline"
  | "focus"
  | "hasClientForWorkspace"
  | "clientIdsForWorkspace"
  | "onlineClientIds"
>;

export type OpenChatDeps = {
  conversationId: string;
  workspacePath: string;
  sessions: SessionState[];
  reminders?: Array<{ conversationId: string; workspacePath?: string }>;
  libraryEntries?: Array<{ conversationId: string; workspacePath?: string }>;
  openWorkspace?: (args: {
    workspacePath: string;
    sessions: SessionState[];
    extraAllowedPaths?: Iterable<string | undefined>;
    newWindow?: boolean;
  }) => Promise<OpenWorkspaceResult>;
  activateCursor?: () => Promise<void>;
  bridge: OpenChatBridge;
  sleep?: (ms: number) => Promise<void>;
  newClientWaitMs?: number;
  deferFocus?: boolean;
  onFocusResult?: (result: OpenChatFocusResult) => void;
};

function knownTargetPathsOf(
  rows: Array<{ workspacePath?: string }> | undefined,
): string[] {
  return (rows ?? [])
    .map((r) => r.workspacePath)
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0);
}

function assertOpenChatTarget(opts: {
  conversationId: string;
  workspacePath: string;
  sessions: SessionState[];
  reminders?: Array<{ conversationId: string; workspacePath?: string }>;
  libraryEntries?: Array<{ conversationId: string; workspacePath?: string }>;
}): OpenChatResult | null {
  const conversationId = opts.conversationId?.trim() ?? "";
  const workspacePath = opts.workspacePath?.trim() ?? "";
  const paths = [
    ...knownTargetPathsOf(opts.reminders),
    ...knownTargetPathsOf(opts.libraryEntries),
  ];

  if (!isAllowedWorkspacePath(workspacePath, opts.sessions, paths)) {
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
  const reminder = (opts.reminders ?? []).find(
    (r) =>
      r.conversationId === conversationId && r.workspacePath === workspacePath,
  );
  const library = (opts.libraryEntries ?? []).find(
    (r) =>
      r.conversationId === conversationId && r.workspacePath === workspacePath,
  );
  if (!session && !reminder && !library) {
    return {
      ok: false,
      stage: "focus",
      error: "会话不存在",
      statusCode: 404,
    };
  }
  return null;
}

/**
 * Focus the target Agent chat via the bridge.
 *
 * When `clientsBefore` is provided (after spawning `-n`), prefer newly registered
 * clients that report `workspacePath`. If Cursor did not actually create a new
 * window (common when the folder is already open — `-n` is a no-op), fall back to
 * any online client for that workspace so Chat still opens.
 */
export async function focusChatInNewWindow(opts: {
  conversationId: string;
  workspacePath: string;
  clientsBefore?: ReadonlySet<string>;
  bridge: OpenChatBridge;
  sleep?: (ms: number) => Promise<void>;
  newClientWaitMs?: number;
}): Promise<OpenChatFocusResult> {
  const conversationId = opts.conversationId.trim();
  const workspacePath = opts.workspacePath.trim();
  const sleep = opts.sleep ?? defaultSleep;
  const newClientWaitMs = opts.newClientWaitMs ?? 12_000;
  const before = opts.clientsBefore;

  const newcomersForPath = (): string[] => {
    if (!before) return [];
    const online =
      opts.bridge.onlineClientIds?.() ??
      opts.bridge.clientIdsForWorkspace(workspacePath);
    const withPath = new Set(opts.bridge.clientIdsForWorkspace(workspacePath));
    return online.filter((id) => !before.has(id) && withPath.has(id));
  };

  const anyForPath = (): string[] =>
    opts.bridge.clientIdsForWorkspace(workspacePath);

  if (before) {
    const deadline = Date.now() + newClientWaitMs;
    while (newcomersForPath().length === 0 && Date.now() < deadline) {
      // Folder already open: Cursor often never adds a new bridge client.
      // Exit early once we still have the pre-existing workspace client.
      if (anyForPath().some((id) => before.has(id)) && Date.now() > deadline - newClientWaitMs + 800) {
        // After ~800ms with no newcomer, fall through to reuse existing.
        break;
      }
      await sleep(100);
    }
  } else {
    const deadline = Date.now() + Math.min(newClientWaitMs, 5000);
    while (anyForPath().length === 0 && Date.now() < deadline) {
      await sleep(100);
    }
  }

  const newcomers = newcomersForPath();
  let focusResult: BridgeFocusResult;
  if (newcomers.length > 0) {
    focusResult = await opts.bridge.focus({
      conversationId,
      workspacePath,
      preferClientIds: newcomers,
    });
  } else if (anyForPath().length > 0) {
    // Reuse existing window for this folder (Cursor `-n` no-op case).
    focusResult = await opts.bridge.focus({ conversationId, workspacePath });
  } else {
    return {
      ok: false,
      conversationId,
      workspacePath,
      error:
        "已打开工程，未能定位 Chat（桥未就绪：请确认扩展已装并 Reload Window）",
    };
  }

  if (focusResult.ok) {
    return { ok: true, conversationId, workspacePath };
  }
  return {
    ok: false,
    conversationId,
    workspacePath,
    error:
      ("error" in focusResult && focusResult.error) ||
      "已打开工程，未能定位 Chat",
  };
}

/**
 * Phase 1 returns `opened` quickly; Phase 2 focuses in the background.
 *
 * Evidence: `cursor -n <already-open-folder>` does not create a second Cursor
 * window / bridge client — so "always new window then only focus new client"
 * never opens Chat. Strategy:
 * 1. If workspace already bridged → activate + focus that window (no `-n`).
 * 2. Else → `-n`, wait for client (new or any), then focus.
 */
export async function openChatInCursor(
  opts: OpenChatDeps,
): Promise<OpenChatResult> {
  const conversationId = opts.conversationId?.trim() ?? "";
  const workspacePath = opts.workspacePath?.trim() ?? "";
  const openWorkspace = opts.openWorkspace ?? openWorkspaceInCursor;
  const activateCursor = opts.activateCursor ?? (() => activateCursorApp());
  const deferFocus = opts.deferFocus !== false;
  const extraPaths = [
    ...knownTargetPathsOf(opts.reminders),
    ...knownTargetPathsOf(opts.libraryEntries),
  ];

  const denied = assertOpenChatTarget({
    conversationId,
    workspacePath,
    sessions: opts.sessions,
    reminders: opts.reminders,
    libraryEntries: opts.libraryEntries,
  });
  if (denied) return denied;

  const alreadyOpen = opts.bridge.hasClientForWorkspace(workspacePath);
  const clientsBefore = alreadyOpen
    ? undefined
    : new Set(
        opts.bridge.onlineClientIds?.() ??
          opts.bridge.clientIdsForWorkspace(workspacePath),
      );

  if (!alreadyOpen) {
    const ws1 = await openWorkspace({
      workspacePath,
      sessions: opts.sessions,
      extraAllowedPaths: extraPaths,
      newWindow: true,
    });
    if (!ws1.ok) {
      return {
        ok: false,
        stage: "workspace",
        error: ws1.error,
        statusCode: ws1.statusCode,
      };
    }
  }

  await activateCursor();

  if (deferFocus) {
    void focusChatInNewWindow({
      conversationId,
      workspacePath,
      clientsBefore,
      bridge: opts.bridge,
      sleep: opts.sleep,
      newClientWaitMs: opts.newClientWaitMs,
    })
      .then((r) => opts.onFocusResult?.(r))
      .catch((err) => {
        opts.onFocusResult?.({
          ok: false,
          conversationId,
          workspacePath,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  return { ok: true, stage: "opened" };
}
