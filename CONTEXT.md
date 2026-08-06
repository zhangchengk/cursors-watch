# cursor-watch

本机多个 Cursor Agent 会话的提醒与馆藏工具（产品名 **Cursors Watch**）：与 Reminder 并列的主职是给 Chat 打上代办/归档并加以组织与备注，便于回看与落地。

## Language

**Cursors Watch**:
面向用户的产品显示名与安装名（`/Applications/Cursors Watch.app`）：监控**多个** Cursor 会话，并管理代办/归档馆藏。菜单栏缩写仍为 **CW**。技术包名 / Bundle ID 保持 `cursor-watch` / `com.cursor-watch.*`。
_Avoid_: 「Cursor Agent 态势面板」、单独再挂一个中文主品牌名、把 Bundle ID 改成 `com.cursors-watch.*`（除非刻意当作新 App）、把产品说成「只有提醒、没有馆藏」

**Reminder（提醒）**:
一次「该你看了」的通知意图：某次对话已告一段落或需要你介入时，主动叫你，而不是等你扫列表。与馆藏状态无关。
_Avoid_: 注意力（作为唯一主产品目标）、态势（作为主产品目标）、banner 文案本身、把代办当成 Reminder

**Chat library（会话馆藏）**:
与 Reminder **并列的主职**：对有意义的 Agent Chat 做人为标注、归组与备注，便于待落地管理与事后回看/宣讲。不是 Cursor 侧边栏的替代品，也不自动推断该标什么。
_Avoid_: 任务中枢（泛项目管理）、Attention queue（那是次要浏览面）、把馆藏说成 Reminder 的附属开关

**Library mark（馆藏状态）**:
一条 Chat 上至多一个互斥状态：`无标注` / `代办` / `归档`。与 Reminder 收件箱是否「待确认」无关。
_Avoid_: 同时挂代办+归档、把未读/Turn end 自动当成馆藏状态

**Todo mark（代办）**:
馆藏状态之一：该 Chat 里想法已做了 AI 验证，但代码尚未落地，需要回头继续推进。
_Avoid_: Reminder、待确认、待办任务系统里的 generic todo

**Archive mark（归档）**:
馆藏状态之一：该 Chat 已告一段落且值得保留——事后回看，或用于团队宣讲赋能。宣讲赋能指**本机打开该 Chat 当面讲**，不做馆藏导出或多人同步。
_Avoid_: 系统自动冷存储、删除、仅表示「已读」、把归档当成团队共享知识库

**Library folder（馆藏文件夹）**:
代办与归档**各自独立**的可选归组容器；两边不同名同构、不共用；树可**任意深度**嵌套；**本机全局一份**（跨工作区共享同一套 Todo 树 / Archive 树）。Chat 可以只带馆藏状态、不放进任何文件夹（未归组）。条目可展示所属工作区以辨来源。状态迁移时退出原树文件夹，落到目标状态未归组，再可选放入目标树。
_Avoid_: 用文件夹替代馆藏状态、强制先建树才能标注、全局共用一棵「状态混用」树、按工作区各拆一套馆藏树、迁状态时按同名自动落入、把工作区/工程目录当成馆藏文件夹、首版故意限制为单层/浅层

**Library title（馆藏标题）**:
用户为已标注 Chat 写的可选短标题，用于馆藏列表一眼辨认；可补充或盖过 Cursor 侧原始会话名在馆藏里的展示，不修改 Cursor 内的会话名。代办↔归档互迁时**保留**；取消标注时**丢弃**。
_Avoid_: 当成 Cursor 会话重命名、当成唯一必填才能标注、取消标注后软保留幽灵标题

**Library note（馆藏备注）**:
用户为已标注 Chat 写的可选长文本，记录目的、下一步或宣讲要点等；与馆藏标题分离，不进列表主行抢视线。代办↔归档互迁时**保留**；取消标注时**丢弃**。
_Avoid_: 结构化多字段模板、把 Reminder 文案当备注、取消标注后软保留幽灵备注

