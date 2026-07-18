import fs from "node:fs";
import path from "node:path";
import { aggregateSessions } from "./aggregator.js";
import { loadComposerHeadersMetaFromHome } from "./chat-names.js";
import { liveDir, SCAN_LOOKBACK_MS } from "./constants.js";
import { inferSessionFields } from "./infer/status.js";
import { mergeSessionExtras } from "./live-state.js";
import { readLiveMap } from "./live-store.js";
import { parseTranscriptFile } from "./parser/transcript.js";
import { parseTerminalMeta } from "./terminals.js";
import type { SessionState } from "./types.js";
import { buildWorkspaceIndex, resolveWorkspace } from "./workspace.js";

export function scanProjects(
  projectsDir: string,
  homeDir: string,
  now = Date.now(),
): SessionState[] {
  const raw: SessionState[] = [];
  if (!fs.existsSync(projectsDir)) return [];

  const headers = loadComposerHeadersMetaFromHome(homeDir);
  const lives = readLiveMap(liveDir(homeDir));
  const index = buildWorkspaceIndex(homeDir);
  const mtimeCutoff = now - SCAN_LOOKBACK_MS;

  for (const projectKey of fs.readdirSync(projectsDir)) {
    const projectPath = path.join(projectsDir, projectKey);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    const transcriptsRoot = path.join(projectPath, "agent-transcripts");
    if (!fs.existsSync(transcriptsRoot)) continue;

    const sessionIds = fs.readdirSync(transcriptsRoot);
    // Cursor mirrors many subagents as top-level transcript folders; those ids
    // also appear under <parent>/subagents/<id>.jsonl — never treat as parents.
    const mirroredSubagentIds = collectMirroredSubagentIds(
      transcriptsRoot,
      sessionIds,
    );
    const recentSessionFiles: Array<{
      sessionId: string;
      mainFile: string;
      mtimeMs: number;
    }> = [];

    for (const sessionId of sessionIds) {
      if (mirroredSubagentIds.has(sessionId)) continue;
      const sessionDir = path.join(transcriptsRoot, sessionId);
      let st: fs.Stats;
      try {
        st = fs.statSync(sessionDir);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      const mainFile = path.join(sessionDir, `${sessionId}.jsonl`);
      try {
        const mtimeMs = fs.statSync(mainFile).mtimeMs;
        if (mtimeMs >= mtimeCutoff) {
          recentSessionFiles.push({ sessionId, mainFile, mtimeMs });
        }
      } catch {
        /* missing main jsonl */
      }
    }

    if (recentSessionFiles.length === 0) continue;

    const { workspacePath, workspaceLabel } = resolveWorkspace(
      projectKey,
      homeDir,
      index,
    );

    let shellRunning = false;
    let shellExitCode: number | null = null;
    const termDir = path.join(projectPath, "terminals");
    if (fs.existsSync(termDir)) {
      for (const name of fs.readdirSync(termDir)) {
        if (!name.endsWith(".txt")) continue;
        try {
          const termPath = path.join(termDir, name);
          if (fs.statSync(termPath).mtimeMs < mtimeCutoff) continue;
          const meta = parseTerminalMeta(fs.readFileSync(termPath, "utf8"));
          if (meta.running) shellRunning = true;
          if (meta.exitCode !== null && meta.exitCode !== 0) {
            shellExitCode = meta.exitCode;
          }
        } catch {
          /* ignore bad terminal files */
        }
      }
    }

    for (const { sessionId, mainFile } of recentSessionFiles) {
      const parent = buildState({
        file: mainFile,
        projectKey,
        workspacePath,
        workspaceLabel,
        now,
        shellRunning,
        shellExitCode,
      });
      raw.push(
        mergeSessionExtras(
          parent,
          headers.get(parent.id),
          lives.get(parent.id),
          now,
        ),
      );
      const subDir = path.join(transcriptsRoot, sessionId, "subagents");
      if (!fs.existsSync(subDir)) continue;
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
            projectKey,
            workspacePath,
            workspaceLabel,
            now,
            shellRunning: false,
            shellExitCode: null,
            parentId: sessionId,
          }),
        );
      }
    }
  }

  return aggregateSessions(raw, now);
}

function collectMirroredSubagentIds(
  transcriptsRoot: string,
  sessionIds: string[],
): Set<string> {
  const ids = new Set<string>();
  for (const sessionId of sessionIds) {
    const subDir = path.join(transcriptsRoot, sessionId, "subagents");
    let names: string[];
    try {
      names = fs.readdirSync(subDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      ids.add(name.slice(0, -".jsonl".length));
    }
  }
  return ids;
}

function buildState(opts: {
  file: string;
  projectKey: string;
  workspacePath: string;
  workspaceLabel: string;
  now: number;
  shellRunning: boolean;
  shellExitCode: number | null;
  parentId?: string;
}): SessionState {
  const parsed = parseTranscriptFile(opts.file, opts.now, opts.parentId);
  const inferred = inferSessionFields({
    parsed,
    now: opts.now,
    shellRunning: opts.shellRunning,
    shellExitCode: opts.shellExitCode,
    subagentRunning: 0,
  });
  return {
    id: parsed.id,
    projectKey: opts.projectKey,
    workspacePath: opts.workspacePath,
    workspaceLabel: opts.workspaceLabel,
    status: inferred.status,
    summary: parsed.summary,
    currentAction: inferred.currentAction,
    lastActivityAt: parsed.lastActivityAt,
    waitingSince: inferred.waitingSince,
    runningSince: inferred.runningSince,
    subagentCount: 0,
    subagentRunning: 0,
    transcriptPath: parsed.transcriptPath,
    recentMessages: parsed.recentMessages,
    parentId: opts.parentId,
  };
}
