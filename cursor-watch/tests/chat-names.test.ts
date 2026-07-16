import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadComposerChatNames,
  loadComposerHeadersMeta,
  pickSessionTitle,
} from "../src/chat-names.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function makeDb(
  rows: Array<{ composerId: string; name: string; valueExtra?: object }>,
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-chat-"));
  tmpDirs.push(dir);
  const dbPath = path.join(dir, "state.vscdb");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE composerHeaders (
      composerId TEXT PRIMARY KEY,
      workspaceId TEXT,
      value TEXT
    );
  `);
  const insert = db.prepare(
    "INSERT INTO composerHeaders (composerId, workspaceId, value) VALUES (?, ?, ?)",
  );
  for (const r of rows) {
    insert.run(
      r.composerId,
      "ws",
      JSON.stringify({ name: r.name, composerId: r.composerId, ...r.valueExtra }),
    );
  }
  db.close();
  return dbPath;
}

describe("loadComposerChatNames", () => {
  it("maps composerId to name from composerHeaders.value", () => {
    const dbPath = makeDb([
      { composerId: "aaa-111", name: "Cursors面板开发" },
      { composerId: "bbb-222", name: "缺陷分析" },
    ]);
    const map = loadComposerChatNames(dbPath);
    expect(map.get("aaa-111")).toBe("Cursors面板开发");
    expect(map.get("bbb-222")).toBe("缺陷分析");
    expect(map.has("missing")).toBe(false);
  });

  it("returns empty map when db missing or table absent", () => {
    expect(loadComposerChatNames("/no/such/state.vscdb").size).toBe(0);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-empty-"));
    tmpDirs.push(dir);
    const dbPath = path.join(dir, "empty.vscdb");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE ItemTable (key TEXT, value TEXT);");
    db.close();
    expect(loadComposerChatNames(dbPath).size).toBe(0);
  });

  it("skips rows without a usable name", () => {
    const dbPath = makeDb([
      { composerId: "ok", name: "有名字" },
      { composerId: "blank", name: "   " },
    ]);
    const map = loadComposerChatNames(dbPath);
    expect(map.get("ok")).toBe("有名字");
    expect(map.has("blank")).toBe(false);
  });
});

describe("loadComposerHeadersMeta", () => {
  it("loads unread, updatedAt, subtitle with name", () => {
    const dbPath = makeDb([
      {
        composerId: "c1",
        name: "Cursors面板开发",
        valueExtra: {
          hasUnreadMessages: true,
          lastUpdatedAt: 99,
          subtitle: "Edited a.ts",
        },
      },
    ]);
    const meta = loadComposerHeadersMeta(dbPath).get("c1");
    expect(meta?.chatName).toBe("Cursors面板开发");
    expect(meta?.hasUnread).toBe(true);
    expect(meta?.composerUpdatedAt).toBe(99);
    expect(meta?.subtitle).toBe("Edited a.ts");
  });
});

describe("pickSessionTitle", () => {
  it("prefers chat name over transcript summary", () => {
    expect(pickSessionTitle("Cursors面板开发", "安装 grill-me …")).toBe(
      "Cursors面板开发",
    );
  });

  it("falls back to summary when chat name missing", () => {
    expect(pickSessionTitle(undefined, "首条用户消息")).toBe("首条用户消息");
    expect(pickSessionTitle("", "首条用户消息")).toBe("首条用户消息");
  });
});
