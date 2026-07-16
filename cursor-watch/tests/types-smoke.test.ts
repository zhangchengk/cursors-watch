import { describe, expect, it } from "vitest";
import { ACTIVE_WINDOW_MS, DEFAULT_PORT, RUNNING_WINDOW_MS } from "../src/constants.js";

describe("constants", () => {
  it("matches spec windows and port", () => {
    expect(ACTIVE_WINDOW_MS).toBe(30 * 60 * 1000);
    expect(RUNNING_WINDOW_MS).toBe(2 * 60 * 1000);
    expect(DEFAULT_PORT).toBe(7423);
  });
});
