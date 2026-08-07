# Spec — Workspace alias（工作区别名）via Panel settings

**Status:** ready-for-agent  
**Labels:** `ready-for-agent`  
**Date:** 2026-08-07  
**Glossary:** `CONTEXT.md`  
**ADRs:** `docs/adr/0005-workspace-alias-as-machine-prefs.md`  
**Approved test seams:** Watch prefs persistence (`workspaceAliases`); display resolve pure helper; thin HTTP `/api/prefs` merge/validation

---

## Problem Statement

As a Cursors Watch user, Reminder cards and other panel surfaces show long absolute workspace paths (for example `/Users/…/idea/datad-release/dated`). Several Cursor workspaces look similar at a glance, so I cannot tell which engineering context a card belongs to without reading the full path. I want to assign short nicknames to workspaces I already use, and see those nicknames consistently across the panel, without changing how Cursor or Open Chat identify the real path.

## Solution

Add **Panel settings** opened from a gear control in the panel top bar. In v1 the settings shell only ships **Workspace alias** management: for each known workspace absolute path, I can set a nickname, edit it, or explicitly delete it. Aliases are **machine prefs** (same lifetime family as notification sound), applied as a **display-layer overlay** with **exact path match**. Surfaces that show the engineering place (Reminder cards, drawer, Todo/Archive entry meta, and any other in-panel workspace display) prefer the alias when present; otherwise they keep showing the full absolute path. Hover/`title` may still expose the real path. System notification and HUD copy are unchanged in v1.

## User Stories

1. As a Cursors Watch user, I want a gear control in the panel top bar, so that I can open configuration without hunting through menus.
2. As a Cursors Watch user, I want the gear to open a settings shell titled as settings (not a one-off “alias tool”), so that more preferences can be added later without a new entry point.
3. As a Cursors Watch user, I want v1 settings to show a Workspace alias section, so that I can manage nicknames immediately.
4. As a Cursors Watch user, I want notification sound and column controls to stay where they are in v1, so that opening settings does not force a prefs migration of the whole chrome.
5. As a Cursors Watch user, I want to assign a nickname to a workspace absolute path, so that Reminder cards are easier to scan.
6. As a Cursors Watch user, I want the same nickname to appear in the session drawer’s engineering line, so that detail view matches the card.
7. As a Cursors Watch user, I want the same nickname to appear on Todo and Archive entry source lines, so that library curation uses the same language as Reminder.
8. As a Cursors Watch user, I want every other in-panel place that shows the workspace place to use the same overlay rule, so that I never see mixed nickname vs full path for the same workspace inside the panel.
9. As a Cursors Watch user, I want hover or `title` on the displayed place to still reveal the absolute path, so that I can verify which folder it really is.
10. As a Cursors Watch user, I want Open Chat and other path-consuming actions to keep using the real absolute path, so that nicknames never break jumping into Cursor.
11. As a Cursors Watch user, I want alias matching to require an exact absolute path string match, so that a parent folder nickname does not silently apply to a nested workspace.
12. As a Cursors Watch user, I want workspaces without an alias to keep showing the full absolute path (as Reminder cards do today), so that enabling the feature does not suddenly shorten every card.
13. As a Cursors Watch user, I want changing an alias to update all panel surfaces immediately, so that I do not re-mark chats or restart the app to see the new name.
14. As a Cursors Watch user, I want clearing or deleting an alias to restore full-path display everywhere, so that removal is reversible and obvious.
15. As a Cursors Watch user, I want aliases stored as machine prefs alongside notification sound, so that library unmark/clear does not wipe nicknames.
16. As a Cursors Watch user, I want aliases to survive when a workspace temporarily disappears from the live session list, so that closing Cursor windows does not delete my nicknames.
17. As a Cursors Watch user, I want settings to list candidate paths from the union of current scanned sessions, pending Reminders, and Chat library entries, so that I configure nicknames for workspaces the panel already knows.
18. As a Cursors Watch user, I want settings to also list paths that already have a saved alias even if they are not in that union right now, so that I can still edit or delete them.
19. As a Cursors Watch user, I do not want a free-form “paste any path” control in v1, so that aliases stay tied to paths the product has actually seen.
20. As a Cursors Watch user, I want each settings row to show the absolute path as read-only context, so that I know what the nickname maps to.
21. As a Cursors Watch user, I want an editable nickname field per row, so that I can type a short label.
22. As a Cursors Watch user, I want an explicit delete control to remove an alias, so that removing a nickname is intentional.
23. As a Cursors Watch user, I want saving an existing alias with an empty nickname to be rejected with guidance to use delete, so that empty-save cannot silently fail to remove or corrupt the mapping.
24. As a Cursors Watch user, I want newly typed nicknames to be trim-normalized and non-empty when saved, so that whitespace-only labels are not stored.
25. As a Cursors Watch user, I want two different absolute paths to be able to have different nicknames, so that similarly named projects stay distinguishable.
26. As a Cursors Watch user, I want two different absolute paths to be allowed to share the same nickname text if I choose, so that the product does not invent uniqueness rules I did not ask for.
27. As a Cursors Watch user, I want system notification and HUD Reminder copy to remain unchanged in v1, so that delivery text does not depend on unfinished alias coverage.
28. As a Cursors Watch user, I want auto-shortened `workspaceLabel` values from the scanner to remain internal fallbacks, not user aliases, so that product language stays clear.
29. As a Cursors Watch user, I want Library title and Library note to remain separate from Workspace alias, so that chat annotation is not confused with engineering nicknames.
30. As a Cursors Watch user, I want Library folders to remain separate from Workspace alias, so that curation trees are not overloaded as path nicknames.
31. As a developer, I want prefs load to treat a missing `workspaceAliases` field as an empty map, so that existing `prefs.json` files keep working.
32. As a developer, I want prefs save/update to merge notification sound and aliases without forcing the client to resend both every time, so that the existing sound toggle does not wipe aliases.
33. As a developer, I want deleting an alias to mean omitting that path key from the stored map, so that “no overlay” has a single representation.
34. As a developer, I want display resolution to be a pure helper over path + alias map, so that Reminder, drawer, and library UIs cannot drift.
35. As a developer, I want HTTP prefs tests to cover merge and empty-value rejection, so that the API contract stays agent-testable at the existing prefs seam.
36. As a Cursors Watch user, I want settings to remain usable from the Menubar shell WebView (no `window.prompt` dependency for core flows), so that macOS panel constraints already learned for library dialogs still hold.
37. As a Cursors Watch user, I want keyboard focus and dismiss behavior on the settings dialog to be sane (close without saving discards unsaved edits; save persists), so that the settings shell feels safe.
38. As a Cursors Watch user, I want stale library entries that still carry a workspace path to participate in the known-path union, so that I can nickname engineering contexts that only survive as library rows.
39. As a Cursors Watch user, I want pending Reminder rows with a workspace path to appear in the candidate list even if the session is not in the running set, so that inbox-only contexts are configurable.
40. As a Cursors Watch user, I want the feature to remain localhost / single-machine only, so that aliases are not implied to sync across machines or teammates.

