# Open-Chat Focus Spike Notes

**Spec:** `2026-08-05-cursor-watch-open-chat-design.md` §4  
**Status:** pass  

## Environment

| Field | Value |
|-------|-------|
| Date | 2026-08-05 |
| macOS | darwin 25.6.0 |
| Cursor version | 3.13.25 (31e8d61c448c7472e371505838a0fe34083dad50, arm64) |
| Extension path | `cursor-watch/extensions/cursor-watch-bridge` |
| Test conversationId | User-confirmed local Agent UUID from Watch `/api/sessions` (e.g. 冒烟 / Cursors workspace cards) |
| Workspace path | Per session under test (opened in Cursor before focus) |

## Command dump (composer / chat related)

Cursor 3.13.25 — 176 interesting commands. **Key finds:**

- `canvas.openAgentByConversationId` ← **winning command** (string arg)
- `composer.getComposerHandleById`
- `composer.focusComposer` / `composer.openComposer` / `composer.openChatAsEditor`
- `workbench.action.backgroundComposer.openCloudAgentById` — **wrong surface** (Cloud Agent `bc-*`); blocked from probe
- `workbench.action.openAgentsView` / `composer.showComposerHistory`

## Attempts

| # | strategy | command / method | args | ok? | notes |
|---|----------|------------------|------|-----|-------|
| 1 | command | `canvas.openAgentByConversationId` | string conversationId | **yes** | narrow probe; visual=true; Spike pass |
| — | (dead end) | `openCloudAgentById` / backgroundComposer | — | no | Opened "Open Cloud Agent by ID" UI; blocked in later probe |
| — | (dead end) | `canvas.openAgentByConversationId` misuse / prompts | — | no | Earlier multi-probe also surfaced `http://go/prompts/?requestId=…` trust dialog; cancel; not a local Chat focus |

## Repeatability

- [x] Focus succeeded once (human: visual=true, verdict pass)
- [ ] Switched away / closed agent tab, focused again with same id — **recommend one more manual repeat before product wiring**
- [ ] Second success = repeatable — pending one more human confirm

## Verdict

- [x] `pass` (command path)
- [ ] `fragile_pass` (CDP only) — needs product re-approval + version pin
- [ ] `fail`

**Verdict status:** **pass** — CDP not attempted.

**classifySpikeVerdict inputs used:**

```json
[
  {
    "strategy": "command",
    "ok": true,
    "detail": "canvas.openAgentByConversationId string no-throw; visual=true"
  }
]
```

## Recommendation

- **pass:** open **product** implementation plan next (extension registers with daemon, `POST /api/open-chat`, panel `↗`, default install hooks+VSIX) — new plan file; do not extend this spike plan.
- Winning contract to encode in product: `vscode.commands.executeCommand("canvas.openAgentByConversationId", conversationId)` with **string** id (Watch `SessionState.id`).
- Pin note: verified on Cursor **3.13.25**; treat as semi-internal API — add version check / clear toast if command missing after upgrade.
- Before product merge: optionally re-run narrow focus once more for repeatability checkbox.
- Task 4 CDP: **skipped**.
