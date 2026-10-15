import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bumpComposerHeaderLastUpdatedAt,
  probeComposerHeader,
  readComposerHeaderLastUpdatedAt,
} from "../src/composer-headers-write.js";
import { isCursorRunning } from "../src/cursor-process.js";
import {
  listLibraryRefreshTargets,
  runLibraryHeaderRefresh,
} from "../src/library-header-refresh.js";
import { loadWatchPrefs } from "../src/prefs.js";

const tmpDirs: string[] = [];

function withDarwinPlatform(run: () => void): void {
  const orig = process.platform;
  Object.defineProperty(process, "platform", { configurable: true, value: "darwin" });
  try {
    run();
  } finally {
    Object.defineProperty(process, "platform", { configurable: true, value: orig });
  }
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function makeDb(
  rows: Array<{ composerId: string; value: Record<string, unknown> }>,
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-lhr-"));
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
    insert.run(r.composerId, "ws", JSON.stringify(r.value));
  }
  db.close();
  return dbPath;
}

describe("listLibraryRefreshTargets", () => {
  it("dedupes todo and archive conversationIds", () => {
    const targets = listLibraryRefreshTargets([
      { conversationId: "a", mark: "todo", title: "T1" },
      { conversationId: "a", mark: "archive", title: "dup" },
      { conversationId: "b", mark: "archive" },
    ]);
    expect(targets).toHaveLength(2);
    expect(targets[0]?.conversationId).toBe("a");
    expect(targets[1]?.conversationId).toBe("b");
  });
});

describe("bumpComposerHeaderLastUpdatedAt", () => {
  it("updates only lastUpdatedAt in header JSON", () => {
    const dbPath = makeDb([
      {
        composerId: "c1",
        value: { name: "Chat", lastUpdatedAt: 1, composerId: "c1" },
      },
    ]);
    const r = bumpComposerHeaderLastUpdatedAt(dbPath, "c1", 999);
    expect(r.ok).toBe(true);
    expect(readComposerHeaderLastUpdatedAt(dbPath, "c1")).toBe(999);
  });

  it("treats empty value as not ready (same as missing for refresh)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-empty-val-"));
    tmpDirs.push(dir);
    const dbPath = path.join(dir, "state.vscdb");
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, value TEXT);`);
    db.prepare("INSERT INTO composerHeaders VALUES (?, ?)").run("empty", "");
    db.close();
    expect(probeComposerHeader(dbPath, "empty").status).toBe("empty_value");
  });

  it("returns error for invalid JSON without throwing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-bad-json-"));
    tmpDirs.push(dir);
    const dbPath = path.join(dir, "state.vscdb");
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, value TEXT);`);
    db.prepare("INSERT INTO composerHeaders VALUES (?, ?)").run("x", "{not-json");
    db.close();
    const r = bumpComposerHeaderLastUpdatedAt(dbPath, "x", 1);
    expect(r.ok).toBe(false);
  });
});

