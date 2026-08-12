import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { libraryFile, stateDir } from "../src/constants.js";
import {
  createFolder,
  deleteEntry,
  deleteFolder,
  loadLibrary,
  patchEntry,
  upsertEntry,
  addAttachments,
  removeAttachment,
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
      priority: "urgent",
    });
    upsertEntry(home, { conversationId: "c1", mark: "archive" });
    const e = loadLibrary(home).entries[0]!;
    expect(e.mark).toBe("archive");
    expect(e.folderId).toBeNull();
    expect(e.title).toBe("T");
    expect(e.note).toBe("N");
    expect(e.priority).toBeUndefined();
  });

  it("todo priority set/clear; discarded on archive and restored none on back", () => {
    const home = tempHome();
    upsertEntry(home, { conversationId: "c1", mark: "todo", priority: "important" });
    expect(loadLibrary(home).entries[0]?.priority).toBe("important");
    patchEntry(home, "c1", { priority: "urgent" });
    expect(loadLibrary(home).entries[0]?.priority).toBe("urgent");
    patchEntry(home, "c1", { priority: "none" });
    expect(loadLibrary(home).entries[0]?.priority).toBeUndefined();
    patchEntry(home, "c1", { priority: "urgent" });
    patchEntry(home, "c1", { mark: "archive" });
    expect(loadLibrary(home).entries[0]?.priority).toBeUndefined();
    patchEntry(home, "c1", { mark: "todo" });
    expect(loadLibrary(home).entries[0]?.priority).toBeUndefined();
  });

  it("loadLibrary strips priority from archive rows", () => {
    const home = tempHome();
    fs.mkdirSync(stateDir(home), { recursive: true });
    fs.writeFileSync(
      libraryFile(home),
      `${JSON.stringify({
        version: 1,
        folders: [],
        entries: [
          {
            conversationId: "c1",
            mark: "archive",
            folderId: null,
            priority: "urgent",
            updatedAt: Date.now(),
          },
        ],
      })}\n`,
    );
    expect(loadLibrary(home).entries[0]?.priority).toBeUndefined();
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

describe("library attachments", () => {
  it("addAttachments stores ordered unique absolute md paths", () => {
    const home = tempHome();
    const dir = path.join(home, "docs");
    fs.mkdirSync(dir);
    const a = path.join(dir, "a.md");
    const b = path.join(dir, "b.md");
    fs.writeFileSync(a, "# A\n");
    fs.writeFileSync(b, "# B\n");
    upsertEntry(home, { conversationId: "c1", mark: "todo" });
    const r1 = addAttachments(home, "c1", [a, b, a]);
    expect(r1.entry.attachments).toEqual([a, b]);
    expect(r1.rejected).toEqual([]);
  });

  it("addAttachments rejects missing and non-md", () => {
    const home = tempHome();
    const dir = path.join(home, "docs");
    fs.mkdirSync(dir);
    const ok = path.join(dir, "ok.md");
    const txt = path.join(dir, "x.txt");
    fs.writeFileSync(ok, "x");
    fs.writeFileSync(txt, "x");
    upsertEntry(home, { conversationId: "c1", mark: "todo" });
    const r = addAttachments(home, "c1", [ok, txt, path.join(dir, "missing.md")]);
    expect(r.entry.attachments).toEqual([ok]);
    expect(r.rejected.map((x) => x.path).sort()).toEqual(
      [txt, path.join(dir, "missing.md")].sort(),
    );
  });

  it("mark change keeps attachments; deleteEntry drops them", () => {
    const home = tempHome();
    const md = path.join(home, "n.md");
    fs.writeFileSync(md, "n");
    upsertEntry(home, { conversationId: "c1", mark: "todo" });
    addAttachments(home, "c1", [md]);
    upsertEntry(home, { conversationId: "c1", mark: "archive" });
    expect(loadLibrary(home).entries[0]!.attachments).toEqual([md]);
    expect(removeAttachment(home, "c1", md)?.attachments ?? []).toEqual([]);
    addAttachments(home, "c1", [md]);
    expect(deleteEntry(home, "c1")).toBe(true);
    expect(loadLibrary(home).entries).toEqual([]);
  });
});
