import { describe, expect, it } from "vitest";
import { classifySpikeVerdict } from "../extensions/cursor-watch-bridge/src/spike-verdict.js";

describe("classifySpikeVerdict", () => {
  it("pass when any command strategy succeeds", () => {
    expect(
      classifySpikeVerdict([
        { strategy: "command", ok: false, detail: "nope" },
        { strategy: "command", ok: true, detail: "composer.focusComposer" },
        { strategy: "cdp", ok: true, detail: "would be ignored" },
      ]),
    ).toBe("pass");
  });

  it("fragile_pass when only cdp succeeds", () => {
    expect(
      classifySpikeVerdict([
        { strategy: "command", ok: false, detail: "x" },
        { strategy: "cdp", ok: true, detail: "selected chat" },
      ]),
    ).toBe("fragile_pass");
  });

  it("fail when nothing succeeds", () => {
    expect(
      classifySpikeVerdict([{ strategy: "command", ok: false, detail: "x" }]),
    ).toBe("fail");
  });

  it("fail on empty attempts", () => {
    expect(classifySpikeVerdict([])).toBe("fail");
  });
});
