# Library attachment as path references (not content snapshots)

Todo/Archive library entries may bind multiple local `.md` files as **Library attachments**. We store **absolute path references** on the entry and read from disk for **Attachment preview**, not copies under `~/.cursor-watch`. Path refs stay small, stay in sync with the source of truth, and match single-machine informal-app use; the trade-off is missing/moved files show as stale until the user rebinds.

**Accepted shape:** Ordered, deduped path lists on marked entries; bind only existing readable `.md`; manage bind/unbind and in-panel read-only preview under Todo/Archive curation (not Reminder mark dialog); keep attachments across todo↔archive; discard on unmark; stale Chat still allows attachment preview; Finder reveal as secondary action.

**Rejected:** Content snapshots/copies into the watch home; workspace-only path restriction for v1; binding at Reminder mark entry; soft-retain attachments after unmark; external/Cursor edit as the primary preview path.

**Superseded (scope + preview channel):** 仅 `.md` 与「预览绝不走默认 App」由 [0011](./0011-library-attachment-html-and-preview-split.md) 扩展；路径引用、不落内容副本、整理面绑定等其余边界仍有效。
