import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hooksStatus, installHooks } from "./hooks-install.js";

export type ComponentsStatus = {
  hooksInstalled: boolean;
  extensionInstalled: boolean;
  extensionVersion?: string;
  bundledVsixPath?: string | null;
  errors: string[];
};

const BRIDGE_EXT_ID = "cursor-watch.cursor-watch-bridge";

export function packageRoot(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function resolveBundledVsix(root = packageRoot()): string | null {
  const dir = path.join(root, "extensions", "cursor-watch-bridge");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".vsix"))
    .sort();
  if (!files.length) return null;
  return path.join(dir, files[files.length - 1]!);
}

export function hooksInstalled(home?: string): boolean {
  return hooksStatus(home).installed;
}

async function defaultInstallExtension(
  vsix: string,
  cursorBin: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cursorBin, ["--install-extension", vsix, "--force"], {
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`cursor --install-extension exited ${code}`));
    });
  });
}

async function listExtensions(cursorBin: string): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn(cursorBin, ["--list-extensions", "--show-versions"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout?.on("data", (b) => {
      out += String(b);
    });
    child.on("error", () => resolve([]));
    child.on("exit", () => {
      resolve(
        out
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
      );
    });
  });
}

function parseExtensionLine(
  lines: string[],
): { installed: boolean; version?: string } {
  const hit = lines.find((l) => l.startsWith(BRIDGE_EXT_ID));
  if (!hit) return { installed: false };
  const at = hit.lastIndexOf("@");
  if (at > 0) return { installed: true, version: hit.slice(at + 1) };
  return { installed: true };
}

export async function ensureWatchComponents(opts?: {
  homeDir?: string;
  cursorBin?: string;
  bundledVsixPath?: string | null;
  installExtension?: (vsix: string) => Promise<void>;
  listExt?: () => Promise<string[]>;
}): Promise<ComponentsStatus> {
  const errors: string[] = [];
  const homeDir = opts?.homeDir;
  let hooksOk = hooksInstalled(homeDir);
  if (!hooksOk) {
    try {
      installHooks(homeDir);
      hooksOk = hooksInstalled(homeDir);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const bundledVsixPath =
    opts?.bundledVsixPath !== undefined
      ? opts.bundledVsixPath
      : resolveBundledVsix();
  const cursorBin =
    opts?.cursorBin ??
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor";

  let extensionInstalled = false;
  let extensionVersion: string | undefined;
  try {
    const lines = opts?.listExt
      ? await opts.listExt()
      : await listExtensions(cursorBin);
    const parsed = parseExtensionLine(lines);
    extensionInstalled = parsed.installed;
    extensionVersion = parsed.version;

    const needInstall =
      Boolean(bundledVsixPath) &&
      (!extensionInstalled ||
        (extensionVersion &&
          bundledVsixPath &&
          !extensionVersion.startsWith("0.1")));

    // Install when missing; force refresh when bundled vsix exists and not installed.
    if (bundledVsixPath && !extensionInstalled) {
      const install =
        opts?.installExtension ??
        ((vsix: string) => defaultInstallExtension(vsix, cursorBin));
      await install(bundledVsixPath);
      const again = opts?.listExt
        ? await opts.listExt()
        : await listExtensions(cursorBin);
      const p2 = parseExtensionLine(again);
      extensionInstalled = p2.installed;
      extensionVersion = p2.version;
    } else if (needInstall && bundledVsixPath && opts?.installExtension) {
      // test seam for outdated upgrade path
      await opts.installExtension(bundledVsixPath);
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return {
    hooksInstalled: hooksOk,
    extensionInstalled,
    extensionVersion,
    bundledVsixPath,
    errors,
  };
}
