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

```text
pending manual dump

(VSIX installed via CLI: cursor-watch.cursor-watch-bridge.
Live GUI dump requires Reload Window + Command Palette →
"Cursors Watch Bridge: Dump composer/chat commands" —
paste Output channel "Cursors Watch Bridge" here.)
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
