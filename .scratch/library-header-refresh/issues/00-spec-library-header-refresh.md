# Spec — cursor-watch：Library header refresh（馆藏时间刷新）设计

**Status:** needs-human
**Labels:** `ready-for-agent`
**Date:** 2026-10-15
**Glossary:** `CONTEXT.md`
**Migrated from:** `docs/superpowers/specs/2026-10-15-library-header-refresh-design.md` (Matt `/to-spec` shape; former superpowers tree removed)

---

## Problem Statement

1. 用户希望用 Cursor **`Delete Old Chats…`**（按天）清理大量旧会话，同时 **保留** Watch 里 Todo / Archive 馆藏。   2. 该命令按 **`lastUpdatedAt ?? createdAt`** 筛选；馆藏 Chat 往往很旧，会被误删。   3. Watch 今日 **只读** `state.vscdb`，无法帮用户「刷时间」。

## Solution

1. **Library header refresh**：对 `library.json` 中 **全部 Todo + Archive**（含 Stale）在 **`composerHeaders`** 写入 **同一时刻** 的 `lastUpdatedAt`（`Date.now()`）。   2. 成功后引导用户在 Cursor 内自行 **Reload** + **`Delete Old Chats…`**（Watch **不代删**）。   3. 入口：**面板设置 → 维护**；与 Chat purge **同区**；purge 首版 **仅占位说明**（spike fail 后无自动删）。

## User Stories

1. As a Cursors Watch user, I want **Library header refresh**：对 `library.json` 中 **全部 Todo + Archive**（含 Stale）在 **`composerHeaders`** 写入 **同一时刻** 的 `lastUpdatedAt`（`Date.now()`）, so that the product behavior matches CONTEXT.md.
2. As a Cursors Watch user, I want 成功后引导用户在 Cursor 内自行 **Reload** + **`Delete Old Chats…`**（Watch **不代删**）, so that the product behavior matches CONTEXT.md.
3. As a Cursors Watch user, I want 入口：**面板设置 → 维护**；与 Chat purge **同区**；purge 首版 **仅占位说明**（spike fail 后无自动删）, so that the product behavior matches CONTEXT.md.

## Implementation Decisions

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 目的 | 清理流程一步：刷时间 → 用户 Delete Old Chats |
| 2 | 入口 | 面板设置维护区 |
| 3 | 范围 | 全部 Todo/Archive；无 header 则跳过报告 |
| 4 | 写库 | 仅 `lastUpdatedAt`；Cursor 退出后写 |
| 5 | 时间戳 | 单次操作统一 `Date.now()` |
| 6 | 时钟说明 | 与 Cursor 对齐：`lastUpdatedAt ?? createdAt`（文档/后续 purge 模拟） |
| 7 | Cursor 运行 | 硬拒绝 |
| 8 | 预览 | 条数 + 跳过 + 抽样列表 |
| 9 | 成功后 | 引导 Reload + Delete Old Chats |
| 10 | CLI | `library refresh-headers` |
| 11 | 备份 | 不自动备份 |
| 12 | 确认 | 文案警告，不强制勾选 |
| 13 | API | `POST …/library-header-refresh` + `dryRun` |
| 14 | prefs | 记录上次刷新摘要 |
| 15 | 失败策略 | 尽量多成功，不整批回滚 |
| 16 | UI | 预览 → 执行 两按钮 |
| 17 | 平台 | macOS only |
| 18 | purge | 同区占位，本 plan 不交付删会话 |

## Testing Decisions

- [ ] dryRun 返回正确计数与抽样  
- [ ] Cursor 运行时 apply 409  
- [ ] 退出 Cursor 后 apply：Todo/Archive 对应行 `lastUpdatedAt` 为 batchTs  
- [ ] 无 header 的馆藏 id 在 skipped 中  
- [ ] prefs 写入 last 摘要  
- [ ] CLI 与 API 行为一致  
- [ ] 设置页两按钮 + purge 占位

## Out of Scope

- 删除会话、VACUUM、改 KV、刷 transcript mtime。  
- Todo/Archive Tab 主入口。  
- 自动跑 `developer.deleteOldChats`。  
- 全机「按天删旧」模拟预览（可后续加）。

