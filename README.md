# cursor-watch

[English](./README.en.md)

## 它是什么

`cursor-watch` 是本机 **Cursor Agent 只读态势面板**：在浏览器里查看哪些会话在跑、哪些在等你处理。

多工程并行时，面板可在「注意力」与「按工程」双视图间切换：注意力按紧迫度排成可配置多列队列，按工程恢复分组墙。并标出未读与「本轮结束」。可选安装 hooks 后可显示 LIVE 迷你滚动与更准的「在跑」状态。面板上可 **打开对应工作区文件夹**（唤起本机 Cursor），但 **不会** 跳到某个具体 Agent/chat，也 **不会** 修改、注入或调度会话。

它不是任务中枢、不是远程监控，也不替代 Cursor 侧边栏。数据只读自本机 Cursor 目录（详见后文）；**仅支持 macOS**（拉起浏览器与打开工作区依赖系统的 `open` / `open -a Cursor`，其它平台不做兼容）。面板仅监听 localhost，展示路径与消息摘录原文、不做脱敏——请勿把端口暴露到公网。

## 截图

![Cursor Agent 态势面板：扁平注意力队列会话卡片，含 LIVE 与状态计数](./docs/images/panel.png)

## 要求

- **macOS**（仅此平台；非 macOS 请勿安装）
- **Node.js ≥ 20**
- 本机已安装 **Cursor**
- 本机有过 Agent 会话时，才会在 `~/.cursor/projects` 下产生可扫描数据（没有 Agent 会话时面板可能为空）
- 纯本地运行：不需要网络或额外账号

## 安装

本包为私有仓库工具，**不能**从 npm registry 安装；也**不要**执行 `npm i -g cursor-watch`（会装到无关的同名包或直接失败）。

```bash
git clone git@github.com:zhangchengk/Cursors.git
cd Cursors/cursor-watch
npm install
```

之后须在 **`cursor-watch` 目录内**用本地包启动（`npx` 解析的是本仓库的 `bin`，不是公网包）：

```bash
npx cursor-watch open
```

若希望任意目录都能调用命令，可在同一目录执行一次：

```bash
npm link
# 然后任意处：
cursor-watch open
```

`npm link` / `npx` 都指向本仓库，不经过 registry。开发自检可用 `npm test`；热重载调试可用 `npm run dev`。

## 使用

```bash
npx cursor-watch open    # 按需拉起 daemon，并打开面板
npx cursor-watch status  # 查看 daemon / 端口状态（JSON）
npx cursor-watch stop    # 停止 daemon
```

- 默认面板：`http://127.0.0.1:7423`
- 改端口：环境变量 `CURSOR_WATCH_PORT`

在面板上点卡片或抽屉里的 **↗ /「在 Cursor 中打开」**，会在本机 Cursor 中打开该会话对应的**工作区文件夹**（不是某个 Agent/chat）。顶栏可全屏（快捷键 `F`）。

### Hooks（可选）

```bash
npx cursor-watch hooks install
npx cursor-watch hooks status
npx cursor-watch hooks uninstall
```

不安装也可使用面板：此时「在跑 / 等待」主要靠 transcript 与 terminals 推断，可能略滞后或漏报。

安装后多一路 LIVE 快照（工具调用 / 回复 / stop），可显示迷你滚动（工具与动作提示条），并对「在跑」更敏感——**仍非毫秒级遥测**，不要当成实时真相源。hooks 脚本失败时不影响 Cursor 本身。

## 面板怎么读

