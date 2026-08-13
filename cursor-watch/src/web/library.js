export const LIBRARY_TAB_KEY = "cursor-watch-library-tab";
/** localStorage map: `${mark}:${folderId|""}` → false=expanded; true or absent=compact (default) */
export const LIBRARY_CARD_COMPACT_KEY = "cursor-watch.libraryCardCompact";

/** @typedef {"reminder"|"todo"|"archive"} LibraryTab */
/** @typedef {"todo"|"archive"} LibraryMark */

/**
 * @param {unknown} [storage]
 */
function storageOrNull(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

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
 * Stable key for Library card compact per mark + folder ("" = 「全部」).
 * @param {LibraryMark} mark
 * @param {string|null|undefined} folderId
 */
export function libraryCardCompactKey(mark, folderId) {
  return `${mark}:${folderId || ""}`;
}

/**
 * @param {unknown} [storage]
 * @returns {Record<string, boolean>}
 */
export function loadLibraryCardCompactMap(storage) {
  const s = storageOrNull(storage);
  try {
    const raw = s?.getItem?.(LIBRARY_CARD_COMPACT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    /** @type {Record<string, boolean>} */
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, boolean>} map
 * @param {unknown} [storage]
 */
function saveLibraryCardCompactMap(map, storage) {
  try {
    storageOrNull(storage)?.setItem?.(LIBRARY_CARD_COMPACT_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * Default compact. Explicit `false` in prefs means expanded; `true` or absent means compact.
 * @param {LibraryMark} mark
 * @param {string|null|undefined} folderId
 * @param {unknown} [storage]
 */
export function isLibraryCardCompact(mark, folderId, storage) {
  const map = loadLibraryCardCompactMap(storage);
  return map[libraryCardCompactKey(mark, folderId)] !== false;
}

/**
 * @param {LibraryMark} mark
 * @param {string|null|undefined} folderId
 * @param {boolean} compact
 * @param {unknown} [storage]
 */
export function setLibraryCardCompact(mark, folderId, compact, storage) {
  const map = loadLibraryCardCompactMap(storage);
  const key = libraryCardCompactKey(mark, folderId);
  if (compact) delete map[key];
  else map[key] = false;
  saveLibraryCardCompactMap(map, storage);
}

/**
 * Drop compact prefs for deleted folder ids (same mark).
 * @param {LibraryMark} mark
 * @param {Iterable<string>} folderIds
 * @param {unknown} [storage]
 */
export function clearLibraryCardCompactForFolders(mark, folderIds, storage) {
  const map = loadLibraryCardCompactMap(storage);
  let changed = false;
  for (const id of folderIds) {
    const key = libraryCardCompactKey(mark, id);
    if (key in map) {
      delete map[key];
      changed = true;
    }
  }
  if (changed) saveLibraryCardCompactMap(map, storage);
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
 * Sidebar / list filter by folder.
 * @param {Array<{ mark: string, folderId: string|null, conversationId: string }>} entries
 * @param {LibraryMark} mark
 * @param {string|null} folderId — null/"" = 「全部」(all entries for mark); non-null = folder + descendants
 * @param {Array<{ id: string, parentId: string|null, mark?: string }>|undefined} folders
 */
export function entriesInFolder(entries, mark, folderId, folders) {
  const list = entries || [];
  if (folderId == null || folderId === "") {
    return list.filter((e) => e.mark === mark);
  }
  const ids =
    folders && folders.length
      ? descendantFolderIds(folders, folderId)
      : new Set([folderId]);
  return list.filter((e) => e.mark === mark && e.folderId && ids.has(e.folderId));
}

/**
 * Sidebar badge: Chat entry count for a folder (or 「全部」 when folderId is null).
 * Same range as entriesInFolder — includes subtree; always a number (may be 0).
 *
 * @param {Array<{ mark: string, folderId: string|null, conversationId: string }>} entries
 * @param {LibraryMark} mark
 * @param {string|null} folderId
 * @param {Array<{ id: string, parentId: string|null, mark?: string }>|undefined} folders
 */
export function folderChatCount(entries, mark, folderId, folders) {
  return entriesInFolder(entries, mark, folderId, folders).length;
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

/**
 * @param {{ priority?: string }} entry
 * @returns {0|1|2}
 */
export function todoPriorityRank(entry) {
  const p = entry?.priority;
  if (p === "urgent") return 0;
  if (p === "important") return 1;
  return 2;
}

/**
 * Todo lists: urgent → important → none; stable within tier.
 * Archive (and other marks): leave order unchanged.
 * @template {{ priority?: string }} T
 * @param {T[]} entries
 * @param {string} mark
 * @returns {T[]}
 */
export function sortLibraryEntriesForMark(entries, mark) {
  const list = entries || [];
  if (mark !== "todo") return list;
  return list
    .map((e, i) => ({ e, i }))
    .sort((a, b) => todoPriorityRank(a.e) - todoPriorityRank(b.e) || a.i - b.i)
    .map((x) => x.e);
}

/**
 * @param {unknown} query
 * @returns {string}
 */
export function normalizeArchiveSearchQuery(query) {
  return String(query ?? "").trim();
}

/**
 * Archive list search: title / chatName / note, case-insensitive substring.
 * @param {{ title?: string, chatName?: string, note?: string }} entry
 * @param {unknown} query
 */
export function archiveEntryMatchesQuery(entry, query) {
  const q = normalizeArchiveSearchQuery(query);
  if (!q) return true;
  const needle = q.toLowerCase();
  for (const field of [entry?.title, entry?.chatName, entry?.note]) {
    if (typeof field === "string" && field.toLowerCase().includes(needle)) return true;
  }
  return false;
}

/**
 * @template {{ title?: string, chatName?: string, note?: string }} T
 * @param {T[]} entries
 * @param {unknown} query
 * @returns {T[]}
 */
export function filterEntriesByArchiveSearch(entries, query) {
  const list = entries || [];
  if (!normalizeArchiveSearchQuery(query)) return list;
  return list.filter((e) => archiveEntryMatchesQuery(e, query));
}
