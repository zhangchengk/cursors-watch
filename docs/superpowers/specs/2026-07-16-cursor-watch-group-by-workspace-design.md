# cursor-watch：按工作区分组展示设计

状态：已评审共识  
日期：2026-07-16  
范围：在现有态势面板上，将扁平会话列表改为按 Cursor 工作区（工程）分区展示  
前置：`docs/superpowers/specs/2026-07-16-cursor-agent-dashboard-design.md`

## 1. 问题

面板当前每条 Agent 会话一张卡，同一工程（如 `idea/datad-daily/datad`）的多条对话平铺并列，工程名与路径重复出现，扫视成本高。

目标：按「工作区/工程」分组，组下挂多条对话，降低同工程多会话时的认知负担。

## 2. 决策记录

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 「客户端」含义 | 工作区/工程（非 Cursor 窗口实例） |
| 2 | UI 形态 | 分区列表，**不可折叠** |
| 3 | 排序 | 组按组内最紧急会话；组内 waiting → error → running/subagent → idle |
| 4 | 组头 / 卡片 | 组头：路径 + 会话数 + 状态摘要；卡片去掉重复的 workspace 路径 |
| 5 | 顶栏计数 | 仍按**会话**粒度（与现网一致） |
| 6 | 仅 1 条会话的工程 | 仍显示组头（布局统一） |
| 7 | 实现边界 | **仅前端**分组；API 仍返回扁平 `SessionState[]` |

## 3. 方案选择

1. **前端纯展示分组（选用）**：`app.js`（及样式）按键聚合渲染；可选抽出纯函数便于单测  
2. 后端返回分组结构：契约变更大，MVP 不需要  
3. 可折叠手风琴：与已选「不可折叠」冲突，弃用  

## 4. 分组键

对每条 `SessionState`：

1. 若 `workspacePath` 非空 → 用作分组键  
2. 否则若 `workspaceLabel` 非空 → 用作分组键  
3. 否则 → `projectKey`  

组头展示文案：优先 `workspaceLabel`，空则回退分组键。

说明：不以「窗口实例」分组（无可靠数据源）；不读 git 分支。

## 5. 排序

### 5.1 会话紧急度（已有语义，组内沿用）

`waiting` → `error` → `running` / `subagent` → `idle`  
同级：`waiting` 按 `waitingSince`（缺省 `lastActivityAt`）升序（等最久优先）；其余按 `lastActivityAt` 降序。

### 5.2 组顺序

组的「紧急度」= 组内最紧急那条会话的状态（及同级 tie-break 用该条的时间字段）。  
有 🟡 的组整体靠前，其次含 🔴 的组，再次含 🟢/🔵，最后仅 ⚪。

## 6. UI

### 6.1 顶栏

不变：按会话统计 `🟢 running` / `🟡 waiting` / `🔵 subagent` / `⚪ idle` / `🔴 error`。

### 6.2 组头（每个工程一段，始终展开）

- 展示：`{workspaceLabel}` · `{n} 会话` · 组内状态摘要（如 `🟡1 🟢2`，仅非零状态）  
- 不可点击折叠（本期不做折叠）  
- 单会话工程同样显示组头  

### 6.3 组内会话行

相对现卡片：

- **去掉**重复的 `workspaceLabel` 大标题与 `workspacePath` 行（路径已在组头）  
- **保留**：状态色标、`currentAction`、时长、`summary`  
- 点击仍打开现有详情抽屉（抽屉内可继续展示完整 path / transcript）  

### 6.4 示意

```
顶栏：🟢4 🟡0 …

## idea/datad-daily/datad · 2 会话 · 🟢2
  🟢 Read: … · 46s
     摘要…
  🟢 Shell: … · 2min
     摘要…

## idea/Cursors · 1 会话 · 🟢1
  🟢 Shell: … · 7min
     摘要…
```

## 7. 数据流与文件

```
GET /api/sessions | WS sessions
        │ 扁平 SessionState[]（不变）
        ▼
  groupSessionsForUi(sessions)   // 前端纯函数
        ▼
  渲染：section 组头 + 会话行
```

预期改动（实现阶段）：

- `cursor-watch/src/web/app.js` — 分组渲染  
- `cursor-watch/src/web/styles.css` — 组头 / 分区样式  
- 可选：`cursor-watch/src/web/group-sessions.js` + 对应 Vitest（若用 jsdom/node 测纯函数；或暂用手工验证，计划阶段敲定）  

**不改**：daemon、scanner、aggregator、API 契约、详情抽屉业务字段。

## 8. 非目标（本期）

- 组折叠 / 记忆展开状态  
- 按 Cursor 窗口实例分组  
- 顶栏改为「工程数」或双行计数  
- 新 REST 分组 API  
- 跳转 Cursor、Hooks 等既有 v2 项  

## 9. 成功标准

- 同 `workspacePath`/`label` 的多会话出现在同一分区下，组头只出现一次路径  
- 含 waiting 的工程分区排在仅 running 的工程之前  
- 顶栏数字与会话条数一致（分组不改变计数语义）  
- 单会话工程仍有组头，布局与多会话工程一致  
- WebSocket 刷新后分组规则保持一致  

## 10. 风险

| 风险 | 缓解 |
|------|------|
| `workspacePath` 空、仅 `projectKey` 时组名难看 | 回退链明确；抽屉仍有 transcript 路径 |
| 数字型 `projectKey` 无解码路径 | 组头显示 projectKey，与现 label 回退一致 |
| 前端排序与后端 aggregator 顺序不一致 | 组内排序在前端按同一 STATUS_RANK 重排，不依赖输入顺序 |
