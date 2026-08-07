# 02 — In-panel Attachment preview

**What to build:** From a Todo/Archive attachment row, the user opens an **Attachment preview**: in-panel read-only Markdown rendering of the bound file. Each open re-reads from disk. Missing or unreadable files show a clear failure state (aligned with the list’s unavailable cue). The server only serves file content for paths that are currently attached to that entry. Closing preview leaves the user on the same Todo/Archive tab. No default-app or Cursor open as the primary path.

**Blocked by:** 01 — Bind / unbind Library attachments on curated entries

**Status:** done

**Parent:** grilled consensus + `CONTEXT.md` (Attachment preview) + `docs/adr/0006-library-attachment-as-path-refs.md`  
**Labels:** `ready-for-agent`  
**Approved test seams:** Thin HTTP preview read gated by entry attachment membership; missing-file error contract (Markdown render is UI)

- [ ] Attachment list exposes a primary Preview action per row
- [ ] Preview opens in-panel as read-only rendered Markdown (headings, lists, code blocks at minimum)
- [ ] Preview content is loaded from disk at open time (path reference, not a stored snapshot)
- [ ] Preview of a path not attached to that entry is rejected (404/403-class); attached-but-missing file returns an explicit unread failure
- [ ] Closing preview returns to the same library tab/entry context
- [ ] No v1 requirement for “open in default app” or “open in Cursor”
- [ ] HTTP (or hub) tests cover allow-listed path vs foreign path vs missing file

