# Library card compact + shared panel list columns

Todo/Archive lists grow tall with Library note and Library attachment blocks. We add a **Library card compact** view mode (hide note + attachments; keep title and action bar) so users can scan more entries, and we extend the topbar column control into **Panel list columns** shared by Reminder and Todo/Archive.

**Accepted shape:** Compact is list-level per **Library folder** (including「全部」), with Todo and Archive trees separate; default expanded; **manual only**—no auto density on first folder open. Compact preference is machine panel chrome (same class as column count), not library content. Panel list columns use one shared N across Reminder and library lists, **hard-orthogonal** to compact: expanded library cards still lay out in N columns; expanding does not clamp or rewrite N.

**Rejected:** Auto-fold from entry/rich-content/viewport heuristics; Todo/Archive sharing one compact switch; per-card collapse as the primary control; hiding only attachments while leaving notes; storing compact flags in library.json; separate column prefs per tab; remapping `+/-` to mean compact on library tabs; forcing single-column (or lowering N) when a folder is expanded.

**Superseded (default only):** 「默认展开」由 [0010](./0010-library-card-compact-default-and-scan-height.md) 改为默认紧凑；共享列数与其余边界仍有效。
