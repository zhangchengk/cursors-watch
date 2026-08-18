import fs from "node:fs";
import path from "node:path";
import { cursorProjectsDir } from "../constants.js";
import type { SessionState } from "../types.js";
import { encodeWorkspacePath } from "../workspace.js";
import type { LibraryEntry } from "./types.js";

export type LibraryStaleOpts = {
  projectsDir?: string;
};

export function isLibraryEntryStale(
  entry: LibraryEntry,
  sessions: SessionState[],
  exists: (p: string) => boolean = (p) => fs.existsSync(p),
  opts: LibraryStaleOpts = {},
): boolean {
  const stored = entry.transcriptPath?.trim();
  if (stored && exists(stored)) return false;

  const conversationId = entry.conversationId?.trim() ?? "";
  const workspacePath = entry.workspacePath?.trim() ?? "";
  if (
    conversationId &&
    sessions.some(
      (s) =>
        s.id === conversationId && (!workspacePath || s.workspacePath === workspacePath),
    )
  ) {
    return false;
  }

  const projectsDir = opts.projectsDir ?? cursorProjectsDir();
  for (const candidate of conventionalTranscriptPaths(entry, projectsDir)) {
    if (exists(candidate)) return false;
  }
  return true;
}

function conventionalTranscriptPaths(entry: LibraryEntry, projectsDir: string): string[] {
  const id = entry.conversationId?.trim();
  if (!id) return [];
  const keys = new Set<string>();
  const projectKey = entry.projectKey?.trim();
  if (projectKey) keys.add(projectKey);
  const workspacePath = entry.workspacePath?.trim();
  if (workspacePath) keys.add(encodeWorkspacePath(workspacePath));
  return [...keys].map((key) =>
    path.join(projectsDir, key, "agent-transcripts", id, `${id}.jsonl`),
  );
}
