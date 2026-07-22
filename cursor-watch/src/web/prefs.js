export const DEFAULT_VIEW_MODE = "attention";
export const DEFAULT_ATTENTION_COLUMNS = 2;
export const MIN_ATTENTION_COLUMNS = 1;
export const MAX_ATTENTION_COLUMNS = 4;
export const NARROW_VIEWPORT_PX = 720;

const KEY_MODE = "cursor-watch.viewMode";
const KEY_COLS = "cursor-watch.attentionColumns";

function storageOrNull(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function clampAttentionColumns(n) {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return DEFAULT_ATTENTION_COLUMNS;
  const i = Math.trunc(x);
  if (i < MIN_ATTENTION_COLUMNS || i > MAX_ATTENTION_COLUMNS) {
    return DEFAULT_ATTENTION_COLUMNS;
  }
  return i;
}

export function loadPrefs(storage) {
  const s = storageOrNull(storage);
  let viewMode = DEFAULT_VIEW_MODE;
  let attentionColumns = DEFAULT_ATTENTION_COLUMNS;
  try {
    const m = s?.getItem?.(KEY_MODE);
    if (m === "attention" || m === "workspace") viewMode = m;
    const c = s?.getItem?.(KEY_COLS);
    if (c != null) attentionColumns = clampAttentionColumns(c);
  } catch {
    /* keep defaults */
  }
  return { viewMode, attentionColumns };
}

export function saveViewMode(mode, storage) {
  if (mode !== "attention" && mode !== "workspace") return;
  try {
    storageOrNull(storage)?.setItem?.(KEY_MODE, mode);
  } catch {
    /* ignore */
  }
}

export function saveAttentionColumns(n, storage) {
  const c = clampAttentionColumns(n);
  try {
    storageOrNull(storage)?.setItem?.(KEY_COLS, String(c));
  } catch {
    /* ignore */
  }
}

export function effectiveAttentionColumns(storedN, viewportWidth) {
  if (Number(viewportWidth) < NARROW_VIEWPORT_PX) return 1;
  return clampAttentionColumns(storedN);
}
