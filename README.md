# Cursors Watch

[English](./README.en.md)

本机 **多个 Cursor Agent 会话** 的 Reminder 工具（包名仍为 `cursor-watch`）：会话 **Turn end** 时用系统通知 / HUD 叫你，并在收件箱留下待确认项；顺带可看哪些会话在跑、哪些在等你。

完成提醒依赖可选 **hooks**（`hooks install`）；未安装则不发系统 Reminder，仅提示安装。Active `/loop` 期间 hooks 的 `stop` 不算结束，不会误报。面板可 **打开对应工作区文件夹**（唤起本机 Cursor），但 **不会** 跳到某个具体 Agent/chat，也 **不会** 修改、注入或调度会话。

它不是任务中枢、不是远程监控，也不替代 Cursor 侧边栏。数据只读自本机 Cursor 目录（详见后文）；**仅支持 macOS**。面板仅监听 localhost，展示路径与消息摘录原文、不做脱敏——请勿把端口暴露到公网。

## 截图

在 Cursor 里写代码时，**Cursors Watch** 用系统通知 / HUD 打断你（无需切到浏览器）：

![在 Cursor 中工作时收到 Cursors Watch 提醒](./docs/images/Cursors1.png)

全屏面板：上方 **待确认 Reminder** 收件箱，下方 **运行中** 会话；顶栏可调列数、看状态计数、开关声音与全屏：

![Cursors Watch 面板：Reminder 收件箱与运行中会话](./docs/images/Cursors2.png)

## 要求

- **macOS**（仅此平台；非 macOS 请勿安装）
- **Node.js ≥ 20**（打包 / 开发需要；用 `.dmg` 安装的 App 已内嵌运行时）
- 本机已安装 **Cursor**
- 本机有过 Agent 会话时，才会在 `~/.cursor/projects` 下产生可扫描数据（没有 Agent 会话时面板可能为空）
- 纯本地运行：不需要网络或额外账号

## 安装（推荐：菜单栏 App）

日常用法是安装非正式 App **Cursors Watch**（菜单栏 `CW`），不必每次 `npx` 再开浏览器。

```bash
git clone git@github.com:zhangchengk/Cursors.git
cd Cursors/cursor-watch
npm install
npm run package:dmg           # 生成 .dmg
# 或本机直接覆盖安装：
npm run package:app:install   # → /Applications/Cursors Watch.app
```

- **`.dmg` 产物**：`macos/CursorWatch/dist/Cursors-Watch-<version>.dmg`  
  打开后把 **Cursors Watch** 拖进 Applications。未公证；首次打开若被拦，在「系统设置 → 隐私与安全性」允许即可。
- 安装后从「应用程序」打开：**登录时打开**默认开启（菜单可关）；壳负责拉起 daemon、打开面板。
- **Reminder**：优先壳的系统通知；权限未开或失败则壳内 **HUD** 浮层兜底。
- 若 `7423` 上已是本服务的旧 daemon，壳会**接管**并打开面板；只有被其它程序占用才会报错。
- 更新：再跑 `package:dmg` / `package:app:install` 覆盖。不含 hooks 一键安装与自动更新。

技术标识保持 `cursor-watch` / `com.cursor-watch.*`；人看见的名字是 **Cursors Watch**。

### 开发 / CLI（可选）

本包为私有仓库工具，**不能**从 npm registry 安装；也**不要**执行 `npm i -g cursor-watch`。

```bash
cd Cursors/cursor-watch
npx cursor-watch open     # 按需拉起 daemon，并用浏览器打开面板
npx cursor-watch status
npx cursor-watch stop
npm link                  # 可选：任意目录可用 cursor-watch
```

- 默认面板：`http://127.0.0.1:7423`（环境变量 `CURSOR_WATCH_PORT` 可改）
- 开发自检：`npm test`；热重载：`npm run dev`
- 调试壳（不装到 Applications）：

```bash
CURSOR_WATCH_ROOT="$PWD" open "macos/CursorWatch/dist/Cursors Watch.app"
```

### Hooks（可选，发 Reminder 需要）

```bash
npx cursor-watch hooks install
npx cursor-watch hooks status
npx cursor-watch hooks uninstall
```

不安装也可看面板：「在跑 / 等待」主要靠 transcript 与 terminals，可能略滞后。安装后多一路 LIVE 快照，可触发 **Reminder**（通知 + 收件箱），并显示迷你滚动与更准的「在跑」——**仍非毫秒级遥测**。Active `/loop` 的 tick 间隙 `stop` 会被压制。hooks 失败不影响 Cursor 本身。

## 面板怎么读

- 顶栏产品名 **Cursors Watch**；可调注意力列数（默认 2）、状态色点计数、**声音**、**全屏**（`F`；在 App 内走系统全屏）。
- 主区 **待确认 Reminder**：Turn end 等需要你看的项；可单条 **确认** 或 **全部确认**。点 ↗ 打开工作区文件夹（不定位到某个 chat）。
- **运行中**：当前 LIVE / 进行中的会话卡片。
- 可切换 **注意力** / **按工程**；窄屏注意力强制 1 列。
- **保留策略**（服务端）：未读一直保留；进行中始终可见；已读且「本轮结束」约 **30 分钟**；纯 idle 约 **15 分钟**。
- 色点：运行中、等待查看、子任务、空闲/已读、出错。
- 卡片标题优先用侧边栏 chat 名；否则回退首条用户消息摘要。

