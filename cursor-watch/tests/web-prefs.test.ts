import { describe, expect, it } from "vitest";
import {
  clampAttentionColumns,
  effectiveAttentionColumns,
  loadPrefs,
  saveAttentionColumns,
  saveViewMode,
} from "../src/web/prefs.js";

function memStorage(init: Record<string, string> = {}) {
  const data = { ...init };
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = String(v);
    },
    _data: data,
  };
}

describe("clampAttentionColumns", () => {
  it("clamps to 1..4 and defaults junk to 2", () => {
    expect(clampAttentionColumns(1)).toBe(1);
    expect(clampAttentionColumns(4)).toBe(4);
    expect(clampAttentionColumns(9)).toBe(2);
    expect(clampAttentionColumns("3")).toBe(3);
    expect(clampAttentionColumns("x")).toBe(2);
  });
});

describe("loadPrefs", () => {
  it("defaults when empty", () => {
    expect(loadPrefs(memStorage())).toEqual({
      viewMode: "attention",
      attentionColumns: 2,
    });
  });

  it("reads valid keys", () => {
    expect(
      loadPrefs(
        memStorage({
          "cursor-watch.viewMode": "workspace",
          "cursor-watch.attentionColumns": "3",
        }),
      ),
    ).toEqual({ viewMode: "workspace", attentionColumns: 3 });
  });

  it("rejects illegal mode/columns", () => {
    expect(
      loadPrefs(
        memStorage({
          "cursor-watch.viewMode": "nope",
          "cursor-watch.attentionColumns": "9",
        }),
      ),
    ).toEqual({ viewMode: "attention", attentionColumns: 2 });
  });
});

describe("save*", () => {
  it("writes keys", () => {
    const s = memStorage();
    saveViewMode("workspace", s);
    saveAttentionColumns(4, s);
    expect(s._data["cursor-watch.viewMode"]).toBe("workspace");
    expect(s._data["cursor-watch.attentionColumns"]).toBe("4");
  });
});

describe("effectiveAttentionColumns", () => {
  it("forces 1 under 720px without changing stored meaning", () => {
    expect(effectiveAttentionColumns(3, 719)).toBe(1);
    expect(effectiveAttentionColumns(3, 720)).toBe(3);
  });
});
