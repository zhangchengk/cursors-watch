import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { libraryFile } from "../src/constants.js";
import {
  createFolder,
  deleteEntry,
  deleteFolder,
  loadLibrary,
  patchEntry,
  upsertEntry,
} from "../src/library/store.js";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});
function tempHome(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "cw-lib-"));
  homes.push(h);
  return h;
}

describe("libraryFile", () => {
  it("is under stateDir", () => {
    expect(libraryFile("/tmp/fake-home")).toBe(
      path.join("/tmp/fake-home", ".cursor-watch", "library.json"),
    );
  });
});

describe("library store", () => {
  it("loadLibrary empty when missing", () => {
    expect(loadLibrary(tempHome())).toEqual({ version: 1, folders: [], entries: [] });
  });

  it("upsertEntry is mutually exclusive per conversationId", () => {
    const home = tempHome();
    upsertEntry(home, { conversationId: "c1", mark: "todo", title: "A" });
    upsertEntry(home, { conversationId: "c1", mark: "archive", title: "A2", note: "n" });
    const lib = loadLibrary(home);
    expect(lib.entries).toHaveLength(1);
    expect(lib.entries[0]).toMatchObject({
      conversationId: "c1",
      mark: "archive",
      title: "A2",
      note: "n",
      folderId: null,
    });
  });

  it("mark change clears folderId but keeps title/note", () => {
    const home = tempHome();
    const folder = createFolder(home, { mark: "todo", name: "Ideas" });
    upsertEntry(home, {
      conversationId: "c1",
      mark: "todo",
      folderId: folder.id,
      title: "T",
      note: "N",
    });
    upsertEntry(home, { conversationId: "c1", mark: "archive" });
    const e = loadLibrary(home).entries[0]!;
    expect(e.mark).toBe("archive");
    expect(e.folderId).toBeNull();
    expect(e.title).toBe("T");
    expect(e.note).toBe("N");
  });

  it("deleteEntry removes metadata", () => {
    const home = tempHome();
    upsertEntry(home, { conversationId: "c1", mark: "todo", title: "x" });
    expect(deleteEntry(home, "c1")).toBe(true);
    expect(loadLibrary(home).entries).toEqual([]);
  });

  it("rejects cross-mark folderId", () => {
    const home = tempHome();
    const archiveFolder = createFolder(home, { mark: "archive", name: "Talks" });
    expect(() =>
      upsertEntry(home, {
        conversationId: "c1",
        mark: "todo",
        folderId: archiveFolder.id,
      }),
    ).toThrow(/folder/i);
  });

  it("deleteFolder reparents children and entries", () => {
    const home = tempHome();
    const parent = createFolder(home, { mark: "todo", name: "P" });
    const child = createFolder(home, { mark: "todo", name: "C", parentId: parent.id });
    upsertEntry(home, {
      conversationId: "c1",
      mark: "todo",
      folderId: parent.id,
      title: "in-p",
    });
    expect(deleteFolder(home, parent.id)).toBe(true);
    const lib = loadLibrary(home);
    expect(lib.folders.find((f) => f.id === parent.id)).toBeUndefined();
    expect(lib.folders.find((f) => f.id === child.id)?.parentId).toBeNull();
    expect(lib.entries[0]?.folderId).toBeNull();
  });

  it("patchEntry can set folder within same mark", () => {
    const home = tempHome();
    const f = createFolder(home, { mark: "todo", name: "F" });
    upsertEntry(home, { conversationId: "c1", mark: "todo" });
    const e = patchEntry(home, "c1", { folderId: f.id, title: "Hi" });
    expect(e).toMatchObject({ folderId: f.id, title: "Hi", mark: "todo" });
  });
});
