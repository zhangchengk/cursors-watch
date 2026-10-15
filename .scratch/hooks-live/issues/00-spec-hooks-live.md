# Spec — cursor-watch：Hooks 活跃态 + 分组 Top4 + 完成提醒

**Status:** done
**Labels:** `done`
**Date:** 2026-07-16
**Glossary:** `CONTEXT.md`
**Migrated from:** `docs/superpowers/specs/2026-07-16-cursor-watch-hooks-live-design.md` (Matt `/to-spec` shape; former superpowers tree removed)

---

## Problem Statement

现有面板的 `running` 来自 transcript/terminals **启发式**，无法可靠对应 Cursor 里「Agent Chat 窗口在滚动」的真活跃感；完成与未读也缺少明确提醒；分组下列表偏长，难扫「每个工程最近在忙什么」。

## Solution

1. 用 **用户级 Cursor Hooks** 把活跃事件写入看板可读的本地文件，标出真正在跑的会话。   2. 看板对 LIVE 会话 **模拟迷你滚动**（视觉近似，非逐 token 同步）。   3. 根据 **本轮结束（stop）∪ 未读（hasUnreadMessages）** 提醒「任务告一段落 / 请查看」。   4. **每个工程分组内** 展示最近活跃的 **4** 个 Chat（再并入完成提醒项）。

## User Stories

1. As a Cursors Watch user, I want 用 **用户级 Cursor Hooks** 把活跃事件写入看板可读的本地文件，标出真正在跑的会话, so that the product behavior matches CONTEXT.md.
2. As a Cursors Watch user, I want 看板对 LIVE 会话 **模拟迷你滚动**（视觉近似，非逐 token 同步）, so that the product behavior matches CONTEXT.md.
3. As a Cursors Watch user, I want 根据 **本轮结束（stop）∪ 未读（hasUnreadMessages）** 提醒「任务告一段落 / 请查看」, so that the product behavior matches CONTEXT.md.
4. As a Cursors Watch user, I want **每个工程分组内** 展示最近活跃的 **4** 个 Chat（再并入完成提醒项）, so that the product behavior matches CONTEXT.md.

## Implementation Decisions

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 真活跃信号 | 用户级 hooks → 写 `~/.cursor-watch/live/` → daemon 读 |
| 2 | 架构 | Hooks → **本地文件** → 现有 daemon（非 HTTP） |
| 3 | Hook 事件 | `preToolUse` + `afterAgentResponse` + `stop` |
| 4 | LIVE TTL | 最近 live 事件后 **60s**；`stop` **立即**熄灭滚动 |
| 5 | 完成提醒 | `stop`→本轮结束；叠加/单独 `hasUnread`→「有未读 · 请查看」 |
| 6 | TopN 范围 | **每工作区分组内** Top4，非全局 |
| 7 | Top4 时间源 | composerHeaders.`lastUpdatedAt`（`composerUpdatedAt`） |
| 8 | Top4 例外 | Top4 ∪ 同组 `hasUnread` / `turnEnded`（可略超 4） |
| 9 | 滚动 UI | 卡片内迷你轨循环 `liveHint`；非 LIVE 不播 |
| 10 | Hooks 安装 | `cursor-watch hooks install\|uninstall`；不自动写 |
| 11 | 零干扰 | 无 failClosed、无 deny/ask、无 prompt hook、写失败也 exit 0 |

## Testing Decisions

Test external behavior at documented seams (HTTP, prefs, pure helpers); follow prior art in `cursor-watch/tests/`.

## Out of Scope

- 跳转回 Cursor、声音告警、全局 Top4、「查看全部」展开。  
- 真·流式同步 Cursor 聊天 DOM。  
- Cloud Agent / 企业级 hooks（本版只做本机用户级）。  
- `afterAgentThought`（可选后续；本版不订，避免过于频繁 spawn）。

## Further Notes

Legacy design prose (migrated verbatim, superpowers boilerplate removed):

# cursor-watch：Hooks 活跃态 + 分组 Top4 + 完成提醒

状态：已评审共识  
日期：2026-07-16  
仓库：`/Users/zhangcheng/idea/Cursors`  
关联：`2026-07-16-cursor-agent-dashboard-design.md`、`2026-07-16-cursor-watch-group-by-workspace-design.md`、chat name（`composerHeaders`）

## 1. 问题与目标

### 1.1 痛点

