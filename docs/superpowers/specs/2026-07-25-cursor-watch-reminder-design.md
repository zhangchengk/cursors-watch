# cursor-watch：Reminder 优先（完成提醒）设计

状态：已实现  
日期：2026-07-25  
范围：将产品主职从「注意力/态势」转为 **Reminder**；Turn end 触发系统通知 + 面板收件箱；识别 Active loop 以免 `/loop` 假结束  
前置：`CONTEXT.md`、`docs/adr/0001-reminder-over-attention.md`  
相关：`2026-07-16-cursor-watch-hooks-live-design.md`（hooks / live / 旧「完成提醒」文案）、`2026-07-22-cursor-watch-attention-queue-design.md`（注意力队列，降为次要）

## 1. 问题与目标

### 1.1 痛点

1. **注意力 ≠ 提醒**：扁平注意力队列仍要用户主动扫；真正需要的是对话告一段落时被叫到。  
2. **未读不可靠**：Cursor 窗口保持在当前 Chat 时往往**不出现未读蓝点**，但本轮已结束。  
3. **`/loop` 假结束**：Cursor hooks 的 `stop` 会在动态/固定 loop 的 tick 间隙触发；现实现把 `stop` 直接当成 `turnEnded`，会误报「本轮结束」。

### 1.2 目标（本版）

1. 产品主职改为 **Reminder**（见 glossary / ADR-0001）。  
2. **Turn end**（hooks `stop`）且 **非 Active loop** → 发系统通知，并在面板 **收件箱** 保留待确认项。  
3. **Active loop**：经 **Loop ledger** 判断该会话哨兵进程仍存活时，压制 Reminder。  
4. 面板改为 **Inbox-first**：上收件箱、下精简运行中/最近；注意力/工作区浏览降为附属。  
5. 未装 hooks：不发系统通知 Reminder，提示安装；旧未读信号可展示但不叫 Reminder。

### 1.3 硬约束

- hooks 旁路、fail-open；**`open` 不自动 `hooks install`**（与既有约定一致）。  
- 不依赖「Cursor 是否前台」压抑通知（多屏多 Cursor 常同时前台）。  
- 不把声音告警做成默认打扰；默认静音横幅，声音可开。  
- 不得为猜 Turn end 引入与 Active loop 冲突的启发式主路径。

### 1.4 非目标（本版）

- 保证系统通知跳进 Cursor **具体 Chat**（仅保证打开面板选中会话；打开工程为次要动作）。  
- 改写 Cursor `/loop` 技能本身（可选：后续在命令行/环境写入 conversationId 标记以增强绑定）。  
- Cloud Agent / 企业 hooks。  
- 用 transcript 全文语义判断「任务业务完成」。

## 2. 决策记录

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 产品主职 | Reminder（A）；注意力队列次要 |
| 2 | 触发信号 | Turn end（hooks `stop`），**不**要求未读（B） |
| 3 | Active loop | 哨兵进程仍存活则不算 Turn end |
| 4 | Loop 认定 | Loop ledger：`preToolUse` 记账 + 进程表匹配；可选 conversationId 标记增强（C） |
| 5 | 送达 | 系统通知为主 + 面板收件箱（C） |
| 6 | 确认 | 面板打开/确认 **或** 点通知，任一即可（C） |
| 7 | 合并 | 同会话确认前合并为一条，不刷屏（A） |
| 8 | 通知深链 | 默认聚焦面板并选中会话；次要「打开 Cursor 工程」（C） |
| 9 | 面板结构 | Inbox-first（A） |
| 10 | 无 hooks | 不发系统 Reminder；提示安装；旧信号可显示（C） |
| 11 | 声音 | 默认静音；可设置开启（B） |
| 12 | 前台策略 | 不因前台压抑（A′） |

## 3. 方案选择

1. **Reminder 管线 + Loop ledger + Inbox-first UI（选用）**  
2. 仅加强面板 banner / 注意力置顶：达不到「打断」  
3. 仅未读触发：与「窗口仍开着无蓝点」冲突  
4. transcript 检测 `/loop` 文案压制 stop：易脏、易漏动态 sleep  

