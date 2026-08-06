# Reminder and Chat library as dual primary jobs

cursor-watch’s Reminder job (ADR 0001) stays. We add a parallel primary job: **Chat library** — human marks on Agent Chats as **Todo** or **Archive**, with optional title/note and per-state folder trees — because Cursor’s Agent list lacks directory and annotation, and users need to park “validated but not landed” threads and reopen meaningful finished ones for review or live teaching.

**Accepted shape:** Panel top-level tabs `Reminder` (cold-start default, still inbox-first inside) | `Todo` | `Archive`. One mutually exclusive **Library mark** per Chat. Todo/Archive each have a machine-global, arbitrarily nested folder tree (not shared across marks; state move → unfiled in the target tree). Optional **Library title** + **Library note** (kept on Todo↔Archive moves; discarded on unmark). New marks only from Reminder-tab visible lists (no jump after mark; no full-history search in v1). Full **Library curation** in Todo/Archive tabs. **Stale library entries** when the source Chat is gone. Teaching stays local Open Chat — no export or multi-user library. Still not a general task hub or Cursor sidebar replacement.

**Rejected:** Library as Reminder subordinate only; attention-queue-as-library; simultaneous Todo+Archive on one Chat; one shared folder tree across marks; Todo/Archive as a single “馆藏” tab; auto-delete library rows when the source Chat disappears; v1 history-search mark entry; team-shared or export-first archive.

**Supersedes (partial):** ADR 0001’s claim that Reminder is the *sole* product primary job. Reminder mechanics in 0001 (Turn end, Active loop, delivery, ack, coalescing, hooks gate) remain in force.