## Further Notes

Legacy design prose (migrated verbatim, superpowers boilerplate removed):

# cursor-watch：Library header refresh（馆藏时间刷新）设计

状态：设计已定（grilling 确认）  
日期：2026-10-15  
范围：面板设置 **维护** 区——在 Cursor 退出后批量更新 Todo/Archive 馆藏对应 `composerHeaders.lastUpdatedAt`  
前置：`CONTEXT.md`（Library header refresh、Chat purge）、`library.json`、`chat-names.ts`（只读 composerHeaders 先例）  
相关：`2026-10-14-chat-purge-design.md`（删会话仍搁置；本能力与 purge **同区不同按钮**）、ADR-0013

## 1. 问题与目标

### 1.1 痛点

1. 用户希望用 Cursor **`Delete Old Chats…`**（按天）清理大量旧会话，同时 **保留** Watch 里 Todo / Archive 馆藏。  
2. 该命令按 **`lastUpdatedAt ?? createdAt`** 筛选；馆藏 Chat 往往很旧，会被误删。  
3. Watch 今日 **只读** `state.vscdb`，无法帮用户「刷时间」。

### 1.2 目标

1. **Library header refresh**：对 `library.json` 中 **全部 Todo + Archive**（含 Stale）在 **`composerHeaders`** 写入 **同一时刻** 的 `lastUpdatedAt`（`Date.now()`）。  
2. 成功后引导用户在 Cursor 内自行 **Reload** + **`Delete Old Chats…`**（Watch **不代删**）。  
3. 入口：**面板设置 → 维护**；与 Chat purge **同区**；purge 首版 **仅占位说明**（spike fail 后无自动删）。

### 1.3 硬约束

- **仅 macOS**；localhost；daemon 绑定不变。  
- **Cursor 完全退出** 才允许写库；检测到 Cursor 相关进程 → **409**。  
- **只 UPDATE** `composerHeaders.value` 内 `lastUpdatedAt`；不删行、不改 `cursorDiskKV`、不改 `library.json`。  
- **不**自动备份 `state.vscdb`；**文案警告**用户自行备份；**不**强制勾选确认框。  
- 预览（`dryRun`）与执行 **分两步**；执行前二次确认（对话框）。  
- 无 header 行 → **跳过**；单条 UPDATE 失败 → **继续**；汇总成功 / 跳过 / 失败。  
- 一律写入新时间戳（**不**因「已够新」跳过）。

### 1.4 非目标

- 删除会话、VACUUM、改 KV、刷 transcript mtime。  
- Todo/Archive Tab 主入口。  
- 自动跑 `developer.deleteOldChats`。  
- 全机「按天删旧」模拟预览（可后续加）。

## 2. 决策记录（grilling）

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 目的 | 清理流程一步：刷时间 → 用户 Delete Old Chats |
| 2 | 入口 | 面板设置维护区 |
| 3 | 范围 | 全部 Todo/Archive；无 header 则跳过报告 |
| 4 | 写库 | 仅 `lastUpdatedAt`；Cursor 退出后写 |
| 5 | 时间戳 | 单次操作统一 `Date.now()` |
| 6 | 时钟说明 | 与 Cursor 对齐：`lastUpdatedAt ?? createdAt`（文档/后续 purge 模拟） |
| 7 | Cursor 运行 | 硬拒绝 |
| 8 | 预览 | 条数 + 跳过 + 抽样列表 |
| 9 | 成功后 | 引导 Reload + Delete Old Chats |
| 10 | CLI | `library refresh-headers` |
| 11 | 备份 | 不自动备份 |
| 12 | 确认 | 文案警告，不强制勾选 |
| 13 | API | `POST …/library-header-refresh` + `dryRun` |
| 14 | prefs | 记录上次刷新摘要 |
| 15 | 失败策略 | 尽量多成功，不整批回滚 |
| 16 | UI | 预览 → 执行 两按钮 |
| 17 | 平台 | macOS only |
| 18 | purge | 同区占位，本 plan 不交付删会话 |

## 3. 行为

### 3.1 数据源