**Library curation（馆藏整理）**:
在 Todo / Archive Tab 内对**已标注**条目做完整管理：改馆藏标题/备注、在本状态树内建文件夹与移动、代办↔归档互迁、取消标注（回无标注），以及 Open Chat jump。互迁时：退出原文件夹 → 目标状态未归组；**标题与备注保留**。取消标注：丢弃标题、备注与文件夹归属。
_Avoid_: 馆藏 Tab 只读、改状态/取消只能回 Reminder、把整理能力藏到与 Tab 无关的隐蔽入口、取消标注仍保留元数据

**Stale library entry（失效馆藏条目）**:
源 Agent Chat 在 Cursor/本机已不可用（删除或无法解析）时，馆藏条目**仍保留**标题、备注与文件夹位置，并标明源会话不可用；Open Chat 失败并提示；用户可取消标注以清除。不自动剔除。
_Avoid_: 源消失则静默删除馆藏、面板假装仍可打开、不展示失效态

**Attention queue（注意力队列）**:
按紧急度排列的会话浏览面；是次要能力，不是产品主职（主职是 Reminder 与 Chat library）。
_Avoid_: 主看板、把注意力队列当成代办/归档本身

**Turn end（本轮结束）**:
Cursor 发出会话轮次结束信号（现有实现依赖 hooks 的 `stop` → `stoppedAt`）。Reminder 的默认触发点是本轮结束，不依赖未读蓝点——因为窗口仍开着时常常没有未读。
_Avoid_: 未读（作为唯一触发条件）、任务完成（未定义清楚时）

**Active loop（进行中的循环）**:
该会话下仍有 `/loop` 哨兵进程在跑（`AGENT_LOOP_TICK_*` / `AGENT_LOOP_WAKE_*` 对应的 `sleep`/`while` 等）。哨兵还在时，即使 Cursor 打出 `stop`，也不视为 Turn end，不发 Reminder；哨兵消失后，才允许把后续 Turn end 当成提醒触发点。
_Avoid_: 仅凭 transcript 里出现过 `/loop` 文案、把每次 tick 间隙的 `stop` 当完成

**Reminder delivery（提醒送达）**:
Turn end 且非 Active loop 时的打断方式：以系统通知（可带声音）为主通道，面板作为待确认收件箱保留同一条 Reminder。Menubar shell 落地后：优先由壳申请并发送系统通知；权限未开或投递失败时回退 **HUD 浮层**。
_Avoid_: 仅靠卡片脚注/banner、把通知当成唯一且划掉即丢的通道、无回退的「只靠通知中心」

**HUD 浮层（heads-up display）**:
不经过通知中心、由 **Menubar shell（Cursors Watch.app）** 直接画在屏幕右上角的短暂提示条。不叫系统横幅；不依赖通知权限。用于系统通知不可用时的兜底。
_Avoid_: 把 HUD 叫成「系统通知」、模态 `display alert` 对话框；另装独立 Banner/Notify 助手 App

**Open at login（登录时打开）**:
用户登录 macOS 后**默认**自动拉起 Menubar shell（从而拉起内嵌 daemon）。菜单内可退出或关闭「登录时打开」。与「每次手动启动」相对。
_Avoid_: 仅靠文档提醒用户开机后执行命令、默认不注册登录项却仍承诺「不用每次启动」

**Shell v1（菜单栏壳首版）**:
最小可用 Menubar shell：内嵌 daemon、默认登录打开、菜单栏入口、WKWebView 面板、系统通知优先 + HUD 回退、可退出。不含：一键装 hooks、自动更新、多窗口、大改设置页。
_Avoid_: 把 hooks 安装/自动更新绑进首版必达、首版做成完整上架产品