## 4. 概念与状态

术语以 `CONTEXT.md` 为准。实现层映射：

| 概念 | 实现要点 |
|------|----------|
| Turn end | live 快照 `lastEvent=stop` 且 `stoppedAt != null`（既有） |
| Active loop | 该 `conversationId` 在 Loop ledger 中仍匹配到存活哨兵进程 |
| Reminder | 独立于 Session 列表的待确认记录（见 §5）；**不是** `hasUnread` 的别名 |
| Effective turn end | Turn end ∧ ¬Active loop → 可进入 Reminder 管线 |

### 4.1 Effective turn end 状态机（单会话）

```text
        hooks stop
             │
             ▼
      ledger: Active loop?
        │ yes          │ no
        ▼              ▼
   忽略本次 stop    发出/合并 Reminder
   （不 ack 清）     系统通知 + 收件箱
```

- 哨兵消失后的**下一次** Effective turn end 才提醒；不在哨兵刚死时补发「历史 stop」。  
- `preToolUse` / `afterAgentResponse` 清 `stoppedAt` 的行为保持既有 live 语义；与 Reminder ack 独立。

## 5. Reminder 数据模型

建议落盘：`~/.cursor-watch/reminders.json`（或按 id 分文件；实现可选，须可测）。

每条至少包含：

| 字段 | 含义 |
|------|------|
| `conversationId` | 会话 id（主键，合并键） |
| `projectKey` / `workspacePath` / `workspaceLabel` | 展示与次要深链 |
| `chatName` | 标题 |
| `turnedEndedAt` | 最近一次 Effective turn end 时间 |
| `summary` | 一行摘要（可来自 liveHint / 最近进展） |
| `status` | `pending` \| `acked` |
| `ackedAt` | 确认时间 |
| `notifyId` | 系统通知合并用稳定 id（如 `cursor-watch-reminder-<conversationId>`） |

**合并：** `pending` 且同 `conversationId` → 更新 `turnedEndedAt` / `summary`；系统通知用同一 `notifyId` replace/bump，不新开多条。

**确认：** `pending → acked`；从收件箱主列表移除（acked 可短留审计或直接删，本版建议确认后移除主列表）。

## 6. Loop ledger

### 6.1 写入（hooks `preToolUse`）

当 `tool_input.command`（或等价字段）匹配哨兵形态时记账，例如包含：

- `AGENT_LOOP_TICK_`
- `AGENT_LOOP_WAKE_`

记录：`conversationId`、`seenAt`、`commandFingerprint`（规范化命令片段）、可选 `pid`（若将来可得）、可选 env/argv 中的 `CURSOR_WATCH_CONVERSATION_ID`（增强路径）。

Hook 仍 fail-open；记账失败不得拖垮 Agent。

### 6.2 查询 Active loop

daemon（或提醒管线）在处理 `stop` 时：

1. 若 ledger 有该会话增强标记 → 进程表按 env/argv 精确匹配。  
2. 否则：进程表扫描命令行含上述哨兵子串；再与该会话近期 fingerprint / 时间窗关联（同一工程多会话时宁可漏压也不要工程级一刀切——**禁止**「工程内任一 loop 压抑全部会话」）。  
3. 匹配到存活进程 → Active loop = true。  
4. 进程消失 → 可清理 ledger 条目。

### 6.3 风险与接受

- Agent 崩溃未杀 sleep → 可能短暂压抑提醒（偏安全）。  
- sleep 刚退出、下一轮尚未 arm → 极短窗口可能误报 Reminder（可接受；合并减轻伤害）。  
- 无标记时指纹关联可能偶发错绑：优于不识别 loop。

## 7. 系统通知

