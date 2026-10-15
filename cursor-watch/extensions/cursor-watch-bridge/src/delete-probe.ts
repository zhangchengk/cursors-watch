import type { ProbeAttempt } from "./spike-verdict";

export const AGE_BATCH_DELETE_COMMANDS = ["developer.deleteOldChats"] as const;

const NOISE =
  /files\.delete|deleteFile|DeleteFile|notebook|GrokBot|SharedConversation|BackgroundComposer|CachedDetails|CodeBlock|PartialInline|MessageStorage|blame|AgentStore|HostSession|tool\.|v1\./i;

const INTERESTING = /delete|remove|purge|composer/i;

const PREFERRED_DELETE_SHAPES =
  /(?:^|\.)(deleteComposer|deleteChat|removeComposer|removeChat|delete-composer)(?:$|\.)/i;

/** Menu action id from Cursor sidebar Delete — try even if absent from getCommands. */
export const HARDCODED_DELETE_CANDIDATES = ["delete-composer"] as const;

export function isAgeBatchDeleteCommand(id: string): boolean {
  return (AGE_BATCH_DELETE_COMMANDS as readonly string[]).includes(id);
}

export function listDeleteInterestingCommands(allCommandIds: string[]): string[] {
  return allCommandIds
    .filter((id) => INTERESTING.test(id) && !NOISE.test(id))
    .sort();
}

export function preferredDeleteCommands(interesting: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of HARDCODED_DELETE_CANDIDATES) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of interesting) {
    if (isAgeBatchDeleteCommand(id)) continue;
    if (!PREFERRED_DELETE_SHAPES.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export type DeleteProbeDeps = {
  executeCommand: (command: string, ...args: unknown[]) => Thenable<unknown>;
  getCommands: (filterInternal?: boolean) => Thenable<string[]>;
  log: (line: string) => void;
  /** Human: chat gone from Agents sidebar? */
  confirmVisualDeleted?: () => Promise<boolean>;
  /** Skip Yes/No; used by file-triggered spike (verify via composerHeaders externally). */
  autoNoConfirm?: boolean;
};

export async function probeDeleteByConversationId(
  conversationId: string,
  deps: DeleteProbeDeps,
): Promise<ProbeAttempt[]> {
  const attempts: ProbeAttempt[] = [];
  const all = await deps.getCommands(false);
  const interesting = listDeleteInterestingCommands(all);
  const commands = preferredDeleteCommands(interesting);
  deps.log(
    `Delete-interesting: ${interesting.length}; preferred per-id: ${commands.length}`,
  );
  deps.log(
    `Age-batch present: ${AGE_BATCH_DELETE_COMMANDS.filter((id) => all.includes(id)).join(", ") || "(none)"}`,
  );

  if (commands.length === 0) {
    attempts.push({
      strategy: "command",
      ok: false,
      detail: "no preferred per-id delete commands in dump",
    });
    return attempts;
  }

  const shapes: Array<{ label: string; args: unknown[] }> = [
    { label: "string", args: [conversationId] },
    { label: "string,true", args: [conversationId, true] },
    { label: "{composerId}", args: [{ composerId: conversationId }] },
    { label: "{conversationId}", args: [{ conversationId }] },
    { label: "{id}", args: [{ id: conversationId }] },
  ];

  const confirm = deps.confirmVisualDeleted ?? (async () => false);
  /** When true, do not prompt; record no-throw as ok:false with noThrow flag for external verify. */
  const auto = deps.autoNoConfirm === true;

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

      if (auto) {
        attempts.push({
          strategy: "command",
          ok: false,
          detail: `${detailBase} no-throw; visual=skipped(auto)`,
        });
        // Keep trying other shapes; external sqlite verify decides pass/fail.
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
