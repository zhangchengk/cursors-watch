import fs from "node:fs";
import path from "node:path";
import { aggregateSessions } from "./aggregator.js";
import { loadComposerChatNamesFromHome, loadComposerHeadersMetaFromHome } from "./chat-names.js";
import { liveDir } from "./constants.js";
import { inferSessionFields } from "./infer/status.js";
import { mergeSessionExtras } from "./live-state.js";
import { readLiveMap } from "./live-store.js";
import { parseTranscriptFile } from "./parser/transcript.js";
import { parseTerminalMeta } from "./terminals.js";
import type { SessionState } from "./types.js";
import { resolveWorkspace } from "./workspace.js";

export function scanProjects(
  projectsDir: string,
  homeDir: string,
  now = Date.now(),
): SessionState[] {
  const raw: SessionState[] = [];
  if (!fs.existsSync(projectsDir)) return [];

  const chatNames = loadComposerChatNamesFromHome(homeDir);
  const headers = loadComposerHeadersMetaFromHome(homeDir);
  const lives = readLiveMap(liveDir(homeDir));

  for (const projectKey of fs.readdirSync(projectsDir)) {
    const projectPath = path.join(projectsDir, projectKey);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    const { workspacePath, workspaceLabel } = resolveWorkspace(projectKey, homeDir);

    let shellRunning = false;
    let shellExitCode: number | null = null;
    const termDir = path.join(projectPath, "terminals");
    if (fs.existsSync(termDir)) {
      for (const name of fs.readdirSync(termDir)) {
        if (!name.endsWith(".txt")) continue;
        const meta = parseTerminalMeta(
          fs.readFileSync(path.join(termDir, name), "utf8"),
        );
        if (meta.running) shellRunning = true;
        if (meta.exitCode !== null && meta.exitCode !== 0) shellExitCode = meta.exitCode;
      }
    }

    const transcriptsRoot = path.join(projectPath, "agent-transcripts");
    if (!fs.existsSync(transcriptsRoot)) continue;

    for (const sessionId of fs.readdirSync(transcriptsRoot)) {
      const sessionDir = path.join(transcriptsRoot, sessionId);
      if (!fs.statSync(sessionDir).isDirectory()) continue;
      const mainFile = path.join(sessionDir, `${sessionId}.jsonl`);
      if (fs.existsSync(mainFile)) {
        const parent = buildState({
          file: mainFile,
          projectKey,
          workspacePath,
          workspaceLabel,
          now,
          shellRunning,
          shellExitCode,
          chatNames,
        });
        raw.push(
          mergeSessionExtras(
            parent,
            headers.get(parent.id),
            lives.get(parent.id),
            now,
          ),
        );
      }
      const subDir = path.join(sessionDir, "subagents");
      if (fs.existsSync(subDir)) {
        for (const name of fs.readdirSync(subDir)) {
          if (!name.endsWith(".jsonl")) continue;
          raw.push(
            buildState({
              file: path.join(subDir, name),
              projectKey,
              workspacePath,
              workspaceLabel,
              now,
              shellRunning: false,
              shellExitCode: null,
              parentId: sessionId,
              chatNames,
            }),
          );
        }
      }
    }
  }

  return aggregateSessions(raw, now);
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
  chatNames: Map<string, string>;
}): SessionState {
  const parsed = parseTranscriptFile(opts.file, opts.now, opts.parentId);
  // Re-infer subagentRunning later in aggregator; pass 0 here
  const inferred = inferSessionFields({
    parsed,
    now: opts.now,
    shellRunning: opts.shellRunning,
    shellExitCode: opts.shellExitCode,
    subagentRunning: 0,
  });
  const chatName = opts.chatNames.get(parsed.id);
  return {
    id: parsed.id,
    projectKey: opts.projectKey,
    workspacePath: opts.workspacePath,
    workspaceLabel: opts.workspaceLabel,
    status: inferred.status,
    summary: parsed.summary,
    chatName,
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