## 架构鸟瞰

```text
Cursors Watch.app（菜单栏壳）
        │  内嵌 Node + cursor-watch
        ▼
   daemon（常驻，默认 :7423）
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
         WKWebView 面板（或浏览器）
                  │
         Reminder：壳系统通知 → HUD 兜底
```

流程要点：

1. 打开 App（或 `cursor-watch open`）拉起 / 接管 daemon，再打开面板。
2. watcher 发现变更后由 scan-worker 扫描并推断状态，写入内存 store。
3. 面板 `GET /api/sessions` + `/ws` 近实时刷新；Reminder 另走 `/api/reminders` 与通知通道。
4. 展示前聚合子会话、丢掉已不存在的工作区，并按分层保留策略裁剪。

## 信任边界

- HTTP/WebSocket **仅监听** `127.0.0.1`（默认端口 `7423`）。
- 面板展示工作区路径与消息摘要的**原文**，不做脱敏。
- **不要**把端口暴露到公网，也不要通过反向代理给其他人访问。
- **只读范围**：扫描 `~/.cursor/projects` 与 `composerHeaders` 时不写回会话内容。
- **写盘例外**：仅 `hooks install` 写入 `~/.cursor/hooks.json`、`~/.cursor/hooks/` 与运行时的 `~/.cursor-watch/live`。
- 「在 Cursor 中打开」只接受**当前已扫描会话**里出现过的工作区路径。
- 服务本身**无登录鉴权**：信任边界等于「能登录这台 Mac 的用户」。

## 附录：实现说明

### 模块职责

| 模块 | 作用 |
|---|---|
| `cli.ts` | `open` / `status` / `stop` / `daemon` / `hooks` |
| `daemon.ts` | 写 pid、起 HTTP、挂 watcher |
| `watcher.ts` + `scan-worker.ts` | 文件监听；子进程扫描 |
| `scanner.ts` | 遍历 projects、解析 transcript / terminals、合并 live |
| `aggregator.ts` | 子会话并入父会话；过滤不可见会话 |
| `infer/status.ts` | 由 transcript + shell 推断 `AgentStatus` |
| `live-state.ts` / `reminders/*` | LIVE、Turn end Reminder、通知适配器 |
| `open-workspace.ts` | 校验路径后 `open -a Cursor <path>` |
| `server.ts` | 静态资源、`/api/*`、`/ws` |
| `web/*` | 面板 UI（收件箱 + 运行中） |
| `macos/CursorWatch` + `scripts/package-*.sh` | 菜单栏壳、`.app` / `.dmg` 打包 |

### 数据源

| 路径 | 用途 |
|---|---|
| `~/.cursor/projects/<key>/agent-transcripts/` | 会话 JSONL |
| 同项目下 terminals | Shell 是否仍在跑 / 退出码 |
| Cursor 本地 DB `composerHeaders` | chat 名称、`hasUnread` 等 |
| `~/.cursor-watch/live/<conversationId>.json` | hooks LIVE 快照（可选） |
| `~/.cursor-watch/shell-notify/` | 壳通知桥（`shell.alive` + intent JSON） |

扫描时跳过 mtime 早于 **7 天**（`SCAN_LOOKBACK_MS`）的 transcript。

### 关键常量

| 常量 | 默认 | 含义 |
|---|---|---|
| `DEFAULT_PORT` | `7423` | 监听端口（可用 `CURSOR_WATCH_PORT` 覆盖） |
| `TURN_ENDED_KEEP_MS` | 30min | 已读且 turnEnded 的最长保留 |
| `IDLE_KEEP_MS` | 15min | 纯 idle 的最长保留 |
| `RUNNING_WINDOW_MS` | 2min | 「最近活跃」窗口 |
| `LIVE_TTL_MS` | 60s | live 快照视为 LIVE 的时长 |
| `RECENT_MESSAGE_COUNT` | 8 | 抽屉最近消息条数 |

### 状态与聚合（要点）

1. 工具失败或 shell 非 0 → `error`
2. 近期工具/shell 活动 → `running`
3. 有子 Agent 在跑 → `subagent`
4. 最后一条是 assistant → `waiting`
5. 否则 → `idle`

**LIVE 盖写（非 error）**：live → 强制 `running`；turn ended 或非运行态 → 按未读变为 `waiting` / `idle`。

### HTTP / WebSocket

| 接口 | 说明 |
|---|---|
| `GET /api/health` | `{ ok: true }` |
| `GET /api/sessions` | 当前 `SessionState[]` |
| `GET /api/reminders` | Reminder 收件箱 |
| `POST /api/open-workspace` | body `{ path }` |
| `GET /ws` | `sessions` / `reminders` 推送 |

### Hooks

`hooks install` 向用户级 `~/.cursor/hooks.json` 注册（可卸载）：

- `preToolUse`
- `afterAgentResponse`
- `stop`

观察脚本写入 `~/.cursor-watch/live/`；失败不拖垮 Agent。

### 测试与打包

```bash
npm test                 # vitest
npm run build            # tsc
npm run package:app      # 仅构建 .app
npm run package:app:install
npm run package:dmg      # 分发用 .dmg
```
