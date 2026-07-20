import type { ChildProcess } from "node:child_process";

/**
 * Idempotent finish bound to one child process identity.
 * Prevents a previous scan's exit/error from finishing a newer fork
 * when notifyFullScanComplete immediately re-forks (pendingFullScan).
 */
export function createScanFinishGuard(
  proc: ChildProcess,
  getChild: () => ChildProcess | null,
  clearChild: () => void,
  onComplete: () => void,
): { finish: () => void; isCurrent: () => boolean } {
  let finished = false;
  const isCurrent = () => getChild() === proc;
  return {
    isCurrent,
    finish() {
      if (finished || !isCurrent()) return;
      finished = true;
      clearChild();
      onComplete();
    },
  };
}
