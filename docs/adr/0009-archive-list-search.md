# Archive list search (folder-scoped, session-only)

Archive curation needs a way to find entries by title/note without browsing the whole tree. We add **Archive list search**: a text filter on the Archive stage only.

**Accepted shape:** Search runs *after* the current folder view（「全部」or selected Library folder + descendants）. Match is case-insensitive substring on Library title, chatName, and Library note. Empty query means no extra filter. The input sits in the list header beside Collapse/Expand; the query is session-only (not prefs/library). Changing folders keeps the query; leaving the Archive tab clears it. Sidebar folder counts stay full inventory (not hit counts). Empty results show a clearable empty state. Not available on Todo in this version; does not search workspace paths, attachment paths, or attachment file bodies; is not “pick a Chat from Cursor history to mark.”

**Rejected:** Todo+Archive shared global search for v1; ignoring the folder selection when a query is present; full-text scan of attached `.md` files; persisting the query across restarts; driving sidebar counts from search hits; conflating list search with Reminder-side historical Chat pick for marking.
