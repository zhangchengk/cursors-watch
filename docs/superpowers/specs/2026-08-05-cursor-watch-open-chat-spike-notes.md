# Open-Chat Focus Spike Notes

**Spec:** `2026-08-05-cursor-watch-open-chat-design.md` §4  
**Status:** in progress  

## Environment

| Field | Value |
|-------|-------|
| Date | 2026-08-05 |
| macOS | darwin 25.6.0 |
| Cursor version | 3.13.25 (31e8d61c448c7472e371505838a0fe34083dad50, arm64) |
| Extension path | `cursor-watch/extensions/cursor-watch-bridge` |
| Test conversationId | |
| Workspace path | |

## Command dump (composer / chat related)

Cursor 3.13.25 — 176 interesting commands. **Key finds:**

- `canvas.openAgentByConversationId` ← primary candidate (was missing from first probe list)
- `composer.getComposerHandleById`
- `composer.focusComposer` / `composer.openComposer` / `composer.openChatAsEditor`
- `workbench.action.backgroundComposer.openCloudAgentById` (cloud only)
- `workbench.action.openAgentsView` / `composer.showComposerHistory`

Full paste kept in user chat / extension Output. Probe updated to prefer `canvas.openAgentByConversationId` first.


## Attempts

> **pending manual acceptance** — live Cursor visual focus confirmation not run in this agent environment. Do not treat empty rows as pass/fail.

| # | strategy | command / method | args | ok? | notes |
|---|----------|------------------|------|-----|-------|
| 1 | command | | | | **pending manual acceptance** |

## Repeatability

> **pending manual acceptance** — repeatability not verified in agent environment.

- [ ] Focus succeeded once — **pending manual acceptance**
- [ ] Switched away / closed agent tab, focused again with same id — **pending manual acceptance**
- [ ] Second success = repeatable — **pending manual acceptance**

## Verdict

- [ ] `pass` (command path)
- [ ] `fragile_pass` (CDP only) — needs product re-approval + version pin
- [ ] `fail`

**Verdict status:** **pending manual acceptance** (no invented pass/fail)

**classifySpikeVerdict inputs used:** (paste JSON of ProbeAttempt[])

**Next:** per spec — pass → product plan; fragile_pass → wait for re-approval; fail → stop or change success criteria. After manual Step 4, fill Attempts/Repeatability and tick a Verdict.
