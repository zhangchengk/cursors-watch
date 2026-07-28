import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cursorProjectsDir,
  listenHost,
  listenPort,
  pidFile,
  stateDir,
} from "./constants.js";
import { ReminderHub } from "./reminders/hub.js";
import { onEffectiveTurnEnd } from "./reminders/pipeline.js";
import { shouldRemindForStoppedAt } from "./reminders/should-remind.js";
import {
  startNotifyWorker,
  stopNotifyWorker,
} from "./reminders/notify.js";
import { buildServer } from "./server.js";
import { SessionStore } from "./store.js";
import { startWatcher } from "./watcher.js";
import type { SessionState } from "./types.js";

function isSurvivableFsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  const code = e.code ?? "";
  if (code === "EMFILE" || code === "EBADF") return true;
  const msg = typeof e.message === "string" ? e.message : "";
  return msg.includes("EMFILE") || msg.includes("EBADF");
}

function installProcessGuards(): void {
  const logFile = path.join(stateDir(), "daemon.log");
  const append = (line: string) => {
    try {
      fs.mkdirSync(stateDir(), { recursive: true });
      fs.appendFileSync(logFile, line + "\n", "utf8");
    } catch {
      /* ignore */
    }
    console.error(line);
  };
  // EMFILE/EBADF can surface while chokidar watches settle or when forking the
  // scan worker; log and keep serving rather than taking down the daemon.
  process.on("uncaughtException", (err) => {
    append(`[cursor-watch] uncaughtException ${err?.stack || err}`);
    if (!isSurvivableFsError(err)) process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    append(`[cursor-watch] unhandledRejection ${err instanceof Error ? err.stack : err}`);
    if (!isSurvivableFsError(err)) process.exit(1);
  });
}

/** After full scan: remind for newly ended turns (skip stale cold-start rows). */
export function remindNewTurnEndsFromScan(opts: {
  homeDir: string;
  sessions: SessionState[];
  previous: SessionState[];
  now?: number;
  /** Skip first-seen ended sessions older than this (default 15m). */
  recentMs?: number;
  onReminderChanged?: () => void;
}): void {
  const now = opts.now ?? Date.now();
  const recentMs = opts.recentMs ?? 15 * 60 * 1000;
  const prevById = new Map(opts.previous.map((s) => [s.id, s]));
  for (const s of opts.sessions) {
    if (!s.turnEnded || s.turnEndedAt == null || s.parentId) continue;
    const prev = prevById.get(s.id);
    if (prev?.turnEndedAt === s.turnEndedAt) continue;
    // Cold start / first sight: only recent ends (avoid inbox flood on daemon boot).
    if (!prev && now - s.turnEndedAt > recentMs) continue;
    if (!shouldRemindForStoppedAt(opts.homeDir, s.id, s.turnEndedAt)) continue;
    try {
      onEffectiveTurnEnd({
        homeDir: opts.homeDir,
        conversationId: s.id,
        session: {
          projectKey: s.projectKey,
          workspacePath: s.workspacePath,
          workspaceLabel: s.workspaceLabel,
          chatName: s.chatName,
          summary: s.summary,
        },
        liveHint: s.liveHint,
        now: s.turnEndedAt,
        onReminderChanged: opts.onReminderChanged,
      });
    } catch (err) {
      console.error(
        "[cursor-watch] remindNewTurnEndsFromScan failed (ignored)",
        err,
      );
    }
  }
}

export async function runDaemon(): Promise<void> {
  fs.mkdirSync(stateDir(), { recursive: true });
  installProcessGuards();
  // Start notify sidecar before chokidar so it keeps a clean FD table.
  startNotifyWorker();
  const pf = pidFile();
  fs.writeFileSync(pf, String(process.pid), "utf8");

  const store = new SessionStore();
  const homeDir = os.homedir();
  const reminderHub = new ReminderHub(homeDir);
  const onReminderChanged = () => reminderHub.notifyChanged();
  const app = await buildServer(store, { homeDir, reminderHub });
  const host = listenHost();
  const port = listenPort();
  // Bind HTTP before startWatcher so the initial scan cannot block listen
  // (setImmediate still runs across await buildServer if watcher starts first).
  await app.listen({ host, port });
  console.log(`[cursor-watch] listening on http://${host}:${port}`);
  const watcher = startWatcher(cursorProjectsDir(), homeDir, store, {
    onReminderChanged,
    onSessionsReplaced: (sessions, previous) => {
      remindNewTurnEndsFromScan({
        homeDir,
        sessions,
        previous,
        onReminderChanged,
      });
    },
  });

  const shutdown = async () => {
    stopNotifyWorker();
    await watcher.close();
    await app.close();
    try {
      if (fs.existsSync(pf) && fs.readFileSync(pf, "utf8").trim() === String(process.pid)) {
        fs.unlinkSync(pf);
      }
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