## Implementation Decisions

- Extend machine **Watch prefs** with a `workspaceAliases` map: keys are absolute workspace paths (exact match); values are trimmed non-empty nickname strings. Missing field on load ⇒ empty map.
- Prefer extending the existing prefs load/save and `/api/prefs` surface over a new aliases file or library document (ADR 0005).
- `PUT /api/prefs` becomes a **partial merge**: clients may send `notificationSound` and/or `workspaceAliases`. Omitted fields keep previous values. When `workspaceAliases` is sent, it replaces the alias map wholesale for that request (settings save submits the map after edits/deletes).
- Reject empty or non-string nickname values for any key present in a submitted `workspaceAliases` object (HTTP 400). Deletion is expressed by absence of the key in the submitted map, not by empty string.
- Candidate path list for the settings UI is computed on the client from the union of: current sessions’ workspace paths, pending reminders’ workspace paths, library entries’ workspace paths, plus every key already present in `workspaceAliases`.
- No free-form path entry in v1.
- Introduce one display resolve helper used by all in-panel workspace place renderers: alias if exact key hit, else absolute path when available, else existing label fallback. Real path remains available for `title`/tooltip and for Open Chat payloads.
- Panel settings UI: gear in top bar → modal/dialog settings shell with a Workspace alias section; rows show read-only path, nickname field, explicit delete for rows that have (or will remove) an alias; empty nickname on save for an existing alias is blocked in UI with copy pointing at delete.
- Sound toggle and column controls stay in the top bar in v1; settings shell is structurally ready for later sections.
- Notification / HUD Reminder text does not resolve aliases in v1.
- Prototype shape (decision-rich excerpt):

```ts
type WatchPrefs = {
  notificationSound: boolean;
  workspaceAliases: Record<string, string>; // path → nickname
};

function displayWorkspacePlace(
  workspacePath: string | undefined,
  workspaceLabel: string | undefined,
  aliases: Record<string, string>,
): { text: string; titlePath: string } {
  const path = (workspacePath || "").trim();
  if (path && aliases[path]) return { text: aliases[path], titlePath: path };
  if (path) return { text: path, titlePath: path };
  const label = (workspaceLabel || "").trim();
  return { text: label || "—", titlePath: label };
}
```

## Testing Decisions

- Good tests assert external behavior at the approved seams: persisted prefs round-trip and defaults; display helper inputs/outputs; HTTP merge and validation status codes/bodies. Do not assert CSS class names, dialog markup structure, or private renderer internals.
- Modules/behaviors under test: Watch prefs persistence for `workspaceAliases`; display resolve helper; `/api/prefs` GET/PUT merge and empty-value rejection.
- Prior art: existing prefs unit/API tests around `notificationSound`; pure helper tests in the web library helpers style; server prefs route tests.
- Settings candidate-union and dialog chrome may be covered lightly or by manual acceptance; do not invent a second storage seam for UI-only assembly unless a pure union helper is extracted and then unit-tested at that helper only.

## Out of Scope

- Free-form entry of paths never seen by sessions/reminders/library.
- Prefix / longest-prefix alias inheritance.
- Applying aliases to system notification or HUD copy in v1.
- Moving notification sound, column count, fullscreen, or login items into the settings shell in v1.
- Syncing aliases across machines, accounts, or teammates.
- Renaming Cursor-side project or chat names.
- Treating Workspace alias as Library folder, Library title, or Library note.
- Replacing absolute-path default display with auto-shortened labels when no alias exists.

## Further Notes

- Product language: **Workspace alias**, **Panel settings**; see `CONTEXT.md`. Architectural home: ADR 0005.
- This supersedes the informal design draft discussed in chat only insofar as this published spec is the agent-facing source of truth for implementation tickets.
- After implementation, rebuild/reinstall the Informal app remains the delivery path for Menubar shell users (`package:app:install`), consistent with existing Informal app practice.
