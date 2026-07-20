import { describe, expect, it } from "vitest";
import {
  ACTIVE_WINDOW_MS,
  DEFAULT_PORT,
  FULL_SCAN_INTERVAL_MS,
  INCREMENTAL_DEBOUNCE_MS,
  RUNNING_WINDOW_MS,
} from "../src/constants.js";

describe("constants", () => {
  it("matches spec windows and port", () => {
    expect(ACTIVE_WINDOW_MS).toBe(60 * 60 * 1000);
    expect(RUNNING_WINDOW_MS).toBe(2 * 60 * 1000);
    expect(DEFAULT_PORT).toBe(7423);
    expect(INCREMENTAL_DEBOUNCE_MS).toBe(80);
    expect(FULL_SCAN_INTERVAL_MS).toBe(5 * 60 * 1000);
  });
});
