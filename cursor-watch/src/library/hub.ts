import type { SessionState } from "../types.js";
import { isLibraryEntryStale } from "./stale.js";
import {
  createFolder,
  deleteEntry,
  deleteFolder,
  loadLibrary,
  patchEntry,
  patchFolder,
  upsertEntry,
  addAttachments,
  removeAttachment,
} from "./store.js";
import type {
  CreateFolderInput,
  LibraryEntry,
  LibraryFolder,
  LibraryState,
  PatchFolderInput,
  PatchLibraryEntryInput,
  UpsertLibraryEntryInput,
} from "./types.js";
import { isReadableAttachmentFile } from "./attachments.js";
import type { AttachmentReject } from "./attachments.js";

export type LibraryAttachmentView = { path: string; available: boolean };

export type LibraryEntryView = LibraryEntry & {
  stale: boolean;
  attachmentViews: LibraryAttachmentView[];
};

export type LibrarySnapshot = {
  folders: LibraryFolder[];
  entries: LibraryEntryView[];
};

export type LibraryListener = (snapshot: LibrarySnapshot) => void;

export class LibraryHub {
  private listeners = new Set<LibraryListener>();
  private getSessions: () => SessionState[] = () => [];

  constructor(private readonly homeDir: string) {}

  setSessionProvider(fn: () => SessionState[]): void {
    this.getSessions = fn;
  }

  getSnapshot(sessions?: SessionState[]): LibrarySnapshot {
    const state = loadLibrary(this.homeDir);
    const sess = sessions ?? this.getSessions();
    return {
      folders: state.folders,
      entries: state.entries.map((e) => ({
        ...e,
        stale: isLibraryEntryStale(e, sess),
        attachmentViews: (e.attachments ?? []).map((p) => ({
          path: p,
          available: isReadableAttachmentFile(p),
        })),
      })),
    };
  }

  rawState(): LibraryState {
    return loadLibrary(this.homeDir);
  }

  upsertEntry(input: UpsertLibraryEntryInput): LibraryEntry {
    const entry = upsertEntry(this.homeDir, input);
    this.emit();
    return entry;
  }

  patchEntry(conversationId: string, patch: PatchLibraryEntryInput): LibraryEntry | null {
    const entry = patchEntry(this.homeDir, conversationId, patch);
    if (entry) this.emit();
    return entry;
  }

  deleteEntry(conversationId: string): boolean {
    const ok = deleteEntry(this.homeDir, conversationId);
    if (ok) this.emit();
    return ok;
  }

  addAttachments(
    conversationId: string,
    paths: string[],
  ): { entry: LibraryEntry; added: string[]; rejected: AttachmentReject[] } {
    const result = addAttachments(this.homeDir, conversationId, paths);
    this.emit();
    return result;
  }

  removeAttachment(conversationId: string, filePath: string): LibraryEntry | null {
    const entry = removeAttachment(this.homeDir, conversationId, filePath);
    if (entry) this.emit();
    return entry;
  }

  createFolder(input: CreateFolderInput): LibraryFolder {
    const folder = createFolder(this.homeDir, input);
    this.emit();
    return folder;
  }

  patchFolder(id: string, patch: PatchFolderInput): LibraryFolder | null {
    const folder = patchFolder(this.homeDir, id, patch);
    if (folder) this.emit();
    return folder;
  }

  deleteFolder(id: string): boolean {
    const ok = deleteFolder(this.homeDir, id);
    if (ok) this.emit();
    return ok;
  }

  notifyChanged(): void {
    this.emit();
  }

  subscribe(fn: LibraryListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const l of this.listeners) l(snapshot);
  }
}
