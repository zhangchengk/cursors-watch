import { describe, expect, it } from "vitest";
import {
  collectKnownWorkspacePaths,
  displayWorkspacePlace,
} from "../src/web/workspace-display.js";

describe("displayWorkspacePlace", () => {
  it("uses exact-match alias when present", () => {
    expect(
      displayWorkspacePlace("/Users/a/Cursors", "idea/Cursors", {
        "/Users/a/Cursors": "本仓",
      }),
    ).toEqual({ text: "本仓", titlePath: "/Users/a/Cursors" });
  });

  it("falls back to absolute path when no alias", () => {
    expect(displayWorkspacePlace("/Users/a/Cursors", "idea/Cursors", {})).toEqual({
      text: "/Users/a/Cursors",
      titlePath: "/Users/a/Cursors",
    });
  });

  it("does not inherit parent path alias", () => {
    expect(
      displayWorkspacePlace("/Users/a/Cursors/sub", "sub", {
        "/Users/a/Cursors": "本仓",
      }),
    ).toEqual({
      text: "/Users/a/Cursors/sub",
      titlePath: "/Users/a/Cursors/sub",
    });
  });

  it("falls back to label then em dash when no path", () => {
    expect(displayWorkspacePlace("", "idea/x", {})).toEqual({
      text: "idea/x",
      titlePath: "idea/x",
    });
    expect(displayWorkspacePlace(undefined, undefined, {})).toEqual({
      text: "—",
      titlePath: "",
    });
  });
});

describe("collectKnownWorkspacePaths", () => {
  it("unions sessions, reminders, library, and alias keys", () => {
    expect(
      collectKnownWorkspacePaths({
        sessions: [{ workspacePath: "/a" }, { workspacePath: "" }],
        reminders: [{ workspacePath: "/b" }],
        libraryEntries: [{ workspacePath: "/a" }, { workspacePath: "/c" }],
        aliases: { "/orphan": "O", "/b": "B" },
      }),
    ).toEqual(["/a", "/b", "/c", "/orphan"]);
  });
});
