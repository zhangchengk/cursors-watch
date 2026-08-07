/**
 * Display-layer Workspace alias overlay (exact path match).
 * @param {string|undefined|null} workspacePath
 * @param {string|undefined|null} workspaceLabel
 * @param {Record<string, string>|undefined|null} aliases
 * @returns {{ text: string, titlePath: string }}
 */
export function displayWorkspacePlace(workspacePath, workspaceLabel, aliases) {
  const path = typeof workspacePath === "string" ? workspacePath.trim() : "";
  const map =
    aliases && typeof aliases === "object" && !Array.isArray(aliases) ? aliases : {};
  if (path) {
    const nick = map[path];
    if (typeof nick === "string" && nick.trim()) {
      return { text: nick.trim(), titlePath: path };
    }
    return { text: path, titlePath: path };
  }
  const label = typeof workspaceLabel === "string" ? workspaceLabel.trim() : "";
  return { text: label || "—", titlePath: label };
}

/**
 * Candidate paths for Panel settings alias rows.
 * @param {{
 *   sessions?: Array<{ workspacePath?: string }>,
 *   reminders?: Array<{ workspacePath?: string }>,
 *   libraryEntries?: Array<{ workspacePath?: string }>,
 *   aliases?: Record<string, string>,
 * }} sources
 * @returns {string[]}
 */
export function collectKnownWorkspacePaths(sources = {}) {
  const set = new Set();
  const add = (p) => {
    const t = typeof p === "string" ? p.trim() : "";
    if (t) set.add(t);
  };
  for (const s of sources.sessions || []) add(s.workspacePath);
  for (const r of sources.reminders || []) add(r.workspacePath);
  for (const e of sources.libraryEntries || []) add(e.workspacePath);
  for (const k of Object.keys(sources.aliases || {})) add(k);
  return [...set].sort((a, b) => a.localeCompare(b));
}