- 顶栏可切换 **注意力** / **按工程**；注意力默认 2 列，可调 1–4，偏好记在本机（localStorage）。
- 注意力按紧迫度排序，卡片有工程路径条；按工程模式恢复分组墙（组内 Top4 + 未读/本轮结束提醒）。窄屏（&lt;720px）注意力强制 1 列，不改已存偏好。没有全局「更多」历史区。
- **保留策略**（服务端单一真相）：未读一直保留；进行中始终可见；已读且「本轮结束」最多约 **30 分钟**；纯 idle 最多约 **15 分钟**。
- 顶栏彩色圆点是全局会话计数（与卡片状态点同色）：运行中、等待查看、子任务、空闲/已读、出错。
- 卡片标题优先用 Cursor Agent 侧边栏的 chat 名称；没有则回退到首条用户消息摘要。
- **LIVE** 会话显示迷你滚动（或 LIVE 徽标）；安装 hooks 后更及时。
- **未读**：来自 Cursor `composerHeaders` 的 `hasUnread`（侧边栏未读语义）；卡片上显示「有未读 · 请查看」。
- **本轮结束**：hooks 收到 `stop` 后写入 live 快照的 `turnEnded`；无 hooks 时通常看不到这条提醒。
- 点击卡片打开侧栏抽屉（单会话详情：状态说明与最近消息摘录）。
- **↗** **仅打开工作区文件夹，不定位到某一个 chat**。

## 架构鸟瞰

```text
CLI (open/status/stop)
        │
        ▼
   daemon（常驻）
        │
        ├─ watcher + scan-worker  ──只读──►  ~/.cursor/projects
        │         │                    （transcripts / terminals）
        │         │              ──可选──►  ~/.cursor-watch/live（hooks）
        │         │              ──只读──►  composerHeaders（chat 名 / 未读）
        │         ▼
        │      SessionStore
        │         │
        └─ Fastify：静态面板 + /api/* + /ws
                  │
                  ▼
            浏览器面板（WebSocket 近实时刷新）
```

流程要点：

1. `cursor-watch open` 若端口未监听则拉起 daemon，再打开浏览器。
2. watcher（chokidar）发现变更后，由 scan-worker 扫描并推断会话状态，写入内存 store。
3. 面板通过 `GET /api/sessions` 取快照，经 `/ws` 接收后续更新。
4. 展示前会聚合子会话、丢掉工作区目录已不存在的项，并按分层保留策略裁剪（未读 / 进行中 / turnEnded≤30min / idle≤15min）。
5. 「在跑 / 等待 / LIVE」等状态由 transcript、terminals 与可选 live 快照共同推断（细则见附录）。

## 信任边界

- HTTP/WebSocket **仅监听** `127.0.0.1`（默认端口 `7423`）。
- 面板展示工作区路径与消息摘要的**原文**，不做脱敏。
- **不要**把端口暴露到公网，也不要通过反向代理给其他人访问。
- **只读范围**：扫描 `~/.cursor/projects`（transcripts / terminals）与 `composerHeaders` 时不写回会话内容。
- **写盘例外**：仅在你执行 `hooks install` 时写入 `~/.cursor/hooks.json`、`~/.cursor/hooks/` 与运行时的 `~/.cursor-watch/live`；可用 `hooks uninstall` 卸下。
- 「在 Cursor 中打开」只接受**当前已扫描会话**里出现过的工作区路径，其它路径会被拒绝。
- 服务本身**无登录鉴权**：能访问该端口的人就能看到路径与消息摘录原文；信任边界等于「能登录这台 Mac 的用户」。

## 附录：实现说明

### 模块职责

| 模块 | 作用 |
|---|---|
| `cli.ts` | `open` / `status` / `stop` / `daemon` / `hooks` |
| `daemon.ts` | 写 pid、起 HTTP、挂 watcher |
| `watcher.ts` + `scan-worker.ts` | 文件监听；子进程扫描，避免阻塞 listen |
| `scanner.ts` | 遍历 projects、解析 transcript / terminals、合并 live 与 composer meta |
| `aggregator.ts` | 子会话并入父会话；过滤不可见会话 |
| `infer/status.ts` | 由 transcript + shell 推断 `AgentStatus` |
| `live-state.ts` | hooks 快照 → `live` / `turnEnded`，并盖写状态 |
| `chat-names.ts` | 只读 `composerHeaders`：chat 名、未读等 |
| `open-workspace.ts` | 校验路径后，macOS 用 `open -a Cursor <path>` |
| `server.ts` | 静态资源、`/api/*`、`/ws` |
| `web/*` | 面板 UI、双视图（注意力 / 按工程）、抽屉文案 |

