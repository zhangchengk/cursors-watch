# Spec — cursor-watch：Chat purge（会话清理）设计

**Status:** needs-human
**Labels:** `ready-for-agent`
**Date:** 2026-10-14
**Glossary:** `CONTEXT.md`
**Migrated from:** `docs/superpowers/specs/2026-10-14-chat-purge-design.md` (Matt `/to-spec` shape; former superpowers tree removed)

---

## Problem Statement

1. 本机 Cursor `state.vscdb` 可达百 GB 级；侧边栏历史会话极多，手工 Delete 不现实。   2. 对用户有价值的会话已在 Watch **Todo / Archive** 馆藏中；其余无标注历史希望能快速清掉。   3. Watch 今日只读 `composerHeaders`，无任何删会话能力；面板 visibility prune **不**删磁盘。

## Solution

1. **Chat purge**：在面板**设置**中提供维护入口（非第三主职）。   2. **保留集**：Todo mark / Archive mark（含 Stale library entry）一律不清。   3. **候选**：`composerHeaders` 全表中无馆藏标注，且满足月龄阈值，且不在安全排除集。   4. **执行路径**：优先 Cursor 可调删除（等价侧边栏单条 Delete）；**先 Spike 证明按 `conversationId` 可删**，再产品化。   5. 首版成功 = 候选从 Cursor 侧边栏 / composer 历史**消失**；不承诺清备份、不承诺 VACUUM。

## User Stories

1. As a Cursors Watch user, I want **Chat purge**：在面板**设置**中提供维护入口（非第三主职）, so that the product behavior matches CONTEXT.md.
2. As a Cursors Watch user, I want **保留集**：Todo mark / Archive mark（含 Stale library entry）一律不清, so that the product behavior matches CONTEXT.md.
3. As a Cursors Watch user, I want **候选**：`composerHeaders` 全表中无馆藏标注，且满足月龄阈值，且不在安全排除集, so that the product behavior matches CONTEXT.md.
4. As a Cursors Watch user, I want **执行路径**：优先 Cursor 可调删除（等价侧边栏单条 Delete）；**先 Spike 证明按 `conversationId` 可删**，再产品化, so that the product behavior matches CONTEXT.md.
5. As a Cursors Watch user, I want 首版成功 = 候选从 Cursor 侧边栏 / composer 历史**消失**；不承诺清备份、不承诺 VACUUM, so that the product behavior matches CONTEXT.md.

## Implementation Decisions

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 成功标准 | 会话从 Cursor 消失；磁盘缩容为副作用，不承诺备份/VACUUM |
| 2 | 保留集 | Todo + Archive（含失效馆藏） |
| 3 | 产品落点 | Cursors Watch 设置内维护工具 |
| 4 | 删除手段 | 先探针可调单条删除；不先写 vscdb |
| 5 | Spike 过线 | **必须**按 `conversationId` 单条删除；仅有按天批量 ≠ 过线 |
| 6 | 交付节奏 | 独立 Spike → notes → 再开产品 plan |
| 7 | 月龄语义 | 早于 N 个月（`lastUpdatedAt`） |
| 8 | 默认 N | 3；允许「不限月龄」高级选项 |
| 9 | 旁路存储 | 首版不主动清备份 / VACUUM |
| 10 | 安全排除 | LIVE / running / subagent；未确认 Reminder |
| 11 | UX | 预览 + 二次确认；须桥 |
| 12 | 候选宇宙 | `composerHeaders` 全表 |
| 13 | Spike 失败 | 只预览 + 说明；不写库；不降级纯按天命令 |
| 14 | 删后 Watch 侧 | 可清该 id 的 pending Reminder / LIVE 快照；不动馆藏 |

## Testing Decisions

Test external behavior at documented seams (HTTP, prefs, pure helpers); follow prior art in `cursor-watch/tests/`.

## Out of Scope

- 第三主职 / 新顶层 Tab。  
- 清理 `state.vscdb.backup*`、主动 VACUUM。  
- 以孤儿 `agent-transcripts`（无 header）为主候选源。  
- 删除馆藏条目或附件源文件。  
- Marketplace；非 macOS；Cloud Agent。

## Further Notes

Legacy design prose (migrated verbatim, superpowers boilerplate removed):

# cursor-watch：Chat purge（会话清理）设计

状态：设计已定；**Delete 探针 Spike 未跑**  
日期：2026-10-14  
范围：设置内维护工具——按馆藏白名单与月龄批量删除 Cursor 侧无标注历史 Chat；**先 Spike 后产品**  
前置：`CONTEXT.md`（Chat purge / Purge keep set / Purge candidate / Purge age cutoff）、Chat library、`composerHeaders`、桥扩展（open-chat）  
相关：`2026-08-05-cursor-watch-open-chat-design.md`（桥 + `executeCommand` 先例）、`2026-08-06-chat-library-design.md`（保留集来源）

## 1. 问题与目标

### 1.1 痛点

1. 本机 Cursor `state.vscdb` 可达百 GB 级；侧边栏历史会话极多，手工 Delete 不现实。  
2. 对用户有价值的会话已在 Watch **Todo / Archive** 馆藏中；其余无标注历史希望能快速清掉。  
3. Watch 今日只读 `composerHeaders`，无任何删会话能力；面板 visibility prune **不**删磁盘。

### 1.2 目标

1. **Chat purge**：在面板**设置**中提供维护入口（非第三主职）。  
2. **保留集**：Todo mark / Archive mark（含 Stale library entry）一律不清。  
3. **候选**：`composerHeaders` 全表中无馆藏标注，且满足月龄阈值，且不在安全排除集。  
4. **执行路径**：优先 Cursor 可调删除（等价侧边栏单条 Delete）；**先 Spike 证明按 `conversationId` 可删**，再产品化。  
5. 首版成功 = 候选从 Cursor 侧边栏 / composer 历史**消失**；不承诺清备份、不承诺 VACUUM。

