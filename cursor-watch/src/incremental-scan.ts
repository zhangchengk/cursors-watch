import fs from "node:fs";
import path from "node:path";
import {
  aggregateSessions,
  isSessionVisible,
  workspaceDirExists,
} from "./aggregator.js";
import { liveDir, SCAN_LOOKBACK_MS } from "./constants.js";
import {
  buildState,
  collectMirroredSubagentIds,
  readProjectShellFlags,
} from "./scanner.js";
import type { ScanCaches } from "./scan-caches.js";
import { mergeSessionExtras, type LiveSnapshot } from "./live-state.js";
import { parseLiveSnapshot } from "./live-store.js";
import {
  onEffectiveTurnEnd,
  type IsActiveLoopFn,
  type NotifyReminderFn,
} from "./reminders/pipeline.js";
import type { SessionStore } from "./store.js";
import type { SessionState } from "./types.js";

export { readProjectShellFlags } from "./scanner.js";

/** Clear live-derived fields so mergeSessionExtras re-applies from the snap. */
function stripLiveFields(session: SessionState): SessionState {
  const { live: _l, turnEnded: _t, turnEndedAt: _ta, liveHint: _h, ...rest } = session;
  return rest;
}

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

export function applyLivePatch(opts: {
  conversationId: string;
  store: SessionStore;
  caches: ScanCaches;
  homeDir: string;
  projectsDir: string;
  now?: number;
  /** Test/daemon injectable — forwarded to onEffectiveTurnEnd. */
  isActiveLoop?: IsActiveLoopFn;
  notify?: NotifyReminderFn;
}): "upserted" | "missing" | "removed" {
  const now = opts.now ?? Date.now();
  const existing = opts.store
    .getSessions()
    .find((s) => s.id === opts.conversationId);
  if (!existing) return "missing";

  const wasTurnEnded = existing.turnEnded === true;
  const snap = readLiveSnap(opts.homeDir, opts.conversationId);
  const becomingTurnEnded =
    !wasTurnEnded && snap != null && snap.stoppedAt != null;

  let merged = mergeSessionExtras(
    stripLiveFields(existing),
    opts.caches.getHeader(opts.conversationId),
    snap,
    now,
  );

  // Live elevates status to running; when live ends without turnEnded,
  // applyLiveToSession keeps running. Re-infer from transcript/shell.
  if (!merged.live && merged.status === "running") {
    const rescanned = rescanParentSession({
      projectsDir: opts.projectsDir,
      homeDir: opts.homeDir,
      projectKey: existing.projectKey,
      sessionId: opts.conversationId,
      caches: opts.caches,
      now,
    });
    if (!rescanned) {
      opts.store.remove(opts.conversationId);
      return "removed";
    }
    merged = rescanned;
  }

  if (!isSessionVisible(merged, now)) {
    opts.store.remove(opts.conversationId);
    return "removed";
  }

  opts.store.upsert(merged);

  if (becomingTurnEnded) {
    // Side-effect only: swallow so reminder failures cannot force a full scan.
    try {
      onEffectiveTurnEnd({
        homeDir: opts.homeDir,
        conversationId: opts.conversationId,
        session: {
          projectKey: merged.projectKey,
          workspacePath: merged.workspacePath,
          workspaceLabel: merged.workspaceLabel,
          chatName: merged.chatName,
          summary: merged.summary,
        },
        liveHint: merged.liveHint ?? snap?.liveHint,
        now,
        isActiveLoop: opts.isActiveLoop,
        notify: opts.notify,
      });
    } catch (err) {
      console.error(
        "[cursor-watch] onEffectiveTurnEnd failed (ignored)",
        err,
      );
    }
  }

  return "upserted";
}

export function rescanProjectShells(opts: {
  projectsDir: string;
  projectKey: string;
  store: SessionStore;
  caches: ScanCaches;
  homeDir: string;
  now?: number;
}): void {
  const now = opts.now ?? Date.now();
  const ids = opts.store
    .getSessions()
    .filter((s) => s.projectKey === opts.projectKey)
    .map((s) => s.id);

  for (const sessionId of ids) {
    const next = rescanParentSession({
      projectsDir: opts.projectsDir,
      homeDir: opts.homeDir,
      projectKey: opts.projectKey,
      sessionId,
      caches: opts.caches,
      now,
    });
    if (next) opts.store.upsert(next);
    else opts.store.remove(sessionId);
  }
}

/**
 * Re-apply composerHeaders (chatName / hasUnread / …) onto all parent sessions.
 * Used when Cursor's state DB changes without a transcript/live FS event.
 */
export function syncComposerHeaders(opts: {
  store: SessionStore;
  caches: ScanCaches;
  homeDir: string;
  now?: number;
}): void {
  opts.caches.invalidateHeaders();
  const now = opts.now ?? Date.now();
  for (const session of opts.store.getSessions()) {
    if (session.parentId) continue;
    const merged = mergeSessionExtras(
      stripLiveFields(session),
      opts.caches.getHeader(session.id),
      readLiveSnap(opts.homeDir, session.id),
      now,
    );
    if (
      merged.hasUnread === session.hasUnread &&
      merged.chatName === session.chatName &&
      merged.status === session.status &&
      merged.composerUpdatedAt === session.composerUpdatedAt &&
      merged.liveHint === session.liveHint
    ) {
      continue;
    }
    if (!isSessionVisible(merged, now)) {
      opts.store.remove(session.id);
      continue;
    }
    opts.store.upsert(merged);
  }
}