describe("runLibraryHeaderRefresh", () => {
  it("dryRun counts headers without writing", () => {
    const dbPath = makeDb([
      { composerId: "h1", value: { name: "A", lastUpdatedAt: 1 } },
    ]);
    const before = fs.readFileSync(dbPath);
    const result = runLibraryHeaderRefresh({
      home: os.tmpdir(),
      dbPath,
      dryRun: true,
      entries: [
        { conversationId: "h1", mark: "todo", title: "A" },
        { conversationId: "missing", mark: "archive" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dryRun).toBe(true);
    expect(result.refreshed).toBe(1);
    expect(result.skippedNoHeader).toBe(1);
    expect(result.failed).toBe(0);
    expect(fs.readFileSync(dbPath).equals(before)).toBe(true);
    expect(readComposerHeaderLastUpdatedAt(dbPath, "h1")).toBe(1);
  });

  it("apply bumps all header rows with same batchTs", () => {
    withDarwinPlatform(() => {
      const dbPath = makeDb([
        { composerId: "a", value: { name: "A", lastUpdatedAt: 1 } },
        { composerId: "b", value: { name: "B", lastUpdatedAt: 2 } },
      ]);
      const ts = 1_700_000_000_000;
      const result = runLibraryHeaderRefresh({
        home: os.tmpdir(),
        dbPath,
        dryRun: false,
        batchTs: ts,
        checkCursorRunning: () => false,
        entries: [
          { conversationId: "a", mark: "todo" },
          { conversationId: "b", mark: "archive" },
          { conversationId: "no-row", mark: "todo" },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.refreshed).toBe(2);
      expect(result.skippedNoHeader).toBe(1);
      expect(readComposerHeaderLastUpdatedAt(dbPath, "a")).toBe(ts);
      expect(readComposerHeaderLastUpdatedAt(dbPath, "b")).toBe(ts);
    });
  });

  it("returns 409 when Cursor appears running on apply", () => {
    withDarwinPlatform(() => {
      const result = runLibraryHeaderRefresh({
        home: os.tmpdir(),
        dbPath: makeDb([]),
        dryRun: false,
        checkCursorRunning: () => true,
        entries: [{ conversationId: "x", mark: "todo" }],
      });
      expect(result).toEqual({
        ok: false,
        statusCode: 409,
        error: "quit Cursor completely before refreshing composer headers",
      });
    });
  });

  it("dryRun and apply agree on empty value header row", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-empty-val-"));
    tmpDirs.push(dir);
    const dbPath = path.join(dir, "state.vscdb");
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, value TEXT);`);
    db.prepare("INSERT INTO composerHeaders VALUES (?, ?)").run("empty", "   ");
    db.close();
    const entries = [{ conversationId: "empty", mark: "todo" as const }];
    const preview = runLibraryHeaderRefresh({ home: os.tmpdir(), dbPath, dryRun: true, entries });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.skippedNoHeader).toBe(1);
    expect(preview.refreshed).toBe(0);
    withDarwinPlatform(() => {
      const applied = runLibraryHeaderRefresh({
        home: os.tmpdir(),
        dbPath,
        dryRun: false,
        batchTs: 99,
        checkCursorRunning: () => false,
        entries,
      });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.skippedNoHeader).toBe(1);
      expect(applied.refreshed).toBe(0);
    });
  });

  it("reports stateDbFound false without counting skippedNoHeader when db missing (dryRun)", () => {
    const result = runLibraryHeaderRefresh({
      home: os.tmpdir(),
      dbPath: null,
      resolveDbPath: () => null,
      dryRun: true,
      entries: [
        { conversationId: "a", mark: "todo" },
        { conversationId: "b", mark: "archive" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stateDbFound).toBe(false);
    expect(result.targetCount).toBe(2);
    expect(result.skippedNoHeader).toBe(0);
    expect(result.refreshed).toBe(0);
  });

  it("apply fails when db missing", () => {
    withDarwinPlatform(() => {
      const result = runLibraryHeaderRefresh({
        home: os.tmpdir(),
        dbPath: null,
        resolveDbPath: () => null,
        dryRun: false,
        checkCursorRunning: () => false,
        entries: [{ conversationId: "a", mark: "todo" }],
      });
      expect(result).toEqual({
        ok: false,
        statusCode: 400,
        error: "Cursor state.vscdb not found",
      });
    });
  });

  it("writes prefs summary on successful apply", () => {
    withDarwinPlatform(() => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-home-"));
      tmpDirs.push(home);
      const dbPath = makeDb([{ composerId: "c", value: { name: "C", lastUpdatedAt: 0 } }]);
      const ts = 42;
      runLibraryHeaderRefresh({
        home,
        dbPath,
        dryRun: false,
        batchTs: ts,
        checkCursorRunning: () => false,
        entries: [{ conversationId: "c", mark: "todo" }],
      });
      const prefs = loadWatchPrefs(home);
      expect(prefs.libraryHeaderRefreshLast).toEqual({
        at: ts,
        refreshed: 1,
        skippedNoHeader: 0,
        failed: 0,
      });
    });
  });
});

describe("isCursorRunning", () => {
  it("ignores Cursor Watch noise in pgrep output", () => {
    const out = "12345 CursorWatch menubar\n67890 /Applications/Cursor.app/Contents/MacOS/Cursor";
    expect(isCursorRunning(() => out)).toBe(true);
  });

  it("returns false when only watch processes match", () => {
    const out = "12345 /usr/local/bin/cursor-watch daemon";
    expect(isCursorRunning(() => out)).toBe(false);
  });
});
