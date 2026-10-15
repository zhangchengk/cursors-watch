# 01 — Chat purge — Delete 探针 Spike Notes

**What to build:** Record spike / probe evidence; no product wiring unless spec says pass.

**Blocked by:** None

**Status:** done

**Parent:** `.scratch/chat-purge/issues/00-spec-chat-purge.md`

# Chat purge — Delete 探针 Spike Notes

**Spec:** `2026-10-14-chat-purge-design.md` §4  
**Plan:** `2026-10-14-chat-purge-delete-spike.md`  
**Status:** fail  

## Environment

| Field | Value |
|-------|-------|
| Date | 2026-10-14 |
| macOS | darwin（本机） |
| Cursor version | 3.24.18（此前 CLI） |
| Extension | `cursor-watch.cursor-watch-bridge@0.1.6`（文件触发 auto probe） |
| Test conversationId | `afa5277a-3810-4d0a-b76d-0391cd833d89`（Implement Task 9 web UI；无标注） |
| Workspace path | `/Users/zhangcheng/idea/Cursors` |
| Result file | `~/.cursor-watch/spike-delete-result.json` |

## Command dump（delete / remove 相关）

181 interesting；含 `developer.deleteOldChats`。**无** `composer.deleteComposer` / 其它按 id 删除 command。侧边栏菜单 id `delete-composer` **未**注册为 `vscode.commands`。

**Age-batch（对照，不得单独标 pass）：**

- [x] `developer.deleteOldChats` 出现在 dump  
- [x] 未为过线而执行全库按天清理

**可疑 per-id 候选：**

- （无）

## Attempts

| # | strategy | command / method | args | ok? | notes |
|---|----------|------------------|------|-----|-------|
| 1–5 | command | `delete-composer` | string / string,true / {composerId\|conversationId\|id} | no | `command 'delete-composer' not found` |

## Repeatability

- [ ] 删除成功一次（人眼：侧边栏该 Chat 消失）  
- [ ] 第二次（同 id 已无则换另一无标注 id）成功  
- [x] 未对馆藏 Todo/Archive id 探针

## Verdict

- [ ] `pass`（按 conversationId 的 command 路径）  
- [x] `fail`

**Verdict status:** **fail**

外部核对：`composerHeaders` 仍有该 id；transcript jsonl 仍在。会话**未**被删掉。

**classifySpikeVerdict 输入：**

```json
[
  {"strategy":"command","ok":false,"detail":"delete-composer * not found"}
]
```

## Recommendation

- **fail（已确认）:** 按设计：首版不装假自动删除；可做候选预览 + 说明。若要真正腾盘/清会话，需另开 grilling：**是否受控写 `state.vscdb`**，或继续挖非 command 入口（扩展通常够不到 `ComposerService.deleteComposer`）。  
- 不要用 `developer.deleteOldChats` 冒充馆藏白名单清理。  
- 钉版本：Cursor **3.24.x** + bridge **0.1.6**；大版本升级后可重跑 dump。

