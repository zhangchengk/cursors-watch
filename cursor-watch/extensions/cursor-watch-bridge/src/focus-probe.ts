import type * as vscode from "vscode";
import type { ProbeAttempt } from "./spike-verdict";

const INTERESTING =
  /composer|aichat|agent|chat\.|cursor\.chat|backgroundAgent/i;

export const PREFERRED_FOCUS_COMMANDS = [
  // Local Agent by conversationId (from dump). Do NOT include openCloudAgentById —
  // that opens the "Open Cloud Agent by ID" UI (bc-* cloud ids), not local chats.
  "canvas.openAgentByConversationId",
  "composer.getComposerHandleById",
  "composer.focusComposer",
  "composer.openComposer",
  "composer.openChatAsEditor",
  "composer.resumeCurrentChat",
  "workbench.action.openAgentsView",
] as const;

/** Never auto-try these — wrong product surface for Watch local conversationId. */
const BLOCKED_COMMAND =
  /backgroundComposer|openCloudAgentById|openInWebForBackground|go\/prompts|handleBugBot/i;

export async function listInterestingCommands(
  getCommands: (filterInternal?: boolean) => Thenable<string[]>,
): Promise<string[]> {
  const all = await getCommands(false);
  return all.filter((id) => INTERESTING.test(id) && !BLOCKED_COMMAND.test(id)).sort();
}

export function preferredFocusCommands(allInteresting: string[]): string[] {
  const set = new Set(allInteresting);
  const out: string[] = [];
  for (const id of PREFERRED_FOCUS_COMMANDS) {
    if (set.has(id) && !BLOCKED_COMMAND.test(id)) out.push(id);
  }
  for (const id of allInteresting) {
    if (out.includes(id) || BLOCKED_COMMAND.test(id)) continue;
    if (/composer\.(focus|select|open)/i.test(id)) out.push(id);
    if (/openAgentByConversationId|getComposerHandleById/i.test(id)) out.push(id);
  }
  return out;
}

export type FocusProbeDeps = {
  executeCommand: (command: string, ...args: unknown[]) => Thenable<unknown>;
  getCommands: (filterInternal?: boolean) => Thenable<string[]>;
  log: (line: string) => void;
  /** Human confirms the correct chat is visible. Default provided by extension.ts */
  confirmVisualFocus?: () => Promise<boolean>;
};

export async function probeFocusByConversationId(
  conversationId: string,
  deps: FocusProbeDeps,
): Promise<ProbeAttempt[]> {
  const attempts: ProbeAttempt[] = [];
  const interesting = await listInterestingCommands(deps.getCommands);
  const commands = preferredFocusCommands(interesting);
  deps.log(`Interesting commands: ${interesting.length}; trying ${commands.length}`);

  const shapesFor = (command: string): Array<{ label: string; args: unknown[] }> => {
    // canvas.openAgentByConversationId: string id only first (object shapes may
    // hit unrelated deeplink / prompts UI).
    if (command === "canvas.openAgentByConversationId") {
      return [
        { label: "string", args: [conversationId] },
        { label: "{conversationId}", args: [{ conversationId }] },
      ];
    }
    return [
      { label: "string", args: [conversationId] },
      { label: "{composerId}", args: [{ composerId: conversationId }] },
      { label: "{conversationId}", args: [{ conversationId }] },
      { label: "{id}", args: [{ id: conversationId }] },
    ];
  };

  const confirm = deps.confirmVisualFocus ?? (async () => false);

  for (const command of commands) {
    for (const shape of shapesFor(command)) {
      const detailBase = `${command} ${shape.label}`;
      try {
        deps.log(`try ${detailBase}`);
        await deps.executeCommand(command, ...shape.args);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attempts.push({
          strategy: "command",
          ok: false,
          detail: `${detailBase} threw: ${msg}`,
        });
        continue;
      }

      const visualOk = await confirm();
      attempts.push({
        strategy: "command",
        ok: visualOk,
        detail: `${detailBase} no-throw; visual=${visualOk}`,
      });
      if (visualOk) return attempts;
    }
  }

  return attempts;
}

/** Single-shot: only canvas.openAgentByConversationId with string id. */
export async function probeCanvasOpenOnly(
  conversationId: string,
  deps: FocusProbeDeps,
): Promise<ProbeAttempt[]> {
  const attempts: ProbeAttempt[] = [];
  const confirm = deps.confirmVisualFocus ?? (async () => false);
  const command = "canvas.openAgentByConversationId";
  const detailBase = `${command} string`;
  try {
    deps.log(`try ${detailBase} (narrow)`);
    await deps.executeCommand(command, conversationId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    attempts.push({ strategy: "command", ok: false, detail: `${detailBase} threw: ${msg}` });
    return attempts;
  }
  const visualOk = await confirm();
  attempts.push({
    strategy: "command",
    ok: visualOk,
    detail: `${detailBase} no-throw; visual=${visualOk}`,
  });
  return attempts;
}
