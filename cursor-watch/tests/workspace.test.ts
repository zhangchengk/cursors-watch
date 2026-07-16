import { describe, expect, it } from "vitest";
import {
  decodeProjectKey,
  encodeWorkspacePath,
  shortenLabel,
} from "../src/workspace.js";

describe("encodeWorkspacePath", () => {
  it("encodes absolute path the Cursor way", () => {
    expect(encodeWorkspacePath("/Users/zhangcheng/idea/Cursors")).toBe(
      "Users-zhangcheng-idea-Cursors",
    );
    expect(encodeWorkspacePath("/Users/zhangcheng/idea/datad-2026/datad")).toBe(
      "Users-zhangcheng-idea-datad-2026-datad",
    );
  });
});

describe("shortenLabel", () => {
  it("strips home prefix", () => {
    expect(
      shortenLabel("/Users/zhangcheng/idea/datad-2026/datad", "/Users/zhangcheng"),
    ).toBe("idea/datad-2026/datad");
  });

  it("falls back to abs path when outside home", () => {
    expect(shortenLabel("/tmp/x", "/Users/zhangcheng")).toBe("/tmp/x");
  });
});

describe("decodeProjectKey", () => {
  it("finds path by encode match via injected fs", () => {
    const home = "/Users/zhangcheng";
    const dirs: Record<string, string[]> = {
      "/Users/zhangcheng": ["idea"],
      "/Users/zhangcheng/idea": ["datad-2026", "Cursors"],
      "/Users/zhangcheng/idea/datad-2026": ["datad"],
      "/Users/zhangcheng/idea/datad-2026/datad": [],
      "/Users/zhangcheng/idea/Cursors": [],
    };
    const exists = (p: string) => p in dirs || p === home;
    const listDirs = (p: string) => dirs[p] ?? [];
    expect(
      decodeProjectKey(
        "Users-zhangcheng-idea-datad-2026-datad",
        home,
        exists,
        listDirs,
      ),
    ).toBe("/Users/zhangcheng/idea/datad-2026/datad");
  });

  it("returns null for numeric project keys", () => {
    expect(decodeProjectKey("1779083085308", "/Users/zhangcheng")).toBeNull();
  });
});
