export type BridgeFocusRequest = {
  conversationId: string;
  workspacePath: string;
  requestId: string;
};

export type BridgeFocusResult = { ok: true } | { ok: false; error: string };

export type BridgeRegisterInfo = {
  extensionVersion: string;
  capabilities: string[];
  /** Absolute workspace folder paths open in this Cursor window */
  workspacePaths?: string[];
};

export type BridgeServerToClient =
  | {
      type: "focus";
      requestId: string;
      conversationId: string;
      workspacePath: string;
    };

export type BridgeClientToServer =
  | {
      type: "register";
      clientId: string;
      extensionVersion: string;
      capabilities: string[];
      workspacePaths?: string[];
    }
  | {
      type: "heartbeat";
      clientId: string;
      workspacePaths?: string[];
    }
  | {
      type: "focus-result";
      requestId: string;
      ok: boolean;
      error?: string;
    };

/** Normalize for path equality (trailing slash, no resolve — keep simple & sync). */
export function normalizeWorkspacePath(p: string): string {
  const t = p.trim();
  if (!t) return "";
  if (t.length > 1 && (t.endsWith("/") || t.endsWith("\\"))) {
    return t.slice(0, -1);
  }
  return t;
}

export function workspacePathsMatch(
  candidate: string | undefined,
  reported: string[] | undefined,
): boolean {
  const want = normalizeWorkspacePath(candidate ?? "");
  if (!want || !reported?.length) return false;
  return reported.some((r) => normalizeWorkspacePath(r) === want);
}
