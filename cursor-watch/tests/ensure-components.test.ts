import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach, vi } from "vitest";
import {
  ensureWatchComponents,
  resolveBundledVsix,
} from "../src/ensure-components.js";
import { installHooks, hooksStatus } from "../src/hooks-install.js";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

function tempHome(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "cw-ensure-"));
  homes.push(h);
  fs.mkdirSync(path.join(h, ".cursor"), { recursive: true });
  return h;
}

describe("resolveBundledVsix", () => {
  it("returns null when no vsix dir", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cw-vsix-"));
    homes.push(root);
    expect(resolveBundledVsix(root)).toBeNull();
  });

  it("picks latest vsix by name sort", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cw-vsix-"));
    homes.push(root);
    const dir = path.join(root, "extensions", "cursor-watch-bridge");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "cursor-watch-bridge-0.0.1.vsix"), "x");
    fs.writeFileSync(path.join(dir, "cursor-watch-bridge-0.1.0.vsix"), "y");
    expect(resolveBundledVsix(root)).toMatch(/0\.1\.0\.vsix$/);
  });
});

describe("ensureWatchComponents", () => {
  it("installs hooks when missing", async () => {
    const home = tempHome();
    expect(hooksStatus(home).installed).toBe(false);
    const status = await ensureWatchComponents({
      homeDir: home,
      bundledVsixPath: null,
      listExt: async () => [],
    });
    expect(status.hooksInstalled).toBe(true);
    expect(hooksStatus(home).installed).toBe(true);
  });

  it("installs extension when missing and vsix provided", async () => {
    const home = tempHome();
    installHooks(home);
    const installExtension = vi.fn().mockResolvedValue(undefined);
    let listed = false;
    const status = await ensureWatchComponents({
      homeDir: home,
      bundledVsixPath: "/tmp/fake.vsix",
      installExtension,
      listExt: async () => {
        if (!listed) {
          listed = true;
          return [];
        }
        return ["cursor-watch.cursor-watch-bridge@0.1.0"];
      },
    });
    expect(installExtension).toHaveBeenCalledWith("/tmp/fake.vsix");
    expect(status.extensionInstalled).toBe(true);
    expect(status.extensionVersion).toBe("0.1.0");
  });
});
