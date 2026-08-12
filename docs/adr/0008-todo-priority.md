# Todo priority (urgent / important / none) on Todo only

Todo curation needs a light way to surface what to push next without turning Chat library into a generic task system. We add **Todo priority**: a mutually exclusive three-tier field on **Todo mark** entries only (`紧急` / `重要` / `无`), used to order the Todo list when viewing「全部」or any Library folder.

**Accepted shape:** Sort urgent → important → unmarked; within a tier keep the existing stable entry order. Default `无`. Set only on the Todo curation surface (segmented control on the card, also editable in the edit dialog); Reminder mark-entry dialog stays free of priority. Compact mode still shows the control. Stale Todo entries still sort by and can change priority. Moving Todo→Archive or unmarking **discards** priority; Archive→Todo returns to `无`. Title, note, and attachments keep existing migrate/unmark rules.

**Rejected:** Priority on Archive; independent urgent+important flags or full Eisenhower quadrants for v1; soft-retaining priority across archive; sorting「全部」differently from folders; reordering within a tier by `updatedAt` as the default truth; setting priority at Reminder mark entry; sinking or locking priority on stale entries; conflating Todo priority with Attention queue “紧急度”.
