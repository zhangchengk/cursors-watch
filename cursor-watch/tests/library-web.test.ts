import { describe, expect, it } from "vitest";
import {
  buildFolderTree,
  entryDisplayTitle,
  entriesInFolder,
  foldersForMark,
} from "../src/web/library.js";

describe("library web helpers", () => {
  it("entryDisplayTitle prefers title then chatName", () => {
    expect(entryDisplayTitle({ conversationId: "c", title: "T", chatName: "N" })).toBe("T");
    expect(entryDisplayTitle({ conversationId: "c", chatName: "N" })).toBe("N");
    expect(entryDisplayTitle({ conversationId: "c" })).toBe("c");
  });

  it("buildFolderTree nests by parentId", () => {
    const folders = [
      { id: "a", mark: "todo", parentId: null, name: "A", sortKey: 0 },
      { id: "b", mark: "todo", parentId: "a", name: "B", sortKey: 0 },
    ];
    const tree = buildFolderTree(foldersForMark(folders, "todo"));
    expect(tree).toHaveLength(1);
    expect(tree[0].folder.id).toBe("a");
    expect(tree[0].children[0].folder.id).toBe("b");
  });

  it("entriesInFolder filters unfiled", () => {
    const entries = [
      { conversationId: "1", mark: "todo", folderId: null },
      { conversationId: "2", mark: "todo", folderId: "a" },
      { conversationId: "3", mark: "archive", folderId: null },
    ];
    expect(entriesInFolder(entries, "todo", null).map((e) => e.conversationId)).toEqual(["1"]);
    expect(entriesInFolder(entries, "todo", "a").map((e) => e.conversationId)).toEqual(["2"]);
  });
});
