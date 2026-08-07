export const LIBRARY_TAB_KEY = "cursor-watch-library-tab";

/** @typedef {"reminder"|"todo"|"archive"} LibraryTab */
/** @typedef {"todo"|"archive"} LibraryMark */

/**
 * @returns {LibraryTab}
 */
export function loadLibraryTab() {
  try {
    const v = localStorage.getItem(LIBRARY_TAB_KEY);
    if (v === "todo" || v === "archive" || v === "reminder") return v;
  } catch {
    /* ignore */
  }
  return "reminder";
}

/** @param {LibraryTab} tab */
export function saveLibraryTab(tab) {
  try {
    localStorage.setItem(LIBRARY_TAB_KEY, tab);
  } catch {
    /* ignore */
  }
}

/**
 * @param {{ title?: string, chatName?: string, conversationId?: string, id?: string }} entry
 */
export function entryDisplayTitle(entry) {
  const title = typeof entry.title === "string" ? entry.title.trim() : "";
  if (title) return title;
  const chatName = typeof entry.chatName === "string" ? entry.chatName.trim() : "";
  if (chatName) return chatName;
  return entry.conversationId || entry.id || "";
}

/**
 * @param {Array<{ mark: string }>} folders
 * @param {LibraryMark} mark
 */
export function foldersForMark(folders, mark) {
  return (folders || []).filter((f) => f.mark === mark);
}

/**
 * @param {Array<{ id: string, parentId: string|null, name: string, sortKey: number }>} folders
 * @returns {Array<{ folder: object, children: ReturnType<typeof buildFolderTree> }>}
 */
export function buildFolderTree(folders) {
  const list = [...(folders || [])].sort(
    (a, b) => a.sortKey - b.sortKey || a.name.localeCompare(b.name),
  );
  /** @type {Map<string|null, typeof list>} */
  const byParent = new Map();
  for (const f of list) {
    const key = f.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(f);
  }
  function walk(parentId) {
    const kids = byParent.get(parentId) || [];
    return kids.map((folder) => ({
      folder,
      children: walk(folder.id),
    }));
  }
  return walk(null);
}

/**
 * @param {Array<{ id: string, parentId: string|null }>} folders
 * @param {string} rootId
 * @returns {Set<string>}
 */
export function descendantFolderIds(folders, rootId) {
  /** @type {Map<string|null, string[]>} */
  const kids = new Map();
  for (const f of folders || []) {
    const p = f.parentId ?? null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(f.id);
  }
  const out = new Set([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    for (const child of kids.get(id) || []) {
      if (!out.has(child)) {
        out.add(child);
        stack.push(child);
      }
    }
  }
  return out;
}

/**
 * @param {Array<{ mark: string, folderId: string|null, conversationId: string }>} entries
 * @param {LibraryMark} mark
 * @param {string|null} folderId — null = 未归组 only; non-null = folder + all descendants
 * @param {Array<{ id: string, parentId: string|null, mark?: string }>|undefined} folders
 */
export function entriesInFolder(entries, mark, folderId, folders) {
  const list = entries || [];
  if (folderId == null) {
    return list.filter((e) => e.mark === mark && (e.folderId == null || e.folderId === ""));
  }
  const ids =
    folders && folders.length
      ? descendantFolderIds(folders, folderId)
      : new Set([folderId]);
  return list.filter((e) => e.mark === mark && e.folderId && ids.has(e.folderId));
}

/**
 * @param {Array<{ id: string, parentId: string|null, name: string, sortKey: number, mark: string }>} folders
 * @param {LibraryMark} mark
 * @returns {Array<{ id: string, label: string }>}
 */
export function folderSelectOptions(folders, mark) {
  const tree = buildFolderTree(foldersForMark(folders, mark));
  /** @type {Array<{ id: string, label: string }>} */
  const out = [];
  function walk(nodes, depth) {
    for (const n of nodes) {
      const pad = depth > 0 ? `${"—".repeat(depth)} ` : "";
      out.push({ id: n.folder.id, label: `${pad}${n.folder.name}` });
      walk(n.children, depth + 1);
    }
  }
  walk(tree, 0);
  return out;
}
