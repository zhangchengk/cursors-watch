# cursor-watch：面板跳转打开对应 Cursor Chat 设计

状态：产品接线已实现（Spike pass → BridgeHub / open-chat）  
日期：2026-08-05  
范围：面板卡片 `↗` 从「仅打开工程」升级为「打开工程并聚焦对应 Agent Chat」；经 Cursor 扩展桥实现；**先 Spike 后产品**  
前置：`CONTEXT.md`、现有 `open-workspace`、`composerHeaders` / `conversationId` 对齐  
相关：`2026-07-25-cursor-watch-reminder-design.md`（通知深链仍只到面板）、`2026-07-29-cursor-watch-menubar-shell-design.md`（本需求**刻意**改变「启动不自动装 hooks」）、`2026-07-16-cursor-watch-hooks-live-design.md`

## 1. 问题与目标

### 1.1 痛点

1. 面板 `↗` 今日仅 `open -a Cursor <workspacePath>`，README 已写明**定位不到具体 Agent/chat**。  
2. 从 Watch Reminder / 运行中卡片回到「正在处理的那条对话」仍需在 Cursor 侧边栏里找，摩擦大。  
3. 官方 deeplink（`cursor://anysphere.cursor-deeplink/...`）不支持打开**已有** conversation；CLI 也无「按 id 打开 Chat」文档化入口。

### 1.2 目标

1. 点击面板 `↗` 后，用户落到 **对应工作区窗口 + 对应 Agent Chat**（成功标准硬要求，非「尽量」）。  
2. 载体为 **Cursor 扩展桥**；Watch daemon 为控制面，扩展向 daemon **注册**后接受 focus 转发。  
3. **先 Spike、后产品**：未证明可按 id 聚焦前，不交付完整安装/IPC/`↗` 接线假装可用。  
4. **hooks + 桥扩展默认安装**（随 App 安装；启动轻量自检/补装）。

### 1.3 硬约束

- 仅 macOS / localhost（与现产品一致）。  
- 不改写会话内容、不代发 prompt、不替代 Cursor 侧边栏。  
- 身份键：`conversationId` ≡ Watch `SessionState.id` ≡ hooks live id ≡ `composerHeaders.composerId`（Spike 须验证扩展侧同一 id）。  
- Spike 优先内部命令；**仅 CDP 能做到** → 标记「脆弱过线」，钉 Cursor 版本，**产品实现前须再批准一次**。

### 1.4 非目标（本版）

- 系统通知点击进入 Cursor Chat（通知仍只打开 Watch 面板 + `?conversationId=`）。  
- 点击整张卡片跳转（仅 `↗`）。  
- Marketplace 分发扩展；非 macOS；Cloud Agent。  
- 保证 100% 多窗口无误聚焦（靠「先开工程 + workspacePath」降低风险）。

## 2. 决策记录

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 成功标准 | 必须进到对应 Chat（A）；开工程不够 |
| 2 | 侵入载体 | Cursor 扩展桥（D） |
| 3 | 可行性闸门 | 先 Spike；失败则停或改标准（A） |
| 4 | Spike 过线 | 真实 id 可重复聚焦；仅 CDP → 脆弱过线须再批 |
| 5 | 默认组件 | hooks + 扩展默认装；启动轻量自检 |
| 6 | 运行时失败 | opened 成功但 focus 失败：保留新窗 + toast；**不**向旧窗 focus（2026-08-06） |
| 7 | 入口 | 仅面板 `↗`（A） |
| 8 | IPC | 扩展向 daemon 注册，API 转发（B） |
| 9 | 多窗口顺序 | **总是** `cursor -n <path>` 新开窗口，再 activate，再 focus（2026-08-06 grill：B） |
| 10 | 实施方式 | 两阶段：Focus Spike → 再接线（方案 1） |
| 11 | 体感成功 | ≤1s 切到 Cursor 新窗；Chat 可再晚 1–3s（两阶段 opened → focus） |
| 12 | focus 失败 | 保留新窗 + toast；**绝不**向旧窗发 focus |
| 13 | 无新桥 client | 只等新 client；超时停止，不降级旧窗 |
| 14 | 白名单 | live sessions **或** pending Reminder 的 `workspacePath` / conversation |

## 3. 方案概述

两阶段交付：

1. **Spike**：最小扩展，只验证按 `conversationId` 聚焦 Agent；产出过线/脆弱过线/未过结论。  
2. **产品（仅过线后）**：扩展注册 + `POST /api/open-chat` + 改 `↗` + App 捆绑安装与启动自检。

不做「一次做满」或「Watch 写 state.vscdb / 纯 AppleScript」主路径。

### 3.1 Open Chat jump 运行时（2026-08-06）

```text
↗ → 校验白名单（sessions ∪ reminders）
  → snapshot bridge clientIds for workspace
  → cursor -n <workspacePath>
  → activate Cursor（open -a Cursor）
  → HTTP 返回 { ok: true, stage: "opened" }   // 体感 ≤1s
  → 后台：等待「新」bridge client（≤5s）
       → 仅 preferClientIds=新 client 发 focus
       → 成功：WS open-chat-result ok
       → 超时/失败：WS open-chat-result fail（不打旧窗）
```

## 4. Spike

### 4.1 范围

**内：** 最小扩展；手工/命令传入真实 `conversationId`；探测内部 `composer.*`（或同类）→ 必要时 CDP；记录 Cursor 版本与命令证据。  
**外：** daemon 注册、`/api/open-chat`、改面板、默认安装、通知入口。

### 4.2 过线判定