**Informal app（非正式 App）**:
本机自用的 `.app` 交付：可 ad-hoc 签名；**安装落点为 `/Applications/Cursors Watch.app`**；**不**走 Mac App Store，**不**以公证/上架为 v1 目标。仓库变更后以**一条打包命令**重建并覆盖安装（如 `package:app`）；不以挂载仓库源码热更为交付路径。
_Avoid_: 首版就要求公证与分发流水线、把「非正式」理解成「不用 .app、继续只靠终端」、交付后仍依赖仓库内临时路径当日常入口、App 启动时挂载仓库热更当正式方案

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
仅适用于 **Reminder Tab** 内部：上方固定待确认 Reminder，其下再展示精简的运行中/最近会话。不再表示整个 App 只有收件箱这一种主叙事。
_Avoid_: 默认注意力墙、单独第三种「提醒」mode 当唯一入口、面板只做收件箱而无运行态、把 Inbox-first 理解成没有 Todo/Archive Tab

**Library panel tabs（馆藏面板页签）**:
面板顶层三个对等 Tab：`Reminder`（默认首页）｜`Todo`｜`Archive`。Reminder Tab 内仍 Inbox-first；Todo / Archive Tab 各自展示对应馆藏状态、其文件夹树与标题/备注。可记住上次 Tab，但冷启动默认 Reminder。
_Avoid_: 单页三分硬塞、把 Todo/Archive 藏进 Reminder 的二级抽屉却仍声称双主职、顶层只有「提醒/馆藏」两个入口（与已定三 Tab 不符）

**Library mark entry（馆藏标注入口）**:
从未标注变为代办/归档，只在 **Reminder Tab** 的收件箱或运行中/最近列表上发起（可顺带写标题、备注、选目标状态树中的文件夹）。标注完成后**留在 Reminder Tab**，不自动跳到 Todo/Archive。首版**不**提供本机历史会话搜索挑选；不在列表中的旧 Chat 不在首版标注范围内（可日后打开/活动后出现在最近再标）。
_Avoid_: 在 Todo/Archive Tab 内从本机会话库搜索添加、标完强制切 Tab、把「统一管理所有历史 Chat」当成首版承诺

**Hooks gate（Hooks 门禁）**:
系统通知类 Reminder 以 hooks 的 `stop` 为可靠 Turn end 信号；未安装 hooks 时不发系统通知，面板提示安装，并可继续展示未读等旧信号（不称为 Reminder）。`open` 仍不自动安装 hooks。
_Avoid_: 用启发式猜 Turn end 当主路径、`open` 强制装 hooks

**Notification sound（通知声音）**:
系统通知默认静音横幅；用户可在设置中打开声音。
_Avoid_: 默认有声、产品永远静音且无开关

**Focus policy（前台策略）**:
不因 Cursor / 面板是否前台而压抑系统通知（多屏多 Cursor 窗口常同时前台）。降噪靠默认静音、Reminder 合并与系统勿扰。
_Avoid_: 以「Cursor 在前台」作为不提醒条件

**Menubar shell（菜单栏壳）**:
用户期望的「装成一个 APP」形态：登录 Mac 后常驻；菜单栏入口托管 daemon，并用原生窗口（WKWebView）承载收件箱优先面板，而不是每次手动起服务再开浏览器。实现倾向：薄 Swift 壳，不重写面板；**交付形态内嵌 Node 运行时与 cursor-watch**，不依赖本机仓库路径或临时 `npx`。
_Avoid_: 仅文档里写启动命令、把「打开浏览器」当成唯一日常入口、用 Electron 整包重做面板（除非另有决策）、交付后仍要求用户自备 Node/仓库

**Open Chat jump（打开对应 Chat）**:
面板 `↗` 的承诺：打开/聚焦目标 Agent Chat，并尽量不拆掉用户当前正在看的其它 Chat 标签（优先激活已有标签，否则以新标签打开）。
_Avoid_: 只打开工程不定位 Chat、把「切到 Cursor 前台」当成已定位 Chat、故意用原地导航顶掉当前 Chat 标签

**Two-phase open（两阶段打开）**:
Open Chat jump 的交付节奏：先尽快把 Cursor 新窗拉到前台（opened），再在后台仅对该新窗做 Chat focus；两阶段可分别成功或失败。
_Avoid_: 等 Chat focus 完成后才切前台、focus 失败时回退到旧窗发 focus
