import { describe, expect, it } from "vitest";
import {
  DEFAULT_PORT,
  FULL_SCAN_INTERVAL_MS,
  IDLE_KEEP_MS,
  INCREMENTAL_DEBOUNCE_MS,
  RUNNING_WINDOW_MS,
  TURN_ENDED_KEEP_MS,
  VISIBILITY_PRUNE_MS,
} from "../src/constants.js";

describe("constants", () => {
  it("matches spec windows and port", () => {
    expect(RUNNING_WINDOW_MS).toBe(2 * 60 * 1000);
    expect(DEFAULT_PORT).toBe(7423);
    expect(INCREMENTAL_DEBOUNCE_MS).toBe(80);
    expect(FULL_SCAN_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  it("exports layered retention constants", () => {
    expect(TURN_ENDED_KEEP_MS).toBe(30 * 60 * 1000);
    expect(IDLE_KEEP_MS).toBe(15 * 60 * 1000);
    expect(VISIBILITY_PRUNE_MS).toBe(30_000);
  });
});