| 结果 | 含义 | 下一步 |
|------|------|--------|
| 过线 | ≥1 真实 id 可重复聚焦（关后再开仍可） | 进入产品实现 |
| 脆弱过线 | 仅 CDP/UI 自动化能做到 | 写清版本钉死与破碎风险，**再批一次**才实现 |
| 未过 | 无法进入对应 Chat | 停需求或改成功标准；不假装接线 |

### 4.3 产物

- 结论文档（本 spec 附录或 `docs/superpowers/specs/2026-08-05-cursor-watch-open-chat-spike-notes.md`）。  
- 可复现步骤（Command Palette 或脚本）。

建议路径：`cursor-watch/extensions/cursor-watch-bridge/`（Spike 可先最小，过线后在此演进为产品扩展）。

## 5. 产品接线（Spike 过线之后）

### 5.1 点击流

1. UI：`POST /api/open-chat`，body `{ conversationId, workspacePath }`。  
2. 白名单：`workspacePath` 须属于当前 **sessions 或 pending reminders**；`conversationId` 须匹配对应 session 或 reminder。  
3. Daemon Phase 1：`cursor -n <workspacePath>` → `activate Cursor` → 返回 `{ ok: true, stage: "opened" }`。  
4. Daemon Phase 2（后台）：仅当出现 **新的** bridge client（相对打开前 snapshot）时，`focus({ conversationId, workspacePath, preferClientIds })`；结果经面板 WS `open-chat-result` 推送。  
5. Toast：opened →「已打开 Cursor，正在定位 Chat」；focus 失败 →「已打开工程，未能定位 Chat…」（**不**向旧窗 focus）。

### 5.2 扩展 ↔ Daemon

- `POST /api/bridge/register`（localhost）：能力版本、可选 nonce；heartbeat；退出注销。  
- 多实例：以最新未过期 heartbeat 为准；focus 带 `workspacePath` 供扩展对齐窗口；Open Chat jump **必须** `preferClientIds` 指向新窗。  
- 启动自检可查询「桥是否在线」（与「扩展是否已安装」分开）。

### 5.3 失败分派

| 情况 | 行为 |
|------|------|
| 开工程（`-n`）失败 | 硬失败 toast（不进入 activate/focus） |
| opened 成功但无新桥 client / focus 失败 | **保留新窗**；toast/WS 说明未能定位 Chat；**不**向旧窗 focus |
| conversationId 无效/不存在 | 硬失败 |
| 白名单外路径 | 403 |

API Phase 1 返回 `{ ok: true, stage: "opened" }` 或 `{ ok: false, stage, error }`，`stage` ∈ `workspace` | `bridge` | `focus` | `opened`。  
Phase 2 经 WS：`{ type: "open-chat-result", payload: { ok, conversationId, workspacePath, error? } }`。

### 5.4 UI

- 保留现有 `↗`；只调用 **`POST /api/open-chat`**。  
- Toast：opened / focus 失败文案见 §5.1；监听 WS `open-chat-result` 更新最终结果。

## 6. 默认安装与启动自检

### 6.1 相对 Shell v1 的变更

`2026-07-29-cursor-watch-menubar-shell-design.md` 曾规定启动不自动装 hooks。本需求改为：**hooks + 桥扩展均为默认安装组件**。实现时同步 README / shell 文档表述。

### 6.2 时机

1. **App 安装 / 首次启动**：幂等执行 hooks install；用 `cursor --install-extension <bundled.vsix>` 安装捆绑扩展。  
2. **每次启动轻量自检**：检测 hooks 条目、扩展版本、桥在线状态；仅「未装或版本过旧」时补装；失败非阻塞提示。  
3. **区分**：扩展未安装 ≠ Cursor 未开导致桥未上线。

### 6.3 打包

- VSIX 打进 App / 包内资源，不依赖 Marketplace。  
- 非正式 App、未公证现状不变。  
- CLI（`npx cursor-watch open`）可复用同一套 ensure 逻辑；主路径仍是 App。

## 7. 错误处理、测试、风险

### 7.1 错误处理

- 用户可见失败一律明确 toast。  
- Heartbeat 过期视为离线，不用陈旧注册。

### 7.2 测试

- Spike：本机手工清单 + 结论文档；CI 不强制依赖 Cursor GUI。  
- 产品：register/heartbeat/超时/分派表单测（fake bridge）；路径白名单；UI 对 `stage` 的分支按现有风格测。  
- 扩展内真正调用 Cursor 内部 API 的部分以 Spike 证据 + 手工回归为主。

### 7.3 风险

- 无稳定 focus-by-id API → Spike 未过或仅脆弱过线。  
- 内部命令/CDP 随 Cursor 升级破碎 → 钉版本；破碎后降级「开工程 + 明确失败」。  
- 默认装 hooks 改变既有约定 → 文档/ADR 备注。  
- 多窗口误聚焦无法完全消除。

## 8. 文档与后续

- 过线并实现后：更新 README「定位不到具体 Agent/chat」为实际能力与限制。  
- 脆弱过线：在 spike-notes 写清钉死版本、破碎表现；获批后再开产品实现计划。  
- 本 spec 用户确认后：用 writing-plans 拆 **Spike 计划**（第一张）；产品接线计划仅在过线后另开或续写。

## 9. 架构示意（产品阶段）

```text
面板 ↗
  → POST /api/open-chat { conversationId, workspacePath }
      → openWorkspaceInCursor(path)
      → bridge.focus(...)   // 扩展已 register
          → Cursor 扩展：按 id 聚焦 Agent Chat
```

Spike 阶段无 daemon 转发；仅扩展本地验证 focus。
