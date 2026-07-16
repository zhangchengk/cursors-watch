import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildLiveSnapshotFromHook,
  readLiveMap,
} from "../src/live-store.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("buildLiveSnapshotFromHook", () => {
  it("clears stoppedAt on preToolUse and sets it on stop", () => {
    const a = buildLiveSnapshotFromHook({
      conversationId: "c1",
      event: "preToolUse",
      hint: "Shell: x",
      now: 1000,
    });
    expect(a.stoppedAt).toBeNull();
    expect(a.lastLiveAt).toBe(1000);
    const b = buildLiveSnapshotFromHook({
      conversationId: "c1",
      event: "stop",
      now: 2000,
      prev: a,
    });
    expect(b.stoppedAt).toBe(2000);
    expect(b.lastEvent).toBe("stop");
  });
});

describe("readLiveMap", () => {
  it("reads valid snapshots by conversationId", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-live-"));
    dirs.push(dir);
    const body = buildLiveSnapshotFromHook({
      conversationId: "abc",
      event: "afterAgentResponse",
      hint: "hi",
      now: 42,
    });
    fs.writeFileSync(path.join(dir, "abc.json"), JSON.stringify(body));
    fs.writeFileSync(path.join(dir, "bad.json"), "{");
    const map = readLiveMap(dir);
    expect(map.get("abc")?.liveHint).toBe("hi");
    expect(map.has("bad")).toBe(false);
  });
});
