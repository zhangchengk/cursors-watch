import { describe, expect, it } from "vitest";
import {
  isAgeBatchDeleteCommand,
  listDeleteInterestingCommands,
  preferredDeleteCommands,
} from "../extensions/cursor-watch-bridge/src/delete-probe.js";

describe("isAgeBatchDeleteCommand", () => {
  it("flags developer.deleteOldChats", () => {
    expect(isAgeBatchDeleteCommand("developer.deleteOldChats")).toBe(true);
  });

  it("does not flag per-id shaped commands", () => {
    expect(isAgeBatchDeleteCommand("composer.deleteComposer")).toBe(false);
  });
});

describe("listDeleteInterestingCommands", () => {
  it("keeps delete/remove/purge/composer-ish ids and drops noise", () => {
    expect(
      listDeleteInterestingCommands([
        "composer.deleteComposer",
        "developer.deleteOldChats",
        "workbench.action.files.deleteFile",
        "notebook.cell.delete",
        "composer.openComposer",
        "zzz.unrelated",
      ]),
    ).toEqual([
      "composer.deleteComposer",
      "composer.openComposer",
      "developer.deleteOldChats",
    ]);
  });
});

describe("preferredDeleteCommands", () => {
  it("prefers hardcoded delete-composer then dump per-id shapes; excludes age-batch", () => {
    expect(
      preferredDeleteCommands([
        "developer.deleteOldChats",
        "composer.openComposer",
        "composer.deleteComposer",
        "agents.deleteComposer",
      ]),
    ).toEqual([
      "delete-composer",
      "composer.deleteComposer",
      "agents.deleteComposer",
    ]);
  });

  it("still returns hardcoded delete-composer when dump has no per-id deletes", () => {
    expect(
      preferredDeleteCommands(["developer.deleteOldChats", "composer.openComposer"]),
    ).toEqual(["delete-composer"]);
  });
});
