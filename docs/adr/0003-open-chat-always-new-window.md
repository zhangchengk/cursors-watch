# Always new Cursor window for Open Chat jump (two-phase)

Open Chat jump must not replace the Chat the user is currently viewing **when Cursor actually opens a distinct new window**. We prefer `cursor -n <workspace>` then focus only a newly registered bridge client.

**Measured constraint (Cursor 3.13 / unifiedAgent):** `cursor -n <already-open-folder>` does **not** create a second window or bridge client (renderer count stays 1). In that case waiting only for a "new" client never focuses Chat. Fallback: activate Cursor and focus the **existing** workspace bridge client so Chat still opens.

**Rejected:** blocking forever on a new client that Cursor will not create; falling back to a *different* workspace's window.