现有面板的 `running` 来自 transcript/terminals **启发式**，无法可靠对应 Cursor 里「Agent Chat 窗口在滚动」的真活跃感；完成与未读也缺少明确提醒；分组下列表偏长，难扫「每个工程最近在忙什么」。

### 1.2 目标（本版）

1. 用 **用户级 Cursor Hooks** 把活跃事件写入看板可读的本地文件，标出真正在跑的会话。  
2. 看板对 LIVE 会话 **模拟迷你滚动**（视觉近似，非逐 token 同步）。  
3. 根据 **本轮结束（stop）∪ 未读（hasUnreadMessages）** 提醒「任务告一段落 / 请查看」。  
4. **每个工程分组内** 展示最近活跃的 **4** 个 Chat（再并入完成提醒项）。

### 1.3 硬约束

- **不得影响 Cursor 正常使用**：hooks 纯旁路、fail-open、短超时、无网络、不拦截 Agent。  
- `open` **不**自动安装 hooks；显式 `hooks install` / `uninstall`。  
- 未安装 hooks 时面板仍可用（回退现有启发式 + composerHeaders）。

### 1.4 非目标

- 跳转回 Cursor、声音告警、全局 Top4、「查看全部」展开。  
- 真·流式同步 Cursor 聊天 DOM。  
- Cloud Agent / 企业级 hooks（本版只做本机用户级）。  
- `afterAgentThought`（可选后续；本版不订，避免过于频繁 spawn）。

## 2. 决策记录

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 真活跃信号 | 用户级 hooks → 写 `~/.cursor-watch/live/` → daemon 读 |
| 2 | 架构 | Hooks → **本地文件** → 现有 daemon（非 HTTP） |
| 3 | Hook 事件 | `preToolUse` + `afterAgentResponse` + `stop` |
| 4 | LIVE TTL | 最近 live 事件后 **60s**；`stop` **立即**熄灭滚动 |
| 5 | 完成提醒 | `stop`→本轮结束；叠加/单独 `hasUnread`→「有未读 · 请查看」 |
| 6 | TopN 范围 | **每工作区分组内** Top4，非全局 |
| 7 | Top4 时间源 | composerHeaders.`lastUpdatedAt`（`composerUpdatedAt`） |
| 8 | Top4 例外 | Top4 ∪ 同组 `hasUnread` / `turnEnded`（可略超 4） |
| 9 | 滚动 UI | 卡片内迷你轨循环 `liveHint`；非 LIVE 不播 |
| 10 | Hooks 安装 | `cursor-watch hooks install\|uninstall`；不自动写 |
| 11 | 零干扰 | 无 failClosed、无 deny/ask、无 prompt hook、写失败也 exit 0 |

## 3. 方案选择

| 方案 | 结论 |
|------|------|
| 1. Hooks → 本地文件 → daemon | **选用** |
| 2. Hooks → HTTP POST daemon | 弃用（超时/网络易干扰 Agent） |
| 3. 几乎只信 Hooks | 弃用（未 install 时面板空洞） |

## 4. 架构与数据流

```text
Cursor Agent
    │  preToolUse / afterAgentResponse / stop
    ▼
~/.cursor/hooks.json  +  ~/.cursor/hooks/cursor-watch-*.sh|mjs
    │  只写盘、timeout≤2s、始终 exit 0
    ▼
~/.cursor-watch/live/<conversation_id>.json
    │
    ▼
cursor-watch daemon
    │  合并：transcript/terminals ⊕ composerHeaders ⊕ live
    ▼
SessionState[] → HTTP/WS → Web 面板
```

### 4.1 Live 文件格式（覆盖写最新快照）

```json
{
  "conversationId": "uuid",
  "lastEvent": "preToolUse" | "afterAgentResponse" | "stop",
  "lastLiveAt": 1710000000000,
  "stoppedAt": null,
  "liveHint": "Shell: npm test",
  "updatedAt": 1710000000000
}
```

- `preToolUse` / `afterAgentResponse`：更新 `lastLiveAt`、`liveHint`，清除「滚动熄灭」所需的 stopped 门闩（见下）。  
- `stop`：写 `stoppedAt = now`，面板立即 `live = false`，置 `turnEnded = true`。

### 4.2 零干扰脚本契约

