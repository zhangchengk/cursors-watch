# cursor-watch

本机 Cursor Agent 会话的提醒与态势工具：主职是在对话需要你介入或已告一段落时发出提醒。

## Language

**Reminder（提醒）**:
一次「该你看了」的通知意图：某次对话已告一段落或需要你介入时，主动叫你，而不是等你扫列表。
_Avoid_: 注意力（作为主产品目标）、态势（作为主产品目标）、banner 文案本身

**Attention queue（注意力队列）**:
按紧急度排列的会话浏览面；是次要能力，不是产品主职。
_Avoid_: 主看板、核心功能

**Turn end（本轮结束）**:
Cursor 发出会话轮次结束信号（现有实现依赖 hooks 的 `stop` → `stoppedAt`）。Reminder 的默认触发点是本轮结束，不依赖未读蓝点——因为窗口仍开着时常常没有未读。
_Avoid_: 未读（作为唯一触发条件）、任务完成（未定义清楚时）

**Active loop（进行中的循环）**:
该会话下仍有 `/loop` 哨兵进程在跑（`AGENT_LOOP_TICK_*` / `AGENT_LOOP_WAKE_*` 对应的 `sleep`/`while` 等）。哨兵还在时，即使 Cursor 打出 `stop`，也不视为 Turn end，不发 Reminder；哨兵消失后，才允许把后续 Turn end 当成提醒触发点。
_Avoid_: 仅凭 transcript 里出现过 `/loop` 文案、把每次 tick 间隙的 `stop` 当完成

**Reminder delivery（提醒送达）**:
Turn end 且非 Active loop 时的打断方式：以系统通知（可带声音）为主通道，面板作为待确认收件箱保留同一条 Reminder。
_Avoid_: 仅靠卡片脚注/banner、把通知当成唯一且划掉即丢的通道

**Reminder acknowledgment（提醒确认）**:
用户表示「看到了」：在面板打开该会话（或点确认），或点击对应系统通知。任一即可消掉收件箱中的该条 Reminder。
_Avoid_: 必须等 Cursor 未读清除、仅靠超时消失（作为唯一消法）

**Loop ledger（循环账本）**:
按会话记录的 Active loop 账：在 `preToolUse` 发现疑似 `/loop` 哨兵命令时写入 `conversationId` 相关记录；daemon 以本机进程表匹配哨兵命令行为主（`AGENT_LOOP_TICK_*` / `AGENT_LOOP_WAKE_*`），若命令行/环境带有 conversationId 标记则优先用标记绑定。
_Avoid_: 仅靠 terminals 反查、工程级「有任一 loop 就压抑全部会话」、假设 hooks 一定能直接给出后台 pid

**Reminder coalescing（提醒合并）**:
同一会话在确认前若再次 Turn end：收件箱保留/更新为一条，不连环新开多条；系统通知合并或轻量 bump，避免刷屏。
_Avoid_: 每次结束都堆一条、未确认就静默到完全不再通知

**Notification deep link（通知深链）**:
点击系统通知的默认落点是打开/聚焦 cursor-watch 面板并选中该会话；「在 Cursor 打开工程」作为次要动作（不保证跳到具体 Chat）。
_Avoid_: 仅打开工程当唯一落点、点击无任何导航

**Inbox-first panel（收件箱优先面板）**:
面板首页上方固定展示待确认 Reminder；其下再展示精简的运行中/最近会话列表。注意力/工作区浏览降为附属，不再是默认主叙事。
_Avoid_: 默认注意力墙、单独第三种「提醒」mode 当唯一入口、面板只做收件箱而无运行态

**Hooks gate（Hooks 门禁）**:
系统通知类 Reminder 以 hooks 的 `stop` 为可靠 Turn end 信号；未安装 hooks 时不发系统通知，面板提示安装，并可继续展示未读等旧信号（不称为 Reminder）。`open` 仍不自动安装 hooks。
_Avoid_: 用启发式猜 Turn end 当主路径、`open` 强制装 hooks

**Notification sound（通知声音）**:
系统通知默认静音横幅；用户可在设置中打开声音。
_Avoid_: 默认有声、产品永远静音且无开关

**Focus policy（前台策略）**:
不因 Cursor / 面板是否前台而压抑系统通知（多屏多 Cursor 窗口常同时前台）。降噪靠默认静音、Reminder 合并与系统勿扰。
_Avoid_: 以「Cursor 在前台」作为不提醒条件
