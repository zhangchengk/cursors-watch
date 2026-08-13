import fs from "node:fs";
import path from "node:path";

export type AttachmentReject = { path: string; reason: string };

export function isMarkdownPath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".md";
}

export function isHtmlPath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".html";
}

/** Allowed Library attachment extensions: .md and .html (not .htm). */
export function isAttachmentPath(filePath: string): boolean {
  return isMarkdownPath(filePath) || isHtmlPath(filePath);
}

function isReadableRegularFile(filePath: string): boolean {
  if (!filePath || typeof filePath !== "string") return false;
  if (!path.isAbsolute(filePath)) return false;
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return false;
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** True when path is an existing readable regular .md file. */
export function isReadableMarkdownFile(filePath: string): boolean {
  return isMarkdownPath(filePath) && isReadableRegularFile(filePath);
}

/** True when path is an existing readable regular .html file. */
export function isReadableHtmlFile(filePath: string): boolean {
  return isHtmlPath(filePath) && isReadableRegularFile(filePath);
}

/** True when path is an existing readable Library attachment (.md or .html). */
export function isReadableAttachmentFile(filePath: string): boolean {
  return isAttachmentPath(filePath) && isReadableRegularFile(filePath);
}

export function normalizeAttachmentPath(raw: string): string {
  return path.resolve(String(raw || "").trim());
}

/**
 * Merge candidate paths into an ordered unique list.
 * Invalid candidates go to `rejected`; already-present paths are skipped (not rejected).
 */
export function mergeAttachmentPaths(
  existing: string[] | undefined,
  candidates: string[],
): { attachments: string[]; rejected: AttachmentReject[]; added: string[] } {
  const attachments = [...(existing ?? [])];
  const seen = new Set(attachments);
  const rejected: AttachmentReject[] = [];
  const added: string[] = [];

  for (const raw of candidates) {
    if (typeof raw !== "string" || !raw.trim()) {
      rejected.push({ path: String(raw ?? ""), reason: "empty path" });
      continue;
    }
    const p = normalizeAttachmentPath(raw);
    if (seen.has(p)) continue;
    if (!path.isAbsolute(p)) {
      rejected.push({ path: p, reason: "path must be absolute" });
      continue;
    }
    if (!isAttachmentPath(p)) {
      rejected.push({ path: p, reason: "not a .md or .html file" });
      continue;
    }
    if (!isReadableAttachmentFile(p)) {
      rejected.push({ path: p, reason: "file missing or unreadable" });
      continue;
    }
    attachments.push(p);
    seen.add(p);
    added.push(p);
  }

  return { attachments, rejected, added };
}
