import { describe, expect, it, vi } from "vitest";
import type { ComposerHeaderMeta } from "../src/chat-names.js";
import { ScanCaches } from "../src/scan-caches.js";
import type { WorkspaceIndex } from "../src/workspace.js";

function meta(partial: Partial<ComposerHeaderMeta> = {}): ComposerHeaderMeta {
  return { hasUnread: false, ...partial };
}

describe("ScanCaches headers", () => {
  it("returns empty map when home has no composer db", () => {
    const caches = new ScanCaches("/tmp/cw-scan-caches-no-db");
    expect(caches.getHeaders().size).toBe(0);
    expect(caches.getHeader("missing")).toBeUndefined();
  });

  it("loads headers once while db mtime is unchanged, reloads when mtime increases", () => {
    let mtime = 1000;
    let loadCount = 0;
    const maps = [
      new Map([["a", meta({ chatName: "first" })]]),
      new Map([["a", meta({ chatName: "second" })]]),
    ];

    const caches = new ScanCaches("/fake-home", {
      dbMtimeMs: () => mtime,
      loadHeaders: () => {
        const map = maps[loadCount] ?? maps[maps.length - 1]!;
        loadCount += 1;
        return map;
      },
    });

    expect(caches.getHeaders().get("a")?.chatName).toBe("first");
    expect(caches.getHeader("a")?.chatName).toBe("first");
    expect(loadCount).toBe(1);

    expect(caches.getHeaders().get("a")?.chatName).toBe("first");
    expect(loadCount).toBe(1);

    mtime = 2000;
    expect(caches.getHeaders().get("a")?.chatName).toBe("second");
    expect(loadCount).toBe(2);
  });
});

describe("ScanCaches workspace index", () => {
  it("resolves from cached index and rebuilds once on miss", () => {
    const buildIndex = vi.fn((): WorkspaceIndex => {
      if (buildIndex.mock.calls.length <= 1) {
        return new Map();
      }
      return new Map([
        ["Users-me-proj", "/Users/me/proj"],
      ]);
    });

    const caches = new ScanCaches("/Users/me", { buildIndex });

    // First resolve: empty index miss → rebuild → hit
    const hit = caches.resolveWorkspace("Users-me-proj");
    expect(hit).toEqual({
      workspacePath: "/Users/me/proj",
      workspaceLabel: "proj",
    });
    expect(buildIndex).toHaveBeenCalledTimes(2);

    // Cached index hit — no extra rebuild
    const again = caches.resolveWorkspace("Users-me-proj");
    expect(again.workspacePath).toBe("/Users/me/proj");
    expect(buildIndex).toHaveBeenCalledTimes(2);
  });

  it("rebuildWorkspaceIndex replaces the held index", () => {
    let generation = 0;
    const caches = new ScanCaches("/Users/me", {
      buildIndex: () => {
        generation += 1;
        return new Map([
          [
            "Users-me-proj",
            generation === 1 ? "/Users/me/old" : "/Users/me/proj",
          ],
        ]);
      },
    });

    caches.rebuildWorkspaceIndex();
    expect(caches.resolveWorkspace("Users-me-proj").workspacePath).toBe(
      "/Users/me/old",
    );
    caches.rebuildWorkspaceIndex();
    expect(caches.resolveWorkspace("Users-me-proj").workspacePath).toBe(
      "/Users/me/proj",
    );
  });
});
