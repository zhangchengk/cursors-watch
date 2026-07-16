import fs from "node:fs";
import {
  RECENT_MESSAGE_COUNT,
  RUNNING_WINDOW_MS,
  SUMMARY_MAX_CHARS,
} from "../constants.js";
import type { RecentMessage } from "../types.js";

export interface ParsedTranscript {
  id: string;
  transcriptPath: string;
  parentId?: string;
  summary: string;
  lastRole: "user" | "assistant" | "system" | null;
  lastToolName?: string;
  lastToolCommand?: string;
  lastToolFailed: boolean;
  hadToolUseRecently: boolean;
  lastMessageHadToolUse: boolean;
  lastActivityAt: number;
  recentMessages: RecentMessage[];
  rawUserTexts: string[];
}

function stripUserQuery(text: string): string {
  return text
    .replace(/<\/?user_query>/g, "")
    .replace(/<\/?timestamp>[^]*?<\/timestamp>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: string; text?: string };
    if (p.type === "text" && typeof p.text === "string") parts.push(p.text);
  }
  return parts.join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export function parseTranscriptText(
  text: string,
  meta: { id: string; transcriptPath: string; parentId?: string },
  now = Date.now(),
  fileMtimeMs?: number,
): ParsedTranscript {
  const recent: RecentMessage[] = [];
  const rawUserTexts: string[] = [];
  let lastRole: ParsedTranscript["lastRole"] = null;
  let lastToolName: string | undefined;
  let lastToolCommand: string | undefined;
  let lastToolFailed = false;
  let lastActivityAt = fileMtimeMs ?? 0;
  let lastToolAt = 0;
  let lastMessageHadToolUse = false;

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const role = obj.role as RecentMessage["role"] | undefined;
    const message = obj.message as { content?: unknown } | undefined;
    const ts =
      typeof obj.timestamp === "number"
        ? obj.timestamp
        : typeof obj.timestamp === "string"
          ? Date.parse(obj.timestamp)
          : undefined;

    if (ts && !Number.isNaN(ts)) lastActivityAt = Math.max(lastActivityAt, ts);

    if (!role || !message) continue;
    lastRole = role;
    lastMessageHadToolUse = false;

    const content = message.content;
    const textBody = stripUserQuery(contentToText(content));
    if (role === "user" && textBody) rawUserTexts.push(textBody);

    let toolName: string | undefined;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const p = part as {
          type?: string;
          name?: string;
          input?: Record<string, unknown>;
          is_error?: boolean;
        };
        if (p.type === "tool_use" && p.name) {
          toolName = p.name;
          lastToolName = p.name;
          lastMessageHadToolUse = true;
          const input = p.input ?? {};
          if (typeof input.command === "string") {
            lastToolCommand = input.command;
          } else if (typeof input.description === "string") {
            lastToolCommand = input.description;
          }
          lastToolAt = ts ?? lastActivityAt ?? now;
        }
        if (p.type === "tool_result" && p.is_error) lastToolFailed = true;
      }
    }

    const display = textBody || (toolName ? `[tool] ${toolName}` : "");
    if (display) {
      recent.push({ role, text: display, at: ts });
      if (recent.length > RECENT_MESSAGE_COUNT) recent.shift();
    }
  }

  if (!lastActivityAt && fileMtimeMs) lastActivityAt = fileMtimeMs;
  if (!lastActivityAt) lastActivityAt = now;

  const hadToolUseRecently =
    (lastToolAt > 0 && now - lastToolAt <= RUNNING_WINDOW_MS) ||
    Boolean(
      lastMessageHadToolUse &&
        fileMtimeMs &&
        now - fileMtimeMs <= RUNNING_WINDOW_MS,
    );

  const firstUser = rawUserTexts[0] ?? "";
  return {
    id: meta.id,
    transcriptPath: meta.transcriptPath,
    parentId: meta.parentId,
    summary: truncate(firstUser || "(no user message)", SUMMARY_MAX_CHARS),
    lastRole,
    lastToolName,
    lastToolCommand,
    lastToolFailed,
    hadToolUseRecently,
    lastMessageHadToolUse,
    lastActivityAt,
    recentMessages: recent.slice(-RECENT_MESSAGE_COUNT),
    rawUserTexts,
  };
}

export function parseTranscriptFile(
  filePath: string,
  now = Date.now(),
  parentId?: string,
): ParsedTranscript {
  const text = fs.readFileSync(filePath, "utf8");
  const stat = fs.statSync(filePath);
  const id = pathBasenameWithoutExt(filePath);
  return parseTranscriptText(
    text,
    { id, transcriptPath: filePath, parentId },
    now,
    stat.mtimeMs,
  );
}

function pathBasenameWithoutExt(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  return base.replace(/\.jsonl$/i, "");
}
