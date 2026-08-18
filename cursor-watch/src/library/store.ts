import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { libraryFile, stateDir } from "../constants.js";
import {
  mergeAttachmentPaths,
  type AttachmentReject,
} from "./attachments.js";
import type {
  CreateFolderInput,
  LibraryEntry,
  LibraryFolder,
  LibraryMark,
  LibraryState,
  PatchFolderInput,
  PatchLibraryEntryInput,
  TodoPriority,
  UpsertLibraryEntryInput,
} from "./types.js";

const EMPTY: LibraryState = { version: 1, folders: [], entries: [] };

function ensureStateDir(home: string): void {
  fs.mkdirSync(stateDir(home), { recursive: true });
}

function isLibraryMark(v: unknown): v is LibraryMark {
  return v === "todo" || v === "archive";
}

function isTodoPriority(v: unknown): v is TodoPriority {
  return v === "urgent" || v === "important";
}

/** Normalize patch/upsert priority input; undefined = leave unchanged at call site. */
export function coerceTodoPriorityInput(
  v: unknown,
): TodoPriority | "none" | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "none" || v === "") return "none";
  if (isTodoPriority(v)) return v;
  return "none";
}

function stripPriority(entry: LibraryEntry): LibraryEntry {
  if (!entry.priority) return entry;
  const { priority: _drop, ...rest } = entry;
  return rest;
}

function withCoercedPriority(entry: LibraryEntry): LibraryEntry {
  let next = entry;
  if (entry.mark !== "todo") {
    next = stripPriority(next);
  } else if (entry.priority !== undefined && !isTodoPriority(entry.priority)) {
    next = stripPriority(next);
  }
  return next;
}

function isFolder(raw: unknown): raw is LibraryFolder {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    !!o.id &&
    isLibraryMark(o.mark) &&
    (o.parentId === null || typeof o.parentId === "string") &&
    typeof o.name === "string" &&
    typeof o.sortKey === "number" &&
    Number.isFinite(o.sortKey)
  );
}

function coerceAttachments(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) continue;
    const p = item.trim();
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out.length ? out : undefined;
}

function isEntry(raw: unknown): raw is LibraryEntry {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  if (
    !(
      typeof o.conversationId === "string" &&
      !!o.conversationId &&
      isLibraryMark(o.mark) &&
      (o.folderId === null || typeof o.folderId === "string") &&
      typeof o.updatedAt === "number" &&
      Number.isFinite(o.updatedAt)
    )
  ) {
    return false;
  }
  if (o.attachments !== undefined && !Array.isArray(o.attachments)) return false;
  return true;
}

function withCoercedAttachments(entry: LibraryEntry): LibraryEntry {
  const attachments = coerceAttachments(entry.attachments);
  let next: LibraryEntry = entry;
  if (!attachments) {
    if (entry.attachments) {
      const { attachments: _drop, ...rest } = entry;
      next = rest;
    }
  } else {
    next = { ...entry, attachments };
  }
  return withCoercedPriority(next);
}

