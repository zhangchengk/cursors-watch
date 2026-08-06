# Reminder over attention as cursor-watch’s primary job

> **Partial supersession:** ADR 0004 adds **Chat library** as a *second* primary job (Todo/Archive tabs). Reminder remains a primary job and the Turn-end / Active-loop / delivery rules below still apply. Only the “Reminder is the sole primary job / attention is the only secondary narrative” framing is narrowed.

cursor-watch started as a situational-awareness / attention queue. We are pivoting the product primary job to **Reminder**: when a conversation reaches **Turn end** and is not in an **Active loop**, interrupt the user via OS notification (inbox on the panel as the durable copy).

**Why:** Keeping the Cursor chat window focused often yields no unread badge, so unread-based cues miss real “your turn / round finished” moments. Scanning an attention wall is not the same as being called. `/loop` keeps sentinel processes alive across Cursor `stop` events; treating every `stop` as done would false-alarm during loop naps.

**Accepted shape:** Turn end (hooks `stop`) triggers Reminder, not unread. Active loop is detected via a per-conversation **Loop ledger** (bookkeeping on `preToolUse` when the shell looks like `AGENT_LOOP_TICK_*` / `AGENT_LOOP_WAKE_*`). Delivery is OS notification + inbox-first panel **within the Reminder tab**; ack via panel or notification click; coalesce per conversation; deep link defaults to the panel (open Cursor workspace secondary). No focus-based suppression (multi-monitor / multi-Cursor stay foreground). Notifications are silent by default (sound opt-in). Without hooks: no OS Reminder—prompt to install; legacy unread signals may still show but are not Reminder. `open` still does not auto-install hooks.

**Rejected:** Attention-queue-as-primary; unread-only triggers; transcript-only `/loop` detection; engineering-wide “any loop suppresses all chats”; sound-on-by-default; suppressing notifies when Cursor is frontmost; assuming hooks always expose background PIDs (ledger uses process-table match, with optional conversationId markers in argv/env as a stronger bind).
