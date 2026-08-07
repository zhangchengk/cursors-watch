# Workspace alias as machine prefs (not Chat library)

Panel **Workspace aliases** (path → nickname, display-layer overlay) belong with **machine prefs** alongside notification sound, not with Chat library state. Aliases name how the user *calls* a workspace; library entries are marks/notes on *chats*. Clearing or unmarking library must not delete nicknames; backing up prefs should carry aliases without dragging library content.

**Accepted shape:** Gear opens extensible **Panel settings**; aliases live in machine prefs with notification sound and **uiTheme** (four switchable panel skins). Exact path match; no alias → keep full absolute path. Candidate paths from live sessions ∪ pending reminders ∪ library entries; no free-form unknown paths; saved aliases persist when a path temporarily disappears. Explicit delete to remove; empty nickname on an existing alias is rejected.

**Rejected:** Storing aliases inside library.json; writing nicknames onto reminder/library row snapshots; prefix inheritance; v1 covering notification/HUD copy; free-form path entry; emptying the nickname field as implicit delete.
