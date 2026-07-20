import fs from "node:fs";
import path from "node:path";
import { aggregateSessions, workspaceDirExists } from "./aggregator.js";
import { liveDir, SCAN_LOOKBACK_MS } from "./constants.js";
import {
  buildState,
  collectMirroredSubagentIds,
  readProjectShellFlags,
} from "./scanner.js";
import type { ScanCaches } from "./scan-caches.js";
import { mergeSessionExtras, type LiveSnapshot } from "./live-state.js";
import { parseLiveSnapshot } from "./live-store.js";
import type { SessionState } from "./types.js";

export { readProjectShellFlags } from "./scanner.js";

function readLiveSnap(
  homeDir: string,
  conversationId: string,
): LiveSnapshot | undefined {
  const file = path.join(liveDir(homeDir), `${conversationId}.json`);
  try {
    const snap = parseLiveSnapshot(
      JSON.parse(fs.readFileSync(file, "utf8")) as unknown,
    );
    return snap ?? undefined;
  } catch {
    return undefined;
  }
}

export function rescanParentSession(opts: {
  projectsDir: string;
  homeDir: string;
  projectKey: string;
  sessionId: string;
  caches: ScanCaches;
  now?: number;
  workspaceExists?: (workspacePath: string) => boolean;
}): SessionState | null {
  const now = opts.now ?? Date.now();
  const workspaceExists = opts.workspaceExists ?? workspaceDirExists;
  const projectPath = path.join(opts.projectsDir, opts.projectKey);
  const transcriptsRoot = path.join(projectPath, "agent-transcripts");
  if (!fs.existsSync(transcriptsRoot)) return null;

  let sessionIds: string[];
  try {
    sessionIds = fs.readdirSync(transcriptsRoot);
  } catch {
    return null;
  }

  const mirrored = collectMirroredSubagentIds(transcriptsRoot, sessionIds);
  if (mirrored.has(opts.sessionId)) return null;

  const mainFile = path.join(
    transcriptsRoot,
    opts.sessionId,
    `${opts.sessionId}.jsonl`,
  );
  if (!fs.existsSync(mainFile)) return null;

  const { workspacePath, workspaceLabel } = opts.caches.resolveWorkspace(
    opts.projectKey,
  );
  const { shellRunning, shellExitCode } = readProjectShellFlags(
    projectPath,
    now,
  );

  const raw: SessionState[] = [];
  const parent = buildState({
    file: mainFile,
    projectKey: opts.projectKey,
    workspacePath,
    workspaceLabel,
    now,
    shellRunning,
    shellExitCode,
  });
  raw.push(
    mergeSessionExtras(
      parent,
      opts.caches.getHeader(parent.id),
      readLiveSnap(opts.homeDir, parent.id),
      now,
    ),
  );

  const mtimeCutoff = now - SCAN_LOOKBACK_MS;
  const subDir = path.join(transcriptsRoot, opts.sessionId, "subagents");
  if (fs.existsSync(subDir)) {
    for (const name of fs.readdirSync(subDir)) {
      if (!name.endsWith(".jsonl")) continue;
      const subFile = path.join(subDir, name);
      try {
        if (fs.statSync(subFile).mtimeMs < mtimeCutoff) continue;
      } catch {
        continue;
      }
      raw.push(
        buildState({
          file: subFile,
          projectKey: opts.projectKey,
          workspacePath,
          workspaceLabel,
          now,
          shellRunning: false,
          shellExitCode: null,
          parentId: opts.sessionId,
        }),
      );
    }
  }

  const aggregated = aggregateSessions(raw, now, workspaceExists);
  return aggregated.find((s) => s.id === opts.sessionId) ?? null;
}