### 1.3 硬约束

- 仅 macOS / localhost。  
- 不把直接改 `state.vscdb` 当首选；Spike 失败则首版只预览 + 说明，不写库。  
- 不用 `developer.deleteOldChats`（按天批量）冒充馆藏白名单清理。  
- 执行须 Cursor 在跑且桥已连；预览 → 二次确认；禁止静默清空。  
- 身份键与 open-chat 一致：`conversationId` ≡ `composerHeaders.composerId` ≡ Watch / hooks id。

### 1.4 非目标（首版）

- 第三主职 / 新顶层 Tab。  
- 清理 `state.vscdb.backup*`、主动 VACUUM。  
- 以孤儿 `agent-transcripts`（无 header）为主候选源。  
- 删除馆藏条目或附件源文件。  
- Marketplace；非 macOS；Cloud Agent。

## 2. 决策记录（grilling）

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 成功标准 | 会话从 Cursor 消失；磁盘缩容为副作用，不承诺备份/VACUUM |
| 2 | 保留集 | Todo + Archive（含失效馆藏） |
| 3 | 产品落点 | Cursors Watch 设置内维护工具 |
| 4 | 删除手段 | 先探针可调单条删除；不先写 vscdb |
| 5 | Spike 过线 | **必须**按 `conversationId` 单条删除；仅有按天批量 ≠ 过线 |
| 6 | 交付节奏 | 独立 Spike → notes → 再开产品 plan |
| 7 | 月龄语义 | 早于 N 个月（`lastUpdatedAt`） |
| 8 | 默认 N | 3；允许「不限月龄」高级选项 |
| 9 | 旁路存储 | 首版不主动清备份 / VACUUM |
| 10 | 安全排除 | LIVE / running / subagent；未确认 Reminder |
| 11 | UX | 预览 + 二次确认；须桥 |
| 12 | 候选宇宙 | `composerHeaders` 全表 |
| 13 | Spike 失败 | 只预览 + 说明；不写库；不降级纯按天命令 |
| 14 | 删后 Watch 侧 | 可清该 id 的 pending Reminder / LIVE 快照；不动馆藏 |

## 3. 方案概述

```text
两阶段：
  1) Spike：桥扩展证明 executeCommand（或等价可调 API）可按 conversationId 删除
  2) 产品（仅 pass 后）：设置页候选预览 → 确认 → 桥批量 delete → 刷新 headers

候选（产品）：
  composerHeaders
    − Purge keep set（library todo|archive，含 stale）
    − 未达 Purge age cutoff（默认早于 3 个月；可改；可「不限」）
    − LIVE|running|subagent
    − 有 pending Reminder 的 conversationId
```

## 4. Spike（本阶段唯一实现范围）

### 4.1 已知事实（探针前）

| 事实 | 含义 |
|------|------|
| 侧边栏 Delete = 菜单 `delete-composer` → `ComposerService.deleteComposer` | **不是**已证实的 `vscode.commands` id |
| 已注册 `developer.deleteOldChats` | 按天数批量；**不能**单独作为本 Spike 过线 |
| 桥今日仅 focus（`composer.openComposer`） | 需扩展 dump / delete 探针命令 |
| open-chat 明确不做「Watch 写 state.vscdb」主路径 | 本 Spike 同样禁止写库 |

### 4.2 过线标准

| 结果 | 条件 |
|------|------|
| **pass** | 对用户指定的**无标注**测试 `conversationId`，经扩展 `executeCommand`（或同扩展 API 面可调入口）删除成功；人眼确认侧边栏该 Chat 消失；可重复至少一次 |
| **fail** | 找不到按 id 的可调删除；或仅能跑 `developer.deleteOldChats`；或只能手改 vscdb |

**不做** CDP / 注入脚本删会话（破坏性 + 脆弱，不设 `fragile_pass`）。

### 4.3 Spike 产出

- 计划：`.scratch/plans/2026-10-14-chat-purge-delete-spike.md`  
- 运行记录：`.scratch/specs/2026-10-14-chat-purge-delete-spike-notes.md`  
- 扩展侧：dump 含 `delete*`；delete-by-id 探针；**不**接线设置页 / daemon purge API

### 4.4 Spike 之后

- **pass** → 新开**产品** implementation plan（设置 UI、候选计算、桥 delete RPC、确认流）。  
- **fail** → 停在预览能力或另开「是否写库」grilling；不假装自动删除可用。

## 5. 产品要点（Spike 通过后再详写 plan）

- 入口：Panel settings。  
- 预览：候选数量 + 可抽查列表（名 / id / lastUpdatedAt / 工作区）。  
- 执行：桥按 id 逐条或受控批量删除；进度与失败条数 toast。  
- 删除成功后：daemon 可丢掉该 id 的 pending Reminder 与 LIVE 快照文件。  
- 文案须区分 Cursor「Archive Prior Chats」与馆藏 Archive mark。

## 6. 风险

| 风险 | 缓解 |
|------|------|
| Cursor 升级后删除命令消失或改名 | 版本记录在 notes；运行时探测命令存在；失败明确 toast |
| 误删馆藏会话 | 产品层硬过滤 keep set；Spike 只用无标注测试 id |
| 末条会话走 `resetComposer` 而非 delete | Spike 笔记记录行为；产品避免清到「只剩一条」的边界或显式跳过 |
| 删除不缩 `state.vscdb` 文件体积 | 与成功标准一致：不承诺；日后可另开运维文档 |

