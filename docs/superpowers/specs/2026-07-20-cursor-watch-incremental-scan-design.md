# cursor-watch：增量扫描（状态 + 进展近实时）

状态：已实现  
日期：2026-07-20  
仓库：`/Users/zhangcheng/idea/Cursors`  
包：`cursor-watch/`  
关联：`2026-07-16-cursor-agent-dashboard-design.md`、`2026-07-16-cursor-watch-hooks-live-design.md`、现行 `watcher.ts` / `scanner.ts` / `store.ts`

## 1. 问题与目标

### 1.1 痛点

当前任意 transcript / terminals / live 文件变更都会：

1. 防抖约 300ms  
2. `fork` 子进程跑 **`scanProjects` 全量**  
3. `SessionStore.replaceAll` 后 WebSocket 推送  

本机实测全量约 **14–20 秒/次**。状态变绿、未读/已读、卡片「最近进展」都要等整表重算，体感延迟大。

### 1.2 目标（本版，选项 C）

1. **状态近实时**：绿/黄/白、LIVE、本轮结束等，多数更新 **≤1–2s**。  
2. **进展文案近实时**：卡片副标题与抽屉「最近进展」随 transcript/live 增量更新，同一量级。  
3. **启动**仍允许一次全量扫描（可接受数十秒）。  
4. **正确性兜底**：定时全量，防止漏事件或状态漂移。

### 1.3 硬约束

- 不改变既有产品语义：ACTIVE_WINDOW 60 分钟、未读无限期、黄=未读/白=已读、镜像 subagent 不升主卡、打开 Cursor 等行为保持不变。  
- daemon 主线程不被长时间全量阻塞（全量继续可放子进程）。  
- 增量失败或路径无法识别时，**降级为调度一次全量**，不得丢更新。

### 1.4 非目标

- 将 terminal 精确归属到某一个 Chat。  
- 按 token / 流式同步 Cursor 聊天 DOM。  
- 本版不做「只加速 LIVE、正文仍全量」的半吊子方案（C 要求两者都快）。

## 2. 决策记录

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 策略 | **事件路由 + 内存态补丁**；启动 + 定时全量兜底 |
| 2 | 成功标准 | 状态 **与** 进展文案均近实时（选项 C） |
| 3 | 增量执行位置 | **daemon 进程内**跑单会话/单工程补丁；全量仍可 `fork` |
| 4 | Store API | 保留 `replaceAll`；新增 `upsert` / `remove`（或等价 patch） |
| 5 | 防抖 | 增量事件 **50–100ms** 合并；全量路径可维持现有或略短 |
| 6 | 兜底周期 | **5–10 分钟** 全量一次（实现时取常数，建议默认 5 分钟） |
| 7 | composer 元数据 | headers **缓存**（按 DB mtime 失效）；增量时按 id 取 chatName/hasUnread，避免每次全表重载成为瓶颈 |

## 3. 架构

```text
启动
  → fork 全量 scanProjects
  → SessionStore.replaceAll
  → 建立 headers 缓存、workspace 索引缓存（可与全量同批）

chokidar（路径已知）
  → 短防抖 / 按会话或工程合并
  → classify(path) → IncrementalHandler
       transcript  → 重解析该会话（+ subagents）→ upsert 父卡（含 recentMessages / 进展）
       terminal    → 重算该 projectKey 的 shell 标志 → 刷新该工程窗内会话 status/action
       live        → mergeSessionExtras(该 id) → upsert
       unlink      → remove 或再过滤
       unknown     → scheduleFullScan()

定时器（如 5min）
  → fork 全量 → replaceAll（与启动相同）
```

前端仍只消费 `sessions` 数组；**不改**卡片/抽屉的展示契约，只是推送更勤、数据更新更快。

## 4. 事件路由细则

### 4.1 路径分类

| 模式 | 动作 |
|------|------|
| `…/agent-transcripts/<sessionId>/<sessionId>.jsonl` | 视为父会话主文件；若 `sessionId` 在某父的 `subagents/` 镜像集合中则 **跳过升主卡**，改走父聚合 |
| `…/agent-transcripts/<parentId>/subagents/<childId>.jsonl` | 重读该父的 subagents 聚合，upsert **父** SessionState |
| `…/terminals/<name>.txt` | 从 path 解析 `projectKey`；重扫该工程 terminals；更新该工程下当前 store 中会话的 shell 相关字段与 status |
| `~/.cursor-watch/live/<conversationId>.json` | 读该 live + headers 缓存项；merge 后 upsert |
| 上述文件 `unlink` | 父 jsonl 删除 → `remove(id)`（并清依赖）；live 删除 → 按无 snap 重 merge；terminal 删除 → 重算该工程 shell |

