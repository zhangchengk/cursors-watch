import fs from "node:fs";
import path from "node:path";
import {
  isHtmlPath,
  isReadableHtmlFile,
  isReadableMarkdownFile,
} from "./attachments.js";
import { loadLibrary } from "./store.js";

export type AttachmentPreviewOk = {
  ok: true;
  path: string;
  content: string;
};

export type AttachmentPreviewErr = {
  ok: false;
  status: 400 | 403 | 404;
  error: string;
};

export type AttachmentOpenErr = {
  ok: false;
  status: 400 | 403 | 404;
  error: string;
};

export type AttachmentOpenOk = {
  ok: true;
  path: string;
};

function resolveAttachedPath(
  home: string,
  conversationId: string,
  filePath: string,
):
  | { ok: true; path: string }
  | { ok: false; status: 403 | 404; error: string } {
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
  return { ok: true, path: resolved };
}

export function readAttachedMarkdown(
  home: string,
  conversationId: string,
  filePath: string,
): AttachmentPreviewOk | AttachmentPreviewErr {
  const attached = resolveAttachedPath(home, conversationId, filePath);
  if (!attached.ok) return attached;
  const resolved = attached.path;
  if (isHtmlPath(resolved)) {
    return {
      ok: false,
      status: 400,
      error: "html attachments open in the default browser",
    };
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

/** Validate an attached .html path for opening in the default browser. */
export function prepareAttachedHtmlOpen(
  home: string,
  conversationId: string,
  filePath: string,
): AttachmentOpenOk | AttachmentOpenErr {
  const attached = resolveAttachedPath(home, conversationId, filePath);
  if (!attached.ok) return attached;
  const resolved = attached.path;
  if (!isHtmlPath(resolved)) {
    return { ok: false, status: 400, error: "only .html attachments open in the browser" };
  }
  if (!isReadableHtmlFile(resolved)) {
    return { ok: false, status: 404, error: "attachment file missing or unreadable" };
  }
  return { ok: true, path: resolved };
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
