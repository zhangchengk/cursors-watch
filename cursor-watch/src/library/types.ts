export type LibraryMark = "todo" | "archive";

/** Todo-only; omit / absent means 无 (none). */
export type TodoPriority = "urgent" | "important";

export interface LibraryFolder {
  id: string;
  mark: LibraryMark;
  parentId: string | null;
  name: string;
  sortKey: number;
}

export interface LibraryEntry {
  conversationId: string;
  mark: LibraryMark;
  folderId: string | null;
  title?: string;
  note?: string;
  /** Todo only: urgent | important; absent = none. Never on archive. */
  priority?: TodoPriority;
  /** Ordered unique absolute paths to local .md files (Library attachments). */
  attachments?: string[];
  projectKey?: string;
  workspacePath?: string;
  workspaceLabel?: string;
  chatName?: string;
  transcriptPath?: string;
  updatedAt: number;
}

export interface LibraryState {
  version: 1;
  folders: LibraryFolder[];
  entries: LibraryEntry[];
}

export type UpsertLibraryEntryInput = {
  conversationId: string;
  mark: LibraryMark;
  folderId?: string | null;
  title?: string;
  note?: string;
  /** Todo only; ignored for archive. Pass null/"none" to clear. */
  priority?: TodoPriority | "none" | null;
  projectKey?: string;
  workspacePath?: string;
  workspaceLabel?: string;
  chatName?: string;
  transcriptPath?: string;
};

export type PatchLibraryEntryInput = {
  mark?: LibraryMark;
  folderId?: string | null;
  title?: string | null;
  note?: string | null;
  priority?: TodoPriority | "none" | null;
  projectKey?: string;
  workspacePath?: string;
  workspaceLabel?: string;
  chatName?: string;
  transcriptPath?: string;
};

export type CreateFolderInput = {
  mark: LibraryMark;
  parentId?: string | null;
  name: string;
  sortKey?: number;
};

export type PatchFolderInput = {
  name?: string;
  parentId?: string | null;
  sortKey?: number;
};
