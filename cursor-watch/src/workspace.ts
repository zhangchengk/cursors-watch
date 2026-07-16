import fs from "node:fs";
import path from "node:path";
import { DECODE_MAX_DEPTH } from "./constants.js";

export function encodeWorkspacePath(absPath: string): string {
  const normalized = path.resolve(absPath);
  return normalized.replace(/^\//, "").replace(/\//g, "-");
}

export function shortenLabel(absPath: string, homeDir: string): string {
  if (!absPath) return "";
  const home = path.resolve(homeDir);
  const abs = path.resolve(absPath);
  if (abs === home) return "~";
  const prefix = home.endsWith(path.sep) ? home : home + path.sep;
  if (abs.startsWith(prefix)) return abs.slice(prefix.length);
  return abs;
}

export function decodeProjectKey(
  projectKey: string,
  homeDir: string,
  existsFn: (p: string) => boolean = (p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  listDirsFn: (p: string) => string[] = (p) => {
    try {
      return fs
        .readdirSync(p, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return [];
    }
  },
): string | null {
  if (/^\d+$/.test(projectKey)) return null;

  const home = path.resolve(homeDir);
  const homeDepth = home.split(path.sep).filter(Boolean).length;
  const queue: string[] = [home];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);

    if (encodeWorkspacePath(cur) === projectKey) return cur;

    const depth = cur.split(path.sep).filter(Boolean).length;
    if (depth - homeDepth >= DECODE_MAX_DEPTH) continue;
    if (!existsFn(cur)) continue;

    for (const name of listDirsFn(cur)) {
      if (name === "node_modules" || name === ".git") continue;
      queue.push(path.join(cur, name));
    }
  }
  return null;
}

export function resolveWorkspace(
  projectKey: string,
  homeDir: string,
): { workspacePath: string; workspaceLabel: string } {
  const decoded = decodeProjectKey(projectKey, homeDir);
  if (decoded) {
    return {
      workspacePath: decoded,
      workspaceLabel: shortenLabel(decoded, homeDir),
    };
  }
  return { workspacePath: "", workspaceLabel: projectKey };
}