### 数据源

| 路径 | 用途 |
|---|---|
| `~/.cursor/projects/<key>/agent-transcripts/` | 会话 JSONL |
| 同项目下 terminals | Shell 是否仍在跑 / 退出码 |
| Cursor 本地 DB `composerHeaders` | chat 名称、`hasUnread` 等 |
| `~/.cursor-watch/live/<conversationId>.json` | hooks 写入的 LIVE 快照（可选） |

扫描时跳过 mtime 早于 **7 天**（`SCAN_LOOKBACK_MS`）的 transcript。

### 关键常量

| 常量 | 默认 | 含义 |
|---|---|---|
| `DEFAULT_PORT` | `7423` | 监听端口（可用 `CURSOR_WATCH_PORT` 覆盖） |
| `TURN_ENDED_KEEP_MS` | 30min | 已读且 turnEnded 的最长保留 |
| `IDLE_KEEP_MS` | 15min | 纯 idle 的最长保留 |
| `RUNNING_WINDOW_MS` | 2min | 「最近活跃」窗口，用于判定 running |
| `LIVE_TTL_MS` | 60s | live 快照视为 LIVE 的时长 |
| `RECENT_MESSAGE_COUNT` | 8 | 抽屉最近消息条数 |

### 状态与聚合（要点）

**推断顺序（简化）**

1. 工具失败或 shell 非 0 → `error`
2. 近期工具/shell 活动 → `running`
3. 有子 Agent 在跑 → `subagent`
4. 最后一条是 assistant → `waiting`
5. 否则 → `idle`

**LIVE 盖写（非 error）**：hooks 显示 live → 强制 `running`；turn ended 或非运行态 → 按未读变为 `waiting` / `idle`。

**聚合后保留**：工作区目录仍存在，且通过分层可见性（未读无上限；进行中可见；已读 turnEnded ≤30min；纯 idle ≤15min）。

### HTTP / WebSocket

| 接口 | 说明 |
|---|---|
| `GET /api/health` | `{ ok: true }` |
| `GET /api/sessions` | 当前 `SessionState[]` |
| `POST /api/open-workspace` | body `{ path }`；成功 `{ ok: true }`，否则 4xx/5xx + `error` |
| `GET /ws` | 推送 `{ type: "sessions", payload: SessionState[] }` |

打开工作区时 **不传** Cursor CLI 的 `-r`（避免复用错误窗口）；macOS 固定 `open -a Cursor <folder>`。

### `SessionState` 常用字段

| 字段 | 含义 |
|---|---|
| `id` / `projectKey` | 会话与 Cursor project key |
| `workspacePath` / `workspaceLabel` | 工程路径与展示名 |
| `status` | `waiting` \| `running` \| `subagent` \| `idle` \| `error` |
| `summary` / `chatName` | 摘要 / 侧边栏名称 |
| `currentAction` / `liveHint` | 当前动作与 LIVE 提示 |
| `hasUnread` / `live` / `turnEnded` | 未读、LIVE、本轮结束 |
| `recentMessages` | 最近消息（抽屉） |
| `lastActivityAt` 等时间戳 | 排序与窗口判断 |

### Hooks

`hooks install` 向用户级 `~/.cursor/hooks.json` 注册（标记可卸载）：

- `preToolUse`
- `afterAgentResponse`
- `stop`

观察脚本写入 `~/.cursor-watch/live/`；超时与失败按 Cursor hooks 约定处理，不拖垮 Agent。

### 测试

```bash
npm test          # vitest
npm run build     # tsc
```
