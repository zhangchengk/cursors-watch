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

export type LibraryEntryView = LibraryEntry & { stale: boolean };

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
