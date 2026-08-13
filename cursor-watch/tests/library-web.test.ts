import { describe, expect, it } from "vitest";
import {
  archiveEntryMatchesQuery,
  buildFolderTree,
  clearLibraryCardCompactForFolders,
  entryDisplayTitle,
  entriesInFolder,
  filterEntriesByArchiveSearch,
  folderChatCount,
  foldersForMark,
  isLibraryCardCompact,
  libraryCardCompactKey,
  normalizeArchiveSearchQuery,
  setLibraryCardCompact,
  sortLibraryEntriesForMark,
  todoPriorityRank,
} from "../src/web/library.js";

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

describe("library card compact prefs", () => {
  it("defaults compact; keys separate todo/archive and 全部 vs folder; expanded is explicit false", () => {
    const s = memStorage();
    expect(libraryCardCompactKey("todo", null)).toBe("todo:");
    expect(libraryCardCompactKey("todo", "f1")).toBe("todo:f1");
    expect(isLibraryCardCompact("todo", null, s)).toBe(true);
    expect(isLibraryCardCompact("archive", null, s)).toBe(true);

    setLibraryCardCompact("todo", null, false, s);
    setLibraryCardCompact("todo", "f1", false, s);
    expect(isLibraryCardCompact("todo", null, s)).toBe(false);
    expect(isLibraryCardCompact("todo", "f1", s)).toBe(false);
    expect(isLibraryCardCompact("archive", null, s)).toBe(true);

    setLibraryCardCompact("todo", null, true, s);
    expect(isLibraryCardCompact("todo", null, s)).toBe(true);
    expect(isLibraryCardCompact("todo", "f1", s)).toBe(false);
  });

  it("keeps legacy stored true as compact", () => {
    const s = memStorage();
    s.setItem(
      "cursor-watch.libraryCardCompact",
      JSON.stringify({ "todo:": true, "todo:f1": false }),
    );
    expect(isLibraryCardCompact("todo", null, s)).toBe(true);
    expect(isLibraryCardCompact("todo", "f1", s)).toBe(false);
  });

  it("clearLibraryCardCompactForFolders drops deleted folder keys (back to default compact)", () => {
    const s = memStorage();
    setLibraryCardCompact("todo", "gone", false, s);
    setLibraryCardCompact("todo", "keep", false, s);
    setLibraryCardCompact("todo", null, false, s);
    clearLibraryCardCompactForFolders("todo", ["gone"], s);
    expect(isLibraryCardCompact("todo", "gone", s)).toBe(true);
    expect(isLibraryCardCompact("todo", "keep", s)).toBe(false);
    expect(isLibraryCardCompact("todo", null, s)).toBe(false);
  });
});

describe("todo priority sort", () => {
  it("ranks urgent < important < none", () => {
    expect(todoPriorityRank({ priority: "urgent" })).toBe(0);
    expect(todoPriorityRank({ priority: "important" })).toBe(1);
    expect(todoPriorityRank({})).toBe(2);
  });

  it("sortLibraryEntriesForMark orders tiers and keeps stable order within", () => {
    const entries = [
      { conversationId: "n1" },
      { conversationId: "u1", priority: "urgent" },
      { conversationId: "i1", priority: "important" },
      { conversationId: "n2" },
      { conversationId: "u2", priority: "urgent" },
      { conversationId: "i2", priority: "important" },
    ];
    expect(
      sortLibraryEntriesForMark(entries, "todo").map((e) => e.conversationId),
    ).toEqual(["u1", "u2", "i1", "i2", "n1", "n2"]);
    expect(
      sortLibraryEntriesForMark(entries, "archive").map((e) => e.conversationId),
    ).toEqual(["n1", "u1", "i1", "n2", "u2", "i2"]);
  });
});

describe("archive list search", () => {
  it("matches title, chatName, note case-insensitively; blank query passes all", () => {
    expect(normalizeArchiveSearchQuery("  x  ")).toBe("x");
    const e = {
      title: "预汇总模型",
      chatName: "自定义表达式",
      note: "宣讲要点 ABC",
    };
    expect(archiveEntryMatchesQuery(e, "")).toBe(true);
    expect(archiveEntryMatchesQuery(e, "预汇总")).toBe(true);
    expect(archiveEntryMatchesQuery(e, "表达式")).toBe(true);
    expect(archiveEntryMatchesQuery(e, "abc")).toBe(true);
    expect(archiveEntryMatchesQuery(e, "找不到")).toBe(false);
  });

  it("filterEntriesByArchiveSearch keeps order of matches", () => {
    const entries = [
      { conversationId: "1", title: "alpha" },
      { conversationId: "2", note: "keep me alpha" },
      { conversationId: "3", chatName: "other" },
    ];
    expect(
      filterEntriesByArchiveSearch(entries, "ALPHA").map((e) => e.conversationId),
    ).toEqual(["1", "2"]);
    expect(filterEntriesByArchiveSearch(entries, "  ").map((e) => e.conversationId)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });
});