### 4.2 单会话重算内容（transcript 增量）

与现行 `buildState` + `mergeSessionExtras` + 聚合规则对齐，至少包括：

- `status` / `currentAction` / `waitingSince` / `runningSince`  
- `recentMessages`（从而 `latestProgressText` / 抽屉最近进展）  
- `summary`、`lastActivityAt`  
- `chatName` / `hasUnread` / `composerUpdatedAt`（来自 headers 缓存）  
- `live` / `turnEnded` / `liveHint`（来自 live 文件）  
- `subagentCount` / `subagentRunning`（若动到 subagents）  
- `workspacePath` / `workspaceLabel`（来自缓存的 workspace 索引；缺失则解析并写回缓存）

### 4.3 与全量过滤器一致

增量 upsert 之后，对 store 再应用与 `aggregateSessions` 相同的展示过滤（ACTIVE_WINDOW、未读例外、workspace 目录必须存在等），或在 upsert 时直接不写入不合格会话并 `remove` 已不合格项。

### 4.4 降级

- 分类失败、解析抛错、projectKey 无法解析 → 打日志并 `scheduleFullScan()`。  
- 连续增量错误超过阈值 → 强制全量并短暂抑制增量（可选，实现计划里定阈值）。

## 5. SessionStore

```text
replaceAll(sessions)     // 全量 / 兜底
upsert(session)          // 按 id 替换或插入，然后 notify
remove(id)               // 删除后 notify
getSessions()            // 不变
subscribe(fn)            // 不变；增量也应触发
```

通知粒度：本版仍可推送**完整 sessions 数组**（与现 WS 协议兼容）。若后续体积过大再议 diff 协议（非本版必做）。

## 6. 缓存

| 缓存 | 失效 |
|------|------|
| `WorkspaceIndex` | 全量时重建；增量遇到未知 projectKey 时局部 decode 并写入 |
| Composer headers map | `state.vscdb`（或现用路径）mtime 变化时重载；否则按 id get |
| Mirrored subagent ids（可按 project） | 该工程 transcripts 目录结构变化时更新；或 upsert 前轻量检查 |

## 7. 防抖与合并

- **同一 sessionId** 的多次 transcript/live 事件：合并为一次重算（trailing 50–100ms）。  
- **同一 projectKey** 的多次 terminal 事件：合并为一次 shell 重算。  
- 全量进行中：增量可先入队；全量 `replaceAll` 完成后重放队列或丢弃队列并依赖下一轮事件/兜底（实现计划二选一，推荐：**全量结束后若 queue 非空则再短防抖跑增量**）。

## 8. 验收标准

1. 改某一会话 transcript 后，该卡片进展文案与状态在约 **1–2s** 内更新（本机 SSD、daemon 已热）。  
2. 写对应 `live/<id>.json` 后，LIVE / 状态在约 **1–2s** 内更新。  
3. 启动后首屏数据仍正确（全量）。  
4. 断开 hooks 或仅启发式时行为不回归。  
5. 现有 Vitest 通过；新增：路径分类、upsert/remove、单会话增量与「镜像 subagent 不升主卡」。  
6. 人为制造频繁写入时，不出现永久饿死（有全量兜底 + 扫描中排队策略）。

## 9. 实现分期（供 writing-plans）

1. Store：`upsert` / `remove` + 测试  
2. `classifyWatchPath` + 单会话 `rescanSession` / `rescanProjectShells` / `applyLivePatch`  
3. Watcher：事件路由接增量；保留 fork 全量（启动 + 定时）  
4. Headers / workspace 缓存与 mtime 失效  
5. 防抖合并与全量期间队列  
6. 手工验收与回归  

## 10. 风险

| 风险 | 缓解 |
|------|------|
| 漏事件导致状态陈旧 | 定时全量 + 未知路径降级全量 |
| 工程级 shell 误伤同工程其它卡 | 保持与现网相同的启发式；本版不引入精确归属 |
| 增量与全量竞态 | 全量 `replaceAll` 为权威；增量 generation / 忽略过期补丁 |
| SQLite 读锁 | headers 缓存 + mtime；避免每事件全表扫 |
