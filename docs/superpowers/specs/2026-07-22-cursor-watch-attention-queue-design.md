# cursor-watch：注意力队列 + 分层保留设计

状态：已评审共识  
日期：2026-07-22  
范围：修复已读/`turnEnded` 会话过久滞留；将面板默认交互改为扁平「注意力队列」  
前置：`docs/superpowers/specs/2026-07-16-cursor-agent-dashboard-design.md`、`2026-07-16-cursor-watch-group-by-workspace-design.md`（分组墙将被本设计取代为默认视图）

## 1. 问题

1. **幽灵会话**：面板上仍出现「⚪ + 本轮结束 + 40h+」的已读会话。名义规则是未读一直留、否则靠约 1h 活动窗口；`turnEnded` 本不应单独延长保留。现象更像可见性未按时重算从 store 清除，外加 UI 把 `turnEnded` 当提醒强留在组内。
2. **多任务难看**：按工作区分组后组头多、白卡多，纵向滚动长，难一眼抓住「要你管的」。

目标：服务端单一真相收紧可见性并定期 prune；前端默认改为扁平紧迫度列表（两行卡），无「更多」历史区。

## 2. 决策记录

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 本次范围 | 保留修复 + 多任务呈现一起做 |
| 2 | 保留策略 | 分层：未读无上限；`turnEnded` 已读 ≤30min；纯 idle ≤15min；进行中可见 |
| 3 | 交互范式 | 注意力队列（默认只看要你管的） |
| 4 | 主舞台成员 | LIVE/running/subagent/error/未读 + `turnEnded` 已读短驻 |
| 5 | 「更多」区 | 不要；到期直接从面板消失 |
| 6 | 列表结构 | 扁平紧迫度列表；卡片带工程名；不再默认组墙 |
| 7 | 卡片密度 | 两行（标题行 + 摘要/LIVE 行） |
| 8 | 实现方案 | 服务端可见性+prune + 前端列表改造 |

## 3. 方案选择

1. **服务端收紧可见性 + 前端改列表（选用）**  
2. 仅前端藏旧会话：治标，API/计数仍脏  
3. 仅修保留 + 保留组墙：与已选扁平范式冲突  

## 4. 可见性（服务端单一真相）

工作区目录不存在 → 不可见。否则：

1. `hasUnread === true` → 可见（无时间上限）  
2. 进行中：`live === true` 或 `status ∈ {running, subagent, error}` → 可见  
3. `turnEnded === true` 且非未读 → 仅当 `now - turnEndedAt ≤ TURN_ENDED_KEEP_MS`（**30min**）可见  
4. 其余 idle → 仅当 `now - lastActivityAt ≤ IDLE_KEEP_MS`（**15min**）可见  

说明：

- 旧 `ACTIVE_WINDOW_MS`（1h）作为纯活动窗口角色由 `IDLE_KEEP_MS` 取代；实现时删除 `ACTIVE_WINDOW_MS` 或令其等于 `IDLE_KEEP_MS`，避免双常量漂移。  
- `turnEnded` **不得**单独成为「永久提醒」保留条件（修正 UI `hasReminder` 含 `turnEnded` 强留 TopN 的行为；分组墙移除后该路径一并删除）。  
- **`turnEndedAt`**：合并 live 快照时写入 `SessionState`（取自 snapshot `stoppedAt`）；若缺失则回退 `lastActivityAt`。不要只在 live 文件里留 `stoppedAt` 却不进 store，否则 prune 无法正确计时。

### 4.1 Prune（防幽灵）

- 全量扫描 / 增量路径继续在写入前用 `isSessionVisible` 过滤。  
- **额外**：daemon 侧短周期 prune（**`VISIBILITY_PRUNE_MS = 30_000`**）：遍历 `SessionStore`，不可见则 `remove`。  
- 不依赖「碰巧 5min 全量扫描」才清掉过期 idle。  
- prune 失败只打日志，不拖垮进程。

### 4.2 常量

| 常量 | 值 | 含义 |
|------|-----|------|
| `TURN_ENDED_KEEP_MS` | 30 × 60 × 1000 | 已读本轮结束最长展示 |
| `IDLE_KEEP_MS` | 15 × 60 × 1000 | 无未读、非进行中、非短驻 turnEnded 的 idle |
| `VISIBILITY_PRUNE_MS` | 30_000 | store prune 间隔 |

## 5. 前端：注意力扁平列表

### 5.1 排序

1. LIVE / `running` / `subagent` / `error`  
2. 未读 / `waiting`  
3. `turnEnded` 已读（短驻）  
4. 同档内按活动时间新 → 旧（`composerUpdatedAt ?? lastActivityAt`）

### 5.2 卡片（两行）

```text
🟢 标题（chatName 优先）          · 50s    [↗]
   LIVE 迷你条 / 摘要一行 · 工程短名（workspaceLabel）
```

- 行1：状态点 + 标题 + 相对时长 + 打开工作区  
- 行2：LIVE 提示或摘要；工程名可截断  
- 点击 → 现有抽屉  
- **删除**：工作区组头、「显示 k / 组内 m」、组内 TopN + `turnEnded` 强留  

### 5.3 顶栏与空态

- 顶栏计数 = **当前可见会话**（与列表一致）  
- 全屏保留  
- 无可见会话：短空态文案（如「暂无需要关注的会话」）

### 5.4 前端过滤边界

- 前端**不**再做第二套「藏尸」时间过滤；信任服务端列表。  
- `group-sessions.js`（或后继模块）改为扁平排序纯函数；单测从「分组」改为「紧迫度排序」。

## 6. 数据流

```text
scan / incremental / headers sync
        → SessionStore（upsert / replaceAll）
        → pruneTimer → isSessionVisible → remove
        → GET /api/sessions + /ws
        → 前端扁平排序渲染
```

API 契约保持扁平 `SessionState[]`；不新增分组响应结构。

## 7. 错误处理

- prune / 可见性计算异常：日志，daemon 继续服务  
- 与现有 EMFILE/EBADF 存活策略一致，不因单次 prune 退出进程  

## 8. 测试

| 场景 | 期望 |
|------|------|
| 未读 + `lastActivityAt` 很旧 | 仍可见 |
| idle 无未读，活动 20min 前 | 不可见（超 `IDLE_KEEP_MS`） |
| `turnEnded` 已读，25min | 可见；35min | 不可见 |
| running / LIVE | 可见 |
| 工作区路径不存在 | 不可见 |
| prune 触发后 store 去掉过期项 | `/api/sessions` 不再返回 |
| 前端排序 | LIVE/未读先于 turnEnded 已读 |
| 前端不再渲染组头 | 单测/快照级断言 |

## 9. 非目标

- 「更多」/历史已读区、顶栏筛选芯片、双栏、按工程摘要表  
- 跳转到具体 Agent/chat  
- 修改 hooks 事件协议  
- 非 macOS 支持  

## 10. 成功标准

1. 已读 + `turnEnded` 超过 30min 的会话从 API 与面板消失  
2. 未读与 LIVE/进行中仍可见  
3. 默认视图为扁平两行卡，无工作区组头墙  
4. 相关单测通过  

## 11. 对既有设计的影响

- `2026-07-16-cursor-watch-group-by-workspace-design.md` 中的「默认按工作区分组墙」被本设计**取代为默认视图**；分组相关实现可删除或降级为非默认（本期不做开关，直接切换）。
