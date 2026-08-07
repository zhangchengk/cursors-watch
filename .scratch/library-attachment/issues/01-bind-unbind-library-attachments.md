# 01 — Bind / unbind Library attachments on curated entries

**What to build:** In Todo and Archive curation, a user can bind multiple local `.md` files to a marked Chat library entry as **Library attachments** (absolute path references), see an ordered deduped list (basename in the list, full path on hover), unbind any item, and reveal a path in Finder. Binding rejects paths that are missing or not `.md`. Attachments survive todo↔archive moves and are discarded on unmark. Source-Chat **stale** entries still allow managing attachments; after bind, if a file disappears, the row stays and shows a stale/unavailable cue. Reminder mark dialog stays attachment-free.

**Blocked by:** None — can start immediately.

**Status:** done

**Parent:** grilled consensus + `CONTEXT.md` (Library attachment) + `docs/adr/0006-library-attachment-as-path-refs.md`  
**Labels:** `ready-for-agent`  
**Approved test seams:** Library store/hub lifecycle; thin HTTP entry patch for attachment list; Finder reveal as shell side-effect only if easily asserted

- [ ] `LibraryEntry` persists an ordered list of absolute `.md` path attachments (deduped by path string)
- [ ] Todo/Archive UI can add (file picker, multi) and remove attachments on a marked entry
- [ ] Bind validates: existing readable file + `.md` extension (case-insensitive); otherwise reject with clear feedback and do not store
- [ ] Re-adding an already-bound path is a no-op (or light “already bound” feedback), list order otherwise preserved as add order
- [ ] Todo↔archive migration keeps the attachment list; unmark discards it with title/note/folder
- [ ] Stale library entries still show and allow bind/unbind; Open Chat failure behavior unchanged
- [ ] Post-bind missing/unreadable files remain listed with a visible unavailable state
- [ ] Secondary action: reveal the file in Finder
- [ ] Reminder mark-entry dialog does not gain attachment controls
- [ ] Store/hub (and thin HTTP) tests cover validate, dedupe, migrate-keep, unmark-drop

Prototype shape (from grill / ADR):

```ts
// on LibraryEntry
attachments?: string[]; // absolute paths, ordered, unique
```
