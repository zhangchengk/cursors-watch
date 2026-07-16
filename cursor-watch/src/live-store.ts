import fs from "node:fs";
import path from "node:path";
import type { LiveEvent, LiveSnapshot } from "./live-state.js";

export function parseLiveSnapshot(raw: unknown): LiveSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.conversationId !== "string" || !o.conversationId) return null;
  if (o.lastEvent !== "preToolUse" && o.lastEvent !== "afterAgentResponse" && o.lastEvent !== "stop") {
    return null;
  }
  if (typeof o.lastLiveAt !== "number" || typeof o.updatedAt !== "number") return null;
  const stoppedAt = o.stoppedAt == null ? null : Number(o.stoppedAt);
  if (o.stoppedAt != null && !Number.isFinite(stoppedAt)) return null;
  return {
    conversationId: o.conversationId,
    lastEvent: o.lastEvent,
    lastLiveAt: o.lastLiveAt,
    stoppedAt,
    liveHint: typeof o.liveHint === "string" ? o.liveHint : "",
    updatedAt: o.updatedAt,
  };
}

export function buildLiveSnapshotFromHook(opts: {
  conversationId: string;
  event: LiveEvent;
  hint?: string;
  now?: number;
  prev?: LiveSnapshot | null;
}): LiveSnapshot {
  const now = opts.now ?? Date.now();
  const prev = opts.prev ?? null;
  const isStop = opts.event === "stop";
  return {
    conversationId: opts.conversationId,
    lastEvent: opts.event,
    lastLiveAt: isStop ? (prev?.lastLiveAt ?? now) : now,
    stoppedAt: isStop ? now : null,
    liveHint: (opts.hint ?? prev?.liveHint ?? "").slice(0, 200),
    updatedAt: now,
  };
}

export function readLiveMap(dir: string): Map<string, LiveSnapshot> {
  const out = new Map<string, LiveSnapshot>();
  if (!dir || !fs.existsSync(dir)) return out;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      const snap = parseLiveSnapshot(JSON.parse(text));
      if (snap) out.set(snap.conversationId, snap);
    } catch {
      /* skip */
    }
  }
  return out;
}
