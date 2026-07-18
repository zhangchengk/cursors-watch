import fs from "node:fs";
import path from "node:path";
import { DECODE_MAX_DEPTH } from "./constants.js";

export type WorkspaceIndex = Map<string, string>;

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

/** One BFS under home → encode(path) → absPath. Use for batch resolve. */
export function buildWorkspaceIndex(
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
): WorkspaceIndex {
  const home = path.resolve(homeDir);
  const homeDepth = home.split(path.sep).filter(Boolean).length;
  const index: WorkspaceIndex = new Map();
  const queue: string[] = [home];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    index.set(encodeWorkspacePath(cur), cur);

    const depth = cur.split(path.sep).filter(Boolean).length;
    if (depth - homeDepth >= DECODE_MAX_DEPTH) continue;
    if (!existsFn(cur)) continue;

    for (const name of listDirsFn(cur)) {
      if (name === "node_modules" || name === ".git") continue;
      queue.push(path.join(cur, name));
    }
  }
  return index;
}

export function decodeProjectKey(
  projectKey: string,
  homeDir: string,
  existsFn?: (p: string) => boolean,
  listDirsFn?: (p: string) => string[],
  index?: WorkspaceIndex,
): string | null {
  if (/^\d+$/.test(projectKey)) return null;
  if (index) return index.get(projectKey) ?? null;

  const resolvedExists =
    existsFn ??
    ((p: string) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
  const resolvedList =
    listDirsFn ??
    ((p: string) => {
      try {
        return fs
          .readdirSync(p, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
      } catch {
        return [];
      }
    });

  return buildWorkspaceIndex(homeDir, resolvedExists, resolvedList).get(projectKey) ?? null;
}

export function resolveWorkspace(
  projectKey: string,
  homeDir: string,
  index?: WorkspaceIndex,
): { workspacePath: string; workspaceLabel: string } {
  const decoded = index
    ? /^\d+$/.test(projectKey)
      ? null
      : (index.get(projectKey) ?? null)
    : decodeProjectKey(projectKey, homeDir);
  if (decoded) {
    return {
      workspacePath: decoded,
      workspaceLabel: shortenLabel(decoded, homeDir),
    };
  }
  return { workspacePath: "", workspaceLabel: projectKey };
}
