import fs from "node:fs";
import type { SessionState } from "../types.js";
import type { LibraryEntry } from "./types.js";

export function isLibraryEntryStale(
  entry: LibraryEntry,
  sessions: SessionState[],
  exists: (p: string) => boolean = (p) => fs.existsSync(p),
): boolean {
  const transcriptPath = entry.transcriptPath?.trim();
  if (transcriptPath) return !exists(transcriptPath);
  const workspacePath = entry.workspacePath?.trim() ?? "";
  if (
    workspacePath &&
    sessions.some((s) => s.id === entry.conversationId && s.workspacePath === workspacePath)
  ) {
    return false;
  }
  return true;
}
