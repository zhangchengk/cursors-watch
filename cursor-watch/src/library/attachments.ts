import fs from "node:fs";
import path from "node:path";

export type AttachmentReject = { path: string; reason: string };

export function isMarkdownPath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".md";
}

/** True when path is an existing readable regular file ending in .md/.markdown. */
export function isReadableMarkdownFile(filePath: string): boolean {
  if (!filePath || typeof filePath !== "string") return false;
  if (!path.isAbsolute(filePath)) return false;
  if (!isMarkdownPath(filePath)) return false;
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return false;
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
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
    if (!isMarkdownPath(p)) {
      rejected.push({ path: p, reason: "not a markdown file" });
      continue;
    }
    if (!isReadableMarkdownFile(p)) {
      rejected.push({ path: p, reason: "file missing or unreadable" });
      continue;
    }
    attachments.push(p);
    seen.add(p);
    added.push(p);
  }

  return { attachments, rejected, added };
}
