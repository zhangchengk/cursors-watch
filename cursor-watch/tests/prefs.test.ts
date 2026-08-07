import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prefsFile, stateDir } from "../src/constants.js";
import {
  DEFAULT_WATCH_PREFS,
  applyWatchPrefsPatch,
  loadWatchPrefs,
  parseWorkspaceAliasesInput,
  saveWatchPrefs,
} from "../src/prefs.js";

const homes: string[] = [];

afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

function tempHome(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "cw-prefs-"));
  homes.push(h);
  return h;
}

describe("prefsFile", () => {
  it("is under stateDir", () => {
    const home = "/tmp/fake-home";
    expect(prefsFile(home)).toBe(path.join(stateDir(home), "prefs.json"));
    expect(prefsFile(home)).toBe(
      path.join(home, ".cursor-watch", "prefs.json"),
    );
  });
});

describe("DEFAULT_WATCH_PREFS", () => {
  it("defaults notificationSound, empty aliases, blueprint theme", () => {
    expect(DEFAULT_WATCH_PREFS).toEqual({
      notificationSound: false,
      workspaceAliases: {},
      uiTheme: "blueprint",
    });
  });
});

describe("watch prefs store", () => {
  it("loadWatchPrefs returns defaults when file missing", () => {
    const home = tempHome();
    expect(loadWatchPrefs(home)).toEqual({
      notificationSound: false,
      workspaceAliases: {},
      uiTheme: "blueprint",
    });
  });

  it("saveWatchPrefs then loadWatchPrefs round-trips sound, aliases, theme", () => {
    const home = tempHome();
    saveWatchPrefs(home, {
      notificationSound: true,
      workspaceAliases: { "/Users/a/proj": "Proj A" },
      uiTheme: "ink",
    });
    expect(loadWatchPrefs(home)).toEqual({
      notificationSound: true,
      workspaceAliases: { "/Users/a/proj": "Proj A" },
      uiTheme: "ink",
    });

    saveWatchPrefs(home, {
      notificationSound: false,
      workspaceAliases: {},
      uiTheme: "brass",
    });
    expect(loadWatchPrefs(home)).toEqual({
      notificationSound: false,
      workspaceAliases: {},
      uiTheme: "brass",
    });
  });

  it("missing workspaceAliases / uiTheme fields load as defaults", () => {
    const home = tempHome();
    fs.mkdirSync(stateDir(home), { recursive: true });
    fs.writeFileSync(
      prefsFile(home),
      `${JSON.stringify({ notificationSound: true })}\n`,
      "utf8",
    );
    expect(loadWatchPrefs(home)).toEqual({
      notificationSound: true,
      workspaceAliases: {},
      uiTheme: "blueprint",
    });
  });

  it("persists under prefsFile path", () => {
    const home = tempHome();
    saveWatchPrefs(home, {
      notificationSound: true,
      workspaceAliases: { "/w": "W" },
      uiTheme: "blueprint",
    });
    const raw = JSON.parse(fs.readFileSync(prefsFile(home), "utf8")) as {
      notificationSound: boolean;
      workspaceAliases: Record<string, string>;
      uiTheme: string;
    };
    expect(raw.notificationSound).toBe(true);
    expect(raw.workspaceAliases).toEqual({ "/w": "W" });
    expect(raw.uiTheme).toBe("blueprint");
  });

  it("returns defaults on corrupt JSON", () => {
    const home = tempHome();
    fs.mkdirSync(stateDir(home), { recursive: true });
    fs.writeFileSync(prefsFile(home), "{not-json", "utf8");
    expect(loadWatchPrefs(home)).toEqual(DEFAULT_WATCH_PREFS);
  });

  it("returns defaults when notificationSound is not boolean", () => {
    const home = tempHome();
    fs.mkdirSync(stateDir(home), { recursive: true });
    fs.writeFileSync(
      prefsFile(home),
      `${JSON.stringify({ notificationSound: "yes" })}\n`,
      "utf8",
    );
    expect(loadWatchPrefs(home)).toEqual(DEFAULT_WATCH_PREFS);
  });

  it("unknown uiTheme coerces to blueprint on load", () => {
    const home = tempHome();
    fs.mkdirSync(stateDir(home), { recursive: true });
    fs.writeFileSync(
      prefsFile(home),
      `${JSON.stringify({
        notificationSound: false,
        workspaceAliases: {},
        uiTheme: "neon",
      })}\n`,
      "utf8",
    );
    expect(loadWatchPrefs(home).uiTheme).toBe("blueprint");
  });
});

describe("parseWorkspaceAliasesInput", () => {
  it("rejects empty nickname values", () => {
    const r = parseWorkspaceAliasesInput({ "/a": "  " });
    expect(r.ok).toBe(false);
  });

  it("accepts trimmed nicknames", () => {
    const r = parseWorkspaceAliasesInput({ "/a": "  Nick  " });
    expect(r).toEqual({ ok: true, aliases: { "/a": "Nick" } });
  });
});

describe("applyWatchPrefsPatch", () => {
  const base = {
    notificationSound: false,
    workspaceAliases: { "/old": "Old" },
    uiTheme: "phosphor" as const,
  };

  it("merges sound only without wiping aliases or theme", () => {
    const r = applyWatchPrefsPatch(base, { notificationSound: true });
    expect(r).toEqual({
      ok: true,
      prefs: {
        notificationSound: true,
        workspaceAliases: { "/old": "Old" },
        uiTheme: "phosphor",
      },
    });
  });

  it("replaces aliases map wholesale when provided", () => {
    const r = applyWatchPrefsPatch(base, {
      workspaceAliases: { "/new": "New" },
    });
    expect(r).toEqual({
      ok: true,
      prefs: {
        notificationSound: false,
        workspaceAliases: { "/new": "New" },
        uiTheme: "phosphor",
      },
    });
  });

  it("patches uiTheme alone", () => {
    const r = applyWatchPrefsPatch(base, { uiTheme: "ink" });
    expect(r).toEqual({
      ok: true,
      prefs: {
        notificationSound: false,
        workspaceAliases: { "/old": "Old" },
        uiTheme: "ink",
      },
    });
  });

  it("rejects invalid uiTheme", () => {
    const r = applyWatchPrefsPatch(base, { uiTheme: "neon" });
    expect(r.ok).toBe(false);
  });

  it("rejects empty alias values", () => {
    const r = applyWatchPrefsPatch(base, {
      workspaceAliases: { "/old": "" },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects empty body", () => {
    expect(applyWatchPrefsPatch(base, {}).ok).toBe(false);
  });
});