- 不设置 `failClosed`。  
- 不返回 `permission: deny|ask`。  
- 不访问网络；仅写入 `~/.cursor-watch/live/`（目录不存在则创建后写，失败则静默）。  
- `timeout` ≤ 2 秒；任何异常路径 exit code **0**。  
- `hooks install` **只追加**带稳定标识的条目（如 command 路径含 `cursor-watch`）；`uninstall` **只删除**这些条目与我们的脚本文件。

## 5. 状态模型

### 5.1 扩展字段

| 字段 | 来源 | 含义 |
|------|------|------|
| `chatName?` | headers.name | 侧边栏 chat name（已有） |
| `composerUpdatedAt?` | headers.lastUpdatedAt | 组内排序 |
| `hasUnread` | headers.hasUnreadMessages | 未读 |
| `live` | live 文件：未 stop 门闩且 `now - lastLiveAt ≤ 60_000` | 可滚 / 在跑 |
| `liveHint?` | live.liveHint 或 headers.subtitle | 迷你轨文案 |
| `turnEnded` | 收到 stop 后为 true；再次 live 事件或业务重置为 false | 本轮结束 |

### 5.2 展示优先级

`error` > `live` > 完成提醒（`turnEnded` / `hasUnread`）> 原有 waiting / subagent / idle。

当 `live === true` 时，对外 `status` 视为 `running`（或保留 status 并另用 `live` 驱动 UI；实现选一种并在单测固定——**推荐：`live` 时强制 status=`running`**）。

### 5.3 完成文案

| 条件 | 文案 |
|------|------|
| `hasUnread` | `有未读 · 请查看` |
| 仅 `turnEnded` | `本轮结束` |
| 否则 | 不显示提醒行 |

`hasUnread` 变为 false 后去掉未读文案；若仍 `turnEnded` 可保留「本轮结束」直至下一轮 live 或扫描策略清除（实现：**下一轮 preToolUse/afterAgentResponse 清 turnEnded**；仅清未读不自动清 turnEnded）。

### 5.4 回退

无 live 文件或 hooks 未装：沿用现有 tool/shell 启发式作为 `running`；不显示迷你滚动（或仅在启发式 running 时用弱动效——**本版规定：迷你滚动仅 `live===true`（hooks）时启用**，避免假滚动泛滥）。

## 6. UI

### 6.1 分组与 Top4

- 保持按 `workspacePath` 分区。  
- 组内：按 `composerUpdatedAt`（缺省回退 `lastActivityAt`）降序取 4，再并入同组 `hasUnread || turnEnded` 且未入选者。  
- 组头：`路径 · 显示 k / 组内 m · 状态摘要`（k=本屏条数，m=该组进入 Top4 规则前的会话总数）。  
- 组内卡序：完成提醒 > live > `composerUpdatedAt` 新→旧。

### 6.2 卡片

```text
[icon] {chatName|summary} · {duration}
[mini-marquee liveHint]          ← 仅 live
[completion line]                ← 有未读/本轮结束时
[currentAction]                  ← 非 live 时可显示一行动作
```

- `prefers-reduced-motion: reduce`：不滚动，显示静态 `LIVE` 徽章。

### 6.3 抽屉

展示 live / turnEnded / hasUnread / composerUpdatedAt；保留首条消息与动作。

## 7. CLI

```text
npx cursor-watch hooks install
npx cursor-watch hooks uninstall
npx cursor-watch hooks status    # 是否已安装、live 目录是否可写
```

`open` / `stop` / `daemon` 行为不变，**不**隐式改 `~/.cursor/hooks.json`。

## 8. 测试

- live TTL 与 stop 立即熄灭。  
- 组内 Top4 ∪ 未读/turnEnded 合并与排序。  
- 完成文案优先级（未读 > 仅 turnEnded）。  
- hooks.json merge / uninstall 幂等，保留用户其它 hooks。  
- 无 live 时面板仍聚合成功；迷你滚动不出现。

## 9. 验收

1. 未 install：面板可用，无 hooks 副作用。  
2. install 后跑 Agent：对应会话 LIVE + 迷你滚动；stop 后滚动停并出现完成提醒。  
3. 每组最多约 4 张，外加未读/本轮结束补入。  
4. uninstall 后 Cursor 与装前一致；看板回退启发式。

## 10. 实现边界

- 触及：`cursor-watch` CLI、hook 脚本模板、live 读写、scanner/aggregator/类型、web 分组与样式、README。  
- 不触及：Cursor 应用本身以外的全局配置（除用户显式 install 的 hooks）、其它仓库工程级 `.cursor/hooks.json`（本版只用户级）。