- **触发：** Effective turn end 且 Reminder 进入/更新 `pending`。  
- **默认静音**横幅；设置项 `notificationSound: boolean`（默认 `false`），持久化（如 `~/.cursor-watch/prefs.json` 或面板 localStorage + daemon 可读配置——实现选定一种单一真相）。  
- **标题/正文：** Chat 名 + 短摘要（如「本轮结束」）；不依赖「有未读」文案当主标题。  
- **点击默认：** 打开/聚焦 `http://127.0.0.1:7423/`，带 query/hash 选中 `conversationId` 并视为 ack 路径之一。  
- **次要动作（若平台支持）：** 打开 Cursor 工程（复用现有 open-workspace）。  
- **前台：** 不检测 Cursor/面板焦点来 suppress。  
- **无 hooks：** 不调用通知 API；面板展示安装引导。

实现提示（非规范强制）：macOS 可用 `osascript` / `terminal-notifier` / Node notifier；须在 daemon 侧触发，页面 alone 不可靠。

## 8. 面板：Inbox-first

### 8.1 布局

```text
┌─────────────────────────────────────────┐
│ 待确认 Reminder（空则短空态）              │
│  · 卡：标题 / 工程 / 结束时间 / 确认       │
├─────────────────────────────────────────┤
│ 运行中 / 最近（精简列表，复用现有会话数据）   │
│  （注意力排序或工作区模式可保留为次要切换）   │
└─────────────────────────────────────────┘
```

- 默认叙事是收件箱，不是注意力墙。  
- 既有「注意力 / 工作区」切换可保留在次要区，**默认首页仍 Inbox-first**。  
- 未装 hooks：收件箱区显示 CTA（`cursor-watch hooks install`），不假装有 Reminder 管线。

### 8.2 与旧「本轮结束 / 有未读」banner

- Reminder 收件箱是**主完成提醒**。  
- 会话卡上的未读/结束脚注可保留为次要视觉，但文案与产品主职对齐：未读 ≠ Reminder。  
- 可见性/prune 规则（`TURN_ENDED_KEEP_MS` 等）仍可约束「最近」列表；**pending Reminder 不受 turnEnded 短驻窗口裁掉**（确认前一直在收件箱）。

## 9. 数据流

```text
hooks preToolUse (loop-like cmd)
    → Loop ledger upsert
hooks stop
    → live snap stoppedAt
    → if Active loop: stop（不建 Reminder）
    → else: Reminder upsert (coalesce) → OS notify → WS/API 推收件箱
面板打开会话 / 通知点击
    → Reminder ack → 收件箱移除 →（可选）清通知
```

API 草案（实现可微调路径名）：

- `GET /api/reminders` → pending 列表  
- `POST /api/reminders/:id/ack`  
- 现有 `/api/sessions` 不变职责；面板组合渲染。

## 10. 测试要点

1. `stop` + 无 loop 哨兵 → pending Reminder +（测试可注入）通知调用一次。  
2. `stop` + 存活 `AGENT_LOOP_WAKE_*` 进程且绑定该会话 → **无**新 Reminder。  
3. 哨兵结束后的下一次 `stop` → 出现 Reminder。  
4. 同会话两次 Effective turn end 未 ack → 仍一条；通知 id 稳定。  
5. ack 经面板与经通知深链均清除 pending。  
6. 未装 hooks：无通知；有安装提示。  
7. 默认静音配置为 false。

## 11. 迁移与兼容

- 不删除 live / sessions 管线。  
- ADR-0001 与本规格覆盖旧 hooks 规格中「声音告警为非目标」——**改为可选声音**；「完成提醒仅靠卡片文案」升级为通知+收件箱。  
- 注意力队列规格仍有效，但定位为次要浏览，不再描述产品主职。

## 12. 验收

1. 普通 Agent 跑完（已装 hooks、无 loop）：静音系统通知出现；面板收件箱有一条；点击通知进入面板并选中该会话且 ack。  
2. `/loop` 进行中多次 `stop`：不刷 Reminder；停 loop 后再结束一轮：出现一条 Reminder。  
3. 多 Cursor 窗口前台：通知仍出现。  
4. 未装 hooks：无系统通知，有安装引导。
