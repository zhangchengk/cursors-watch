import path from "node:path";

/** Stats subset used by chokidar's `ignored` callback. */
export type WatchPathStats = { isDirectory(): boolean };

/** Ignore filter for chokidar: keep live *.json and project transcript/terminal files. */
export function shouldIgnoreWatchPath(
  filePath: string,
  opts: { projectsDir: string; liveDir: string },
  stats?: WatchPathStats,
): boolean {
  const projectsRoot = path.resolve(opts.projectsDir);
  const liveRoot = path.resolve(opts.liveDir);
  const resolved = path.resolve(filePath);

  if (resolved === projectsRoot || resolved === liveRoot) return false;

  if (resolved.startsWith(liveRoot + path.sep)) {
    if (!stats || stats.isDirectory()) return false;
    return path.extname(resolved) !== ".json";
  }

  const rel = path.relative(projectsRoot, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return true;
  const segments = rel.split(path.sep);
  // Immediate project-key directory under projectsRoot
  if (segments.length === 1) return false;

  const kind = segments[1];
  if (kind !== "agent-transcripts" && kind !== "terminals") return true;
  if (!stats || stats.isDirectory()) return false;
  if (kind === "agent-transcripts") return path.extname(resolved) !== ".jsonl";
  return path.extname(resolved) !== ".txt";
}

export type WatchPathKind =
  | {
      kind: "transcript_main";
      projectKey: string;
      sessionId: string;
      filePath: string;
    }
  | {
      kind: "transcript_subagent";
      projectKey: string;
      parentId: string;
      childId: string;
      filePath: string;
    }
  | { kind: "terminal"; projectKey: string; filePath: string }
  | { kind: "live"; conversationId: string; filePath: string }
  | { kind: "unknown" };

export function classifyWatchPath(
  filePath: string,
  opts: { projectsDir: string; liveDir: string },
): WatchPathKind {
  const resolved = path.resolve(filePath);
  const projectsDir = path.resolve(opts.projectsDir);
  const liveDir = path.resolve(opts.liveDir);

  const liveRel = path.relative(liveDir, resolved);
  if (
    liveRel &&
    !liveRel.startsWith("..") &&
    !path.isAbsolute(liveRel) &&
    path.extname(liveRel) === ".json" &&
    !liveRel.includes(path.sep)
  ) {
    return {
      kind: "live",
      conversationId: path.basename(liveRel, ".json"),
      filePath: resolved,
    };
  }

  const projectsRel = path.relative(projectsDir, resolved);
  if (
    !projectsRel ||
    projectsRel.startsWith("..") ||
    path.isAbsolute(projectsRel)
  ) {
    return { kind: "unknown" };
  }

  const segments = projectsRel.split(path.sep);

  // …/<projectKey>/terminals/<name>.txt
  if (
    segments.length === 3 &&
    segments[1] === "terminals" &&
    path.extname(segments[2]!) === ".txt"
  ) {
    return {
      kind: "terminal",
      projectKey: segments[0]!,
      filePath: resolved,
    };
  }

  // …/<projectKey>/agent-transcripts/<parentId>/subagents/<childId>.jsonl
  if (
    segments.length === 5 &&
    segments[1] === "agent-transcripts" &&
    segments[3] === "subagents" &&
    path.extname(segments[4]!) === ".jsonl"
  ) {
    return {
      kind: "transcript_subagent",
      projectKey: segments[0]!,
      parentId: segments[2]!,
      childId: path.basename(segments[4]!, ".jsonl"),
      filePath: resolved,
    };
  }

  // …/<projectKey>/agent-transcripts/<sessionId>/<sessionId>.jsonl
  if (
    segments.length === 4 &&
    segments[1] === "agent-transcripts" &&
    path.extname(segments[3]!) === ".jsonl"
  ) {
    const sessionId = segments[2]!;
    const stem = path.basename(segments[3]!, ".jsonl");
    if (stem === sessionId) {
      return {
        kind: "transcript_main",
        projectKey: segments[0]!,
        sessionId,
        filePath: resolved,
      };
    }
  }

  return { kind: "unknown" };
}
