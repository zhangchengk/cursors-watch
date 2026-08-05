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

/** Task 3 fills this in; Task 2 ships empty attempts. */
export async function probeFocusByConversationId(
  _conversationId: string,
  _deps: FocusProbeDeps,
): Promise<ProbeAttempt[]> {
  return [];
}
