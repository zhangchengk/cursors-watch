import { describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import { createScanFinishGuard } from "../src/scan-finish-guard.js";

function fakeProc(id: string): ChildProcess {
  return { pid: id } as unknown as ChildProcess;
}

describe("createScanFinishGuard", () => {
  it("finish is idempotent (message + exit do not double-notify)", () => {
    let child: ChildProcess | null = fakeProc("A");
    const onComplete = vi.fn();
    const proc = child!;
    const { finish } = createScanFinishGuard(
      proc,
      () => child,
      () => {
        child = null;
      },
      onComplete,
    );

    finish(); // message path
    finish(); // exit path
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(child).toBeNull();
  });

  it("stale exit does not finish a newer child (pendingFullScan re-fork race)", () => {
    let child: ChildProcess | null = fakeProc("A");
    const onCompleteA = vi.fn(() => {
      // Simulate notifyFullScanComplete → pending → immediate re-fork
      child = fakeProc("B");
    });
    const procA = child!;
    const guardA = createScanFinishGuard(
      procA,
      () => child,
      () => {
        child = null;
      },
      onCompleteA,
    );

    // A's message completes → notify → forks B
    guardA.finish();
    expect(onCompleteA).toHaveBeenCalledTimes(1);
    expect(child).not.toBeNull();
    expect((child as { pid: string }).pid).toBe("B");

    // A's delayed exit must not clear/finish B
    guardA.finish();
    expect(onCompleteA).toHaveBeenCalledTimes(1);
    expect((child as { pid: string }).pid).toBe("B");

    // B's own finish still works
    const onCompleteB = vi.fn();
    const procB = child!;
    const guardB = createScanFinishGuard(
      procB,
      () => child,
      () => {
        child = null;
      },
      onCompleteB,
    );
    guardB.finish();
    expect(onCompleteB).toHaveBeenCalledTimes(1);
    expect(child).toBeNull();
  });

  it("isCurrent reflects process identity after replacement", () => {
    let child: ChildProcess | null = fakeProc("A");
    const procA = child!;
    const { isCurrent, finish } = createScanFinishGuard(
      procA,
      () => child,
      () => {
        child = null;
      },
      () => {
        child = fakeProc("B");
      },
    );

    expect(isCurrent()).toBe(true);
    finish();
    expect(isCurrent()).toBe(false);
  });
});
