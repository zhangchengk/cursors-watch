import type * as vscode from "vscode";
import type { ProbeAttempt } from "./spike-verdict";

const INTERESTING =
  /composer|aichat|agent|chat\.|cursor\.chat|backgroundAgent/i;

export const PREFERRED_FOCUS_COMMANDS = [
  "composer.focusComposer",
  "composer.selectComposer",
  "composer.openComposer",
  "composer.showComposer",
  "composer.openChatAsEditor",
  "composer.resumeCurrentComposer",
  "aichat.open",
  "workbench.action.chat.open",
] as const;

export async function listInterestingCommands(
  getCommands: (filterInternal?: boolean) => Thenable<string[]>,
): Promise<string[]> {
  const all = await getCommands(false);
  return all.filter((id) => INTERESTING.test(id)).sort();
}

export function preferredFocusCommands(allInteresting: string[]): string[] {
  const set = new Set(allInteresting);
  const out: string[] = [];
  for (const id of PREFERRED_FOCUS_COMMANDS) {
    if (set.has(id)) out.push(id);
  }
  for (const id of allInteresting) {
    if (out.includes(id)) continue;
    if (/composer\.(focus|select|open)/i.test(id)) out.push(id);
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

  const shapes: Array<{ label: string; args: unknown[] }> = [
    { label: "string", args: [conversationId] },
    { label: "{composerId}", args: [{ composerId: conversationId }] },
    { label: "{conversationId}", args: [{ conversationId }] },
    { label: "{id}", args: [{ id: conversationId }] },
  ];

  const confirm = deps.confirmVisualFocus ?? (async () => false);

  for (const command of commands) {
    for (const shape of shapes) {
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
