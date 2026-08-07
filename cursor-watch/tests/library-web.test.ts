import { describe, expect, it } from "vitest";
import {
  buildFolderTree,
  entryDisplayTitle,
  entriesInFolder,
  folderChatCount,
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

  it("entriesInFolder null is all entries for mark (全部)", () => {
    const entries = [
      { conversationId: "1", mark: "todo", folderId: null },
      { conversationId: "2", mark: "todo", folderId: "a" },
      { conversationId: "3", mark: "archive", folderId: null },
    ];
    expect(
      entriesInFolder(entries, "todo", null).map((e) => e.conversationId).sort(),
    ).toEqual(["1", "2"]);
    expect(entriesInFolder(entries, "todo", "a").map((e) => e.conversationId)).toEqual(["2"]);
  });

  it("entriesInFolder includes descendant folders when folders provided", () => {
    const folders = [
      { id: "a", mark: "todo", parentId: null, name: "A", sortKey: 0 },
      { id: "b", mark: "todo", parentId: "a", name: "B", sortKey: 0 },
    ];
    const entries = [
      { conversationId: "in-a", mark: "todo", folderId: "a" },
      { conversationId: "in-b", mark: "todo", folderId: "b" },
      { conversationId: "other", mark: "todo", folderId: null },
    ];
    expect(
      entriesInFolder(entries, "todo", "a", folders).map((e) => e.conversationId).sort(),
    ).toEqual(["in-a", "in-b"]);
  });

  it("folderChatCount is subtree size; null is full mark count", () => {
    const folders = [
      { id: "a", mark: "todo", parentId: null, name: "A", sortKey: 0 },
      { id: "b", mark: "todo", parentId: "a", name: "B", sortKey: 0 },
      { id: "empty", mark: "todo", parentId: null, name: "E", sortKey: 1 },
    ];
    const entries = [
      { conversationId: "in-a", mark: "todo", folderId: "a" },
      { conversationId: "in-b", mark: "todo", folderId: "b" },
      { conversationId: "loose", mark: "todo", folderId: null },
      { conversationId: "arch", mark: "archive", folderId: null },
    ];
    expect(folderChatCount(entries, "todo", "a", folders)).toBe(2);
    expect(folderChatCount(entries, "todo", "b", folders)).toBe(1);
    expect(folderChatCount(entries, "todo", "empty", folders)).toBe(0);
    expect(folderChatCount(entries, "todo", null, folders)).toBe(3);
  });
});