| 输入 | 用途 |
|------|------|
| `~/.cursor-watch/library.json` | `entries[]` 中 `mark ∈ {todo, archive}` 的 `conversationId` |
| `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` | 表 `composerHeaders` |

### 3.2 刷新算法

```text
batchTs = Date.now()
targets = library entries (todo | archive), dedupe by conversationId
for each id in targets:
  row = SELECT value FROM composerHeaders WHERE composerId = id
  if !row → skippedNoHeader++
  else:
    v = JSON.parse(value); v.lastUpdatedAt = batchTs
    UPDATE composerHeaders SET value = JSON.stringify(v) WHERE composerId = id
    on failure → failed++ else refreshed++
save prefs summary { at: batchTs, refreshed, skippedNoHeader, failed }
```

写库使用 **读写** `DatabaseSync`；每条 UPDATE 独立 try/catch（或 SAVEPOINT），避免一条坏 JSON 拖死整批。

### 3.3 Cursor 进程检测（macOS）

- 若存在 **Cursor 主应用**相关进程则拒绝 apply（实现：`pgrep` 匹配 `Cursor` 且排除仅 Watch/CursorWatch 误报——需单测钉死启发式）。  
- `dryRun` **不**写库，**不**要求 Cursor 退出（便于面板预览）。

### 3.4 API

**`POST /api/maintenance/library-header-refresh`**

Body: `{ "dryRun"?: boolean }`（默认 `false`）

| dryRun | 行为 |
|--------|------|
| `true` | 只读预览，不写库、不查 Cursor 进程 |
| `false` | 若 Cursor 在跑 → 409；否则写库 + 更新 prefs |

Response（示例字段）:

```json
{
  "ok": true,
  "dryRun": true,
  "batchTs": null,
  "refreshed": 12,
  "skippedNoHeader": 2,
  "failed": 0,
  "samples": [{ "conversationId": "…", "title": "…", "mark": "todo" }]
}
```

### 3.5 Prefs 扩展

在 `prefs.json` 增加（与 `WatchPrefs` 并列，加载时 optional coerce）:

```ts
libraryHeaderRefreshLast?: {
  at: number;
  refreshed: number;
  skippedNoHeader: number;
  failed: number;
};
```

**不**经 `PUT /api/prefs`  patch 暴露给客户端随意改；仅 refresh 成功路径写入。

### 3.6 面板 UI（设置 → 维护）

新区块 **维护**（在别名/外观之后或独立 section）:

1. **馆藏时间刷新** — 短说明 + 警告（退出 Cursor、自行备份）。  
2. 显示 `libraryHeaderRefreshLast` 摘要（若有）。  
3. 按钮：**预览** → 展示结果/toast；**执行刷新** → confirm → POST apply。  
4. 成功：**后续步骤** 静态文案（Reload Window、`Developer: Delete Old Chats…`）。  
5. **会话清理（Chat purge）** — 灰字：Delete 探针未过线，暂不支持自动删；见文档。

设置表单 **保存** 仍只处理外观/别名；维护按钮 **独立** 于 `settingsSave`，避免误触。

### 3.7 CLI

```bash
cursor-watch library refresh-headers          # apply（同 API 约束）
cursor-watch library refresh-headers --dry-run  # 预览
```

非 macOS → 退出码 1 + 明确错误。

## 4. 风险

| 风险 | 缓解 |
|------|------|
| Cursor 未退出 / WAL 冲突 | 409 + 进程检测 |
| 损坏 JSON header | 计 failed，继续其余 |
| 用户误以为等于删会话 | 文案 + 引导 Delete Old Chats |
| schema 升级 | 只 touch `lastUpdatedAt` 字段 |
| 失效馆藏无 header | skipped 报告；无法保护 |

## 5. 验收

- [ ] dryRun 返回正确计数与抽样  
- [ ] Cursor 运行时 apply 409  
- [ ] 退出 Cursor 后 apply：Todo/Archive 对应行 `lastUpdatedAt` 为 batchTs  
- [ ] 无 header 的馆藏 id 在 skipped 中  
- [ ] prefs 写入 last 摘要  
- [ ] CLI 与 API 行为一致  
- [ ] 设置页两按钮 + purge 占位  

