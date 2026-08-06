export type LibraryMark = "todo" | "archive";

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
