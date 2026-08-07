import fs from "node:fs";
import path from "node:path";
import { isReadableMarkdownFile } from "./attachments.js";
import { loadLibrary } from "./store.js";

export type AttachmentPreviewOk = {
  ok: true;
  path: string;
  content: string;
};

export type AttachmentPreviewErr = {
  ok: false;
  status: 403 | 404;
  error: string;
};

export function readAttachedMarkdown(
  home: string,
  conversationId: string,
  filePath: string,
): AttachmentPreviewOk | AttachmentPreviewErr {
  const id = conversationId?.trim() ?? "";
  const raw = typeof filePath === "string" ? filePath.trim() : "";
  if (!id || !raw) {
    return { ok: false, status: 404, error: "conversationId and path required" };
  }
  const resolved = path.resolve(raw);
  const entry = loadLibrary(home).entries.find((e) => e.conversationId === id);
  if (!entry) return { ok: false, status: 404, error: "entry not found" };
  const allowed = (entry.attachments ?? []).some((p) => p === resolved);
  if (!allowed) {
    return { ok: false, status: 403, error: "path is not attached to this entry" };
  }
  if (!isReadableMarkdownFile(resolved)) {
    return { ok: false, status: 404, error: "attachment file missing or unreadable" };
  }
  try {
    const content = fs.readFileSync(resolved, "utf8");
    return { ok: true, path: resolved, content };
  } catch {
    return { ok: false, status: 404, error: "attachment file missing or unreadable" };
  }
}

export function isPathAttached(
  home: string,
  conversationId: string,
  filePath: string,
): boolean {
  const id = conversationId?.trim() ?? "";
  const resolved = path.resolve(String(filePath || "").trim());
  if (!id || !resolved) return false;
  const entry = loadLibrary(home).entries.find((e) => e.conversationId === id);
  return Boolean(entry?.attachments?.includes(resolved));
}