function saveLibrary(home: string, state: LibraryState): void {
  ensureStateDir(home);
  const file = libraryFile(home);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

export function loadLibrary(home: string): LibraryState {
  const file = libraryFile(home);
  if (!fs.existsSync(file)) return { ...EMPTY, folders: [], entries: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return { ...EMPTY, folders: [], entries: [] };
    const o = raw as Record<string, unknown>;
    const folders = Array.isArray(o.folders) ? o.folders.filter(isFolder) : [];
    const entries = Array.isArray(o.entries)
      ? o.entries.filter(isEntry).map(withCoercedAttachments)
      : [];
    return { version: 1, folders, entries };
  } catch {
    return { ...EMPTY, folders: [], entries: [] };
  }
}

function folderById(state: LibraryState, id: string): LibraryFolder | undefined {
  return state.folders.find((f) => f.id === id);
}

function assertFolderForMark(
  state: LibraryState,
  folderId: string | null | undefined,
  mark: LibraryMark,
): string | null {
  if (folderId == null || folderId === "") return null;
  const folder = folderById(state, folderId);
  if (!folder) throw new Error(`folder not found: ${folderId}`);
  if (folder.mark !== mark) throw new Error(`folder mark mismatch for ${folderId}`);
  return folder.id;
}

function wouldCreateCycle(
  state: LibraryState,
  folderId: string,
  newParentId: string | null,
): boolean {
  if (newParentId == null) return false;
  if (newParentId === folderId) return true;
  let cur: string | null = newParentId;
  const guard = new Set<string>();
  while (cur) {
    if (cur === folderId) return true;
    if (guard.has(cur)) return true;
    guard.add(cur);
    cur = folderById(state, cur)?.parentId ?? null;
  }
  return false;
}

function applyOptionalString(
  target: LibraryEntry,
  key: keyof LibraryEntry,
  value: string | undefined,
): void {
  if (value === undefined) return;
  const trimmed = value.trim();
  if (!trimmed) {
    delete (target as unknown as Record<string, unknown>)[key];
  } else {
    (target as unknown as Record<string, unknown>)[key] = trimmed;
  }
}

export function upsertEntry(home: string, input: UpsertLibraryEntryInput): LibraryEntry {
  const conversationId = input.conversationId?.trim() ?? "";
  if (!conversationId) throw new Error("conversationId required");
  if (!isLibraryMark(input.mark)) throw new Error("invalid mark");

  const state = loadLibrary(home);
  const idx = state.entries.findIndex((e) => e.conversationId === conversationId);
  const prev = idx >= 0 ? state.entries[idx]! : undefined;

  let folderId: string | null = null;
  if (input.folderId !== undefined) {
    folderId = assertFolderForMark(state, input.folderId, input.mark);
  } else if (prev && prev.mark === input.mark) {
    folderId = prev.folderId;
  } else {
    folderId = null;
  }

  const next: LibraryEntry = {
    conversationId,
    mark: input.mark,
    folderId,
    updatedAt: Date.now(),
  };

  if (input.title !== undefined) applyOptionalString(next, "title", input.title);
  else if (prev?.title) next.title = prev.title;

  if (input.note !== undefined) applyOptionalString(next, "note", input.note);
  else if (prev?.note) next.note = prev.note;

  if (prev?.attachments?.length) next.attachments = [...prev.attachments];

  const priorityIn = coerceTodoPriorityInput(input.priority);
  if (input.mark === "todo") {
    if (priorityIn === "urgent" || priorityIn === "important") {
      next.priority = priorityIn;
    } else if (priorityIn === "none") {
      /* cleared */
    } else if (prev?.mark === "todo" && isTodoPriority(prev.priority)) {
      next.priority = prev.priority;
    }
  }

  const snapKeys = [
    "projectKey",
    "workspacePath",
    "workspaceLabel",
    "chatName",
    "transcriptPath",
  ] as const;
  for (const k of snapKeys) {
    if (input[k] !== undefined) applyOptionalString(next, k, input[k]);
    else if (prev?.[k]) next[k] = prev[k];
  }

  if (idx >= 0) state.entries[idx] = next;
  else state.entries.push(next);

  saveLibrary(home, state);
  return next;
}

export function patchEntry(
  home: string,
  conversationId: string,
  patch: PatchLibraryEntryInput,
): LibraryEntry | null {
  const id = conversationId?.trim() ?? "";
  if (!id) return null;
  const state = loadLibrary(home);
  const idx = state.entries.findIndex((e) => e.conversationId === id);
  if (idx < 0) return null;
  const prev = state.entries[idx]!;

  const mark = patch.mark !== undefined ? patch.mark : prev.mark;
  if (!isLibraryMark(mark)) throw new Error("invalid mark");

  let folderId = prev.folderId;
  if (patch.mark !== undefined && patch.mark !== prev.mark) {
    folderId = null;
  }
  if (patch.folderId !== undefined) {
    folderId = assertFolderForMark(state, patch.folderId, mark);
  }

  const next: LibraryEntry = {
    ...prev,
    mark,
    folderId,
    updatedAt: Date.now(),
  };

  if (patch.title !== undefined) {
    if (patch.title === null || !String(patch.title).trim()) delete next.title;
    else next.title = String(patch.title).trim();
  }
  if (patch.note !== undefined) {
    if (patch.note === null || !String(patch.note).trim()) delete next.note;
    else next.note = String(patch.note).trim();
  }

  const markChanged = patch.mark !== undefined && patch.mark !== prev.mark;
  if (mark === "archive") {
    delete next.priority;
  } else if (markChanged && mark === "todo") {
    delete next.priority;
  } else {
    const priorityIn = coerceTodoPriorityInput(patch.priority);
    if (priorityIn === "urgent" || priorityIn === "important") {
      next.priority = priorityIn;
    } else if (priorityIn === "none") {
      delete next.priority;
    }
  }

  for (const k of [
    "projectKey",
    "workspacePath",
    "workspaceLabel",
    "chatName",
    "transcriptPath",
  ] as const) {
    if (patch[k] !== undefined) applyOptionalString(next, k, patch[k]);
  }

  state.entries[idx] = next;
  saveLibrary(home, state);
  return next;
}

export function deleteEntry(home: string, conversationId: string): boolean {
  const id = conversationId?.trim() ?? "";
  if (!id) return false;
  const state = loadLibrary(home);
  const before = state.entries.length;
  state.entries = state.entries.filter((e) => e.conversationId !== id);
  if (state.entries.length === before) return false;
  saveLibrary(home, state);
  return true;
}

export type AddAttachmentsResult = {
  entry: LibraryEntry;
  added: string[];
  rejected: AttachmentReject[];
};

export function addAttachments(
  home: string,
  conversationId: string,
  paths: string[],
): AddAttachmentsResult {
  const id = conversationId?.trim() ?? "";
  if (!id) throw new Error("conversationId required");
  const state = loadLibrary(home);
  const idx = state.entries.findIndex((e) => e.conversationId === id);
  if (idx < 0) throw new Error("entry not found");
  const prev = state.entries[idx]!;
  const merged = mergeAttachmentPaths(prev.attachments, paths);
  const next: LibraryEntry = {
    ...prev,
    updatedAt: Date.now(),
  };
  if (merged.attachments.length) next.attachments = merged.attachments;
  else delete next.attachments;
  state.entries[idx] = next;
  saveLibrary(home, state);
  return { entry: next, added: merged.added, rejected: merged.rejected };
}

export function removeAttachment(
  home: string,
  conversationId: string,
  filePath: string,
): LibraryEntry | null {
  const id = conversationId?.trim() ?? "";
  if (!id) return null;
  const state = loadLibrary(home);
  const idx = state.entries.findIndex((e) => e.conversationId === id);
  if (idx < 0) return null;
  const prev = state.entries[idx]!;
  const target = String(filePath || "").trim()
    ? path.resolve(String(filePath).trim())
    : "";
  const nextList = (prev.attachments ?? []).filter((p) => p !== target);
  const next: LibraryEntry = {
    ...prev,
    updatedAt: Date.now(),
  };
  if (nextList.length) next.attachments = nextList;
  else delete next.attachments;
  state.entries[idx] = next;
  saveLibrary(home, state);
  return next;
}

export function createFolder(home: string, input: CreateFolderInput): LibraryFolder {
  const name = input.name?.trim() ?? "";
  if (!name) throw new Error("folder name required");
  if (!isLibraryMark(input.mark)) throw new Error("invalid mark");

  const state = loadLibrary(home);
  const parentId =
    input.parentId == null || input.parentId === ""
      ? null
      : assertFolderForMark(state, input.parentId, input.mark);

  const siblings = state.folders.filter(
    (f) => f.mark === input.mark && f.parentId === parentId,
  );
  const sortKey =
    input.sortKey !== undefined && Number.isFinite(input.sortKey)
      ? input.sortKey
      : siblings.reduce((m, f) => Math.max(m, f.sortKey), -1) + 1;

  const folder: LibraryFolder = {
    id: randomUUID(),
    mark: input.mark,
    parentId,
    name,
    sortKey,
  };
  state.folders.push(folder);
  saveLibrary(home, state);
  return folder;
}

export function patchFolder(
  home: string,
  id: string,
  patch: PatchFolderInput,
): LibraryFolder | null {
  const state = loadLibrary(home);
  const idx = state.folders.findIndex((f) => f.id === id);
  if (idx < 0) return null;
  const prev = state.folders[idx]!;

  let parentId = prev.parentId;
  if (patch.parentId !== undefined) {
    if (patch.parentId === null || patch.parentId === "") {
      parentId = null;
    } else {
      const parent = folderById(state, patch.parentId);
      if (!parent) throw new Error(`folder not found: ${patch.parentId}`);
      if (parent.mark !== prev.mark) throw new Error("folder mark mismatch");
      if (wouldCreateCycle(state, id, patch.parentId)) {
        throw new Error("folder cycle");
      }
      parentId = patch.parentId;
    }
  }

  const name =
    patch.name !== undefined ? patch.name.trim() : prev.name;
  if (!name) throw new Error("folder name required");

  const next: LibraryFolder = {
    ...prev,
    parentId,
    name,
    sortKey:
      patch.sortKey !== undefined && Number.isFinite(patch.sortKey)
        ? patch.sortKey
        : prev.sortKey,
  };
  state.folders[idx] = next;
  saveLibrary(home, state);
  return next;
}

/**
 * Rewrite sortKey (0..n-1) for an exact sibling set (same mark + parentId).
 * @throws if orderedIds is empty, missing, mixed parent/mark, or not the full sibling set
 */
export function reorderSiblingFolders(home: string, orderedIds: string[]): LibraryFolder[] {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw new Error("orderedIds required");
  }
  const unique = new Set(orderedIds);
  if (unique.size !== orderedIds.length) {
    throw new Error("orderedIds must be unique");
  }

  const state = loadLibrary(home);
  const picked: LibraryFolder[] = [];
  for (const id of orderedIds) {
    const f = folderById(state, id);
    if (!f) throw new Error(`folder not found: ${id}`);
    picked.push(f);
  }

  const mark = picked[0]!.mark;
  const parentId = picked[0]!.parentId ?? null;
  for (const f of picked) {
    if (f.mark !== mark || (f.parentId ?? null) !== parentId) {
      throw new Error("orderedIds must be siblings");
    }
  }

  const siblingIds = state.folders
    .filter((f) => f.mark === mark && (f.parentId ?? null) === parentId)
    .map((f) => f.id);
  if (siblingIds.length !== orderedIds.length) {
    throw new Error("orderedIds must be the full sibling set");
  }
  for (const id of siblingIds) {
    if (!unique.has(id)) throw new Error("orderedIds must be the full sibling set");
  }

  const byId = new Map(state.folders.map((f, i) => [f.id, i]));
  for (let i = 0; i < orderedIds.length; i++) {
    const idx = byId.get(orderedIds[i]!);
    if (idx === undefined) continue;
    const prev = state.folders[idx]!;
    state.folders[idx] = { ...prev, sortKey: i };
  }
  saveLibrary(home, state);
  return orderedIds.map((id) => folderById(state, id)!);
}

export function deleteFolder(home: string, id: string): boolean {
  const state = loadLibrary(home);
  const folder = folderById(state, id);
  if (!folder) return false;
  const parentId = folder.parentId;

  for (const f of state.folders) {
    if (f.parentId === id) f.parentId = parentId;
  }
  for (const e of state.entries) {
    if (e.folderId === id) e.folderId = parentId;
  }
  state.folders = state.folders.filter((f) => f.id !== id);
  saveLibrary(home, state);
  return true;
}
