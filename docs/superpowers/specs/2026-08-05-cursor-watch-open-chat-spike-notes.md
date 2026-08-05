# Open-Chat Focus Spike Notes

**Spec:** `2026-08-05-cursor-watch-open-chat-design.md` §4  
**Status:** in progress  

## Environment

| Field | Value |
|-------|-------|
| Date | |
| macOS | |
| Cursor version | |
| Extension path | `cursor-watch/extensions/cursor-watch-bridge` |
| Test conversationId | |
| Workspace path | |

## Command dump (composer / chat related)

```text
(paste filtered getCommands output)
```

## Attempts

| # | strategy | command / method | args | ok? | notes |
|---|----------|------------------|------|-----|-------|
| 1 | command | | | | |

## Repeatability

- [ ] Focus succeeded once
- [ ] Switched away / closed agent tab, focused again with same id
- [ ] Second success = repeatable

## Verdict

- [ ] `pass` (command path)
- [ ] `fragile_pass` (CDP only) — needs product re-approval + version pin
- [ ] `fail`

**classifySpikeVerdict inputs used:** (paste JSON of ProbeAttempt[])

**Next:** per spec — pass → product plan; fragile_pass → wait for re-approval; fail → stop or change success criteria.
