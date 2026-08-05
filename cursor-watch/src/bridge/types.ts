export type BridgeFocusRequest = {
  conversationId: string;
  workspacePath: string;
  requestId: string;
};

export type BridgeFocusResult = { ok: true } | { ok: false; error: string };

export type BridgeRegisterInfo = {
  extensionVersion: string;
  capabilities: string[];
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
    }
  | { type: "heartbeat"; clientId: string }
  | {
      type: "focus-result";
      requestId: string;
      ok: boolean;
      error?: string;
    };
