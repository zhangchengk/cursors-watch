import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prefsFile, stateDir } from "../src/constants.js";
import {
  DEFAULT_WATCH_PREFS,
  loadWatchPrefs,
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
  it("defaults notificationSound to false (silent)", () => {
    expect(DEFAULT_WATCH_PREFS).toEqual({ notificationSound: false });
  });
});

describe("watch prefs store", () => {
  it("loadWatchPrefs returns defaults when file missing", () => {
    const home = tempHome();
    expect(loadWatchPrefs(home)).toEqual({ notificationSound: false });
  });

  it("saveWatchPrefs then loadWatchPrefs round-trips", () => {
    const home = tempHome();
    saveWatchPrefs(home, { notificationSound: true });
    expect(loadWatchPrefs(home)).toEqual({ notificationSound: true });

    saveWatchPrefs(home, { notificationSound: false });
    expect(loadWatchPrefs(home)).toEqual({ notificationSound: false });
  });

  it("persists under prefsFile path", () => {
    const home = tempHome();
    saveWatchPrefs(home, { notificationSound: true });
    const raw = JSON.parse(fs.readFileSync(prefsFile(home), "utf8")) as {
      notificationSound: boolean;
    };
    expect(raw.notificationSound).toBe(true);
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
});
