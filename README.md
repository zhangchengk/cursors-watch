# Cursors Watch

[English](./README.en.md)

Cursors Watch 监控本机多个 Cursor Agent 会话。面向本机使用 Cursor Agent 的开发者；推荐从下方「安装」开始，装好菜单栏 App 后打开面板。

并列主职有两项：

1. Reminder（提醒）：对话 Turn end 时通过系统通知或 HUD 打断，并在面板收件箱留下一条待确认项；下方「运行中」列出当前仍在跑的会话。
2. Chat library（会话馆藏）：将有意义的 Agent Chat 标为 Todo（代办）或 Archive（归档）；可写标题与备注、绑定本机 `.md` / `.html` 附件，并放入各自独立、任意深度的本机全局文件夹树，便于回看落地或本机当面宣讲。

面板顶层三个 Tab：`Reminder`（启动默认）、`Todo`、`Archive`。一条 Chat 至多一个馆藏状态（无标注 / 代办 / 归档），与收件箱是否待确认无关；不会根据未读或 Turn end 自动打标。

发 Reminder 需要 hooks；打开对应 Agent Chat 需要桥扩展。两者随 App / `open` 默认安装并自检。会话仍处在 Active `/loop` 时，hooks 打出的 `stop` 不视为结束，避免误报。面板 `↗` 先打开该会话工作区，再经桥扩展聚焦对应 Chat（已在 Cursor 3.13.x 验证；属半内部 API，大版本升级后若失效则降级为只开工程并 toast）。不修改会话内容，也不代为调度任务。

## 截图

在 Cursor 中编写代码时，Cursors Watch 通过系统通知 / HUD 提醒（无需切换到浏览器）：

![在 Cursor 中工作时收到 Cursors Watch 提醒](./docs/images/Cursors1.png)

全屏面板：顶层为 Reminder / Todo / Archive；Reminder 内上方为「待确认」收件箱、下方为「运行中」；顶栏可调列数、查看状态计数、开关声音、打开设置与全屏：

![Cursors Watch 面板：Reminder 收件箱与运行中会话](./docs/images/Cursors2.png)

## 要求

- macOS（仅此平台；非 macOS 请勿安装）
- Node.js ≥ 20（打包 / 开发需要；用 `.dmg` 安装的 App 已内嵌运行时）
- 本机已安装 Cursor
- 本机有过 Agent 会话后，`~/.cursor/projects` 下才会产生可扫描数据（无 Agent 会话时面板可能为空）
- 纯本地运行：不需要网络或额外账号

## 安装（推荐：菜单栏 App）

日常用法是安装非正式 App Cursors Watch（菜单栏缩写 `CW`），无需每次 `npx` 再开浏览器。

```bash
git clone git@github.com:zhangchengk/cursors-watch.git
cd cursors-watch/cursor-watch
npm install
npm run package:dmg           # 生成 .dmg
# 或本机直接覆盖安装：
npm run package:app:install   # → /Applications/Cursors Watch.app
```

- `.dmg` 产物：`macos/CursorWatch/dist/Cursors-Watch-<version>.dmg`。打开后将 Cursors Watch 拖入 Applications。未公证；首次打开若被拦截，在「系统设置 → 隐私与安全性」中允许即可。
- 安装后从「应用程序」打开。「登录时打开」默认开启（可在菜单关闭）。菜单栏壳负责拉起 daemon 并打开面板。
- Reminder：优先使用壳的系统通知；权限未开或投递失败时，改用壳内 HUD 浮层。
- 菜单栏 App 启动时：若端口 `7423` 上已是本服务的 daemon，默认先停掉再拉起捆绑包内的进程，避免面板已更新而 API 仍是旧路由。需要沿用已有 daemon 时设置 `CURSOR_WATCH_ADOPT_DAEMON=1`。端口被其它程序占用时仍会报错。CLI `cursor-watch open` 仍会复用已在跑的本服务。
- 打开 App / 执行 `cursor-watch open` 时会自检并尽量安装 hooks 与桥扩展。更新时再跑 `package:dmg` / `package:app:install` 覆盖安装。不含自动更新。
- 完全磁盘访问：首次启动若尚未授权，壳会询问一次，并引导至「系统设置 → 隐私与安全性 → 完全磁盘访问权限」勾选 Cursors Watch（菜单栏右键也可再次打开）。授权后通常无需再对桌面、文稿等逐个允许。安装脚本使用本机固定签名证书（`~/.cursor-watch/codesign.keychain`），避免覆盖安装后因 ad-hoc 签名变化丢失权限并再次弹窗。

技术标识保持 `cursor-watch` / `com.cursor-watch.*`；面向用户的显示名为 Cursors Watch。

### 开发 / CLI（可选）

本包为私有仓库工具，不能从 npm registry 安装；也不要执行 `npm i -g cursor-watch`。

```bash
cd cursors-watch/cursor-watch
npx cursor-watch open     # 按需拉起 daemon，并用浏览器打开面板
npx cursor-watch status
npx cursor-watch stop
npm link                  # 可选：任意目录可用 cursor-watch
```

- 默认面板：`http://127.0.0.1:7423`（可用环境变量 `CURSOR_WATCH_PORT` 覆盖）
- 开发自检：`npm test`；热重载：`npm run dev`
- 调试壳（不安装到 Applications）：

```bash
CURSOR_WATCH_ROOT="$PWD" open "macos/CursorWatch/dist/Cursors Watch.app"
```

### Hooks（可选，发 Reminder 需要）

```bash
npx cursor-watch hooks install
npx cursor-watch hooks status
npx cursor-watch hooks uninstall
```

未安装 hooks 也可查看面板：「在跑」主要依据 transcript 与 terminals 推断，可能略有滞后。安装 hooks 后增加 LIVE 快照通道，才能触发 Reminder（通知 + 收件箱），「在跑」判定也更准确，但仍不是毫秒级遥测。Active `/loop` 哨兵仍在时，tick 间隙的 `stop` 会被压制。hooks 失败不影响 Cursor 本身。

## 面板说明

### 顶栏与 Tab

- 顶栏：品牌名、列表列数（默认 2；视口宽度小于 720px 时强制 1 列；Reminder 与 Todo / Archive **共用同一 N**）、状态色点计数、声音（默认静音）、设置、全屏（`F`；App 内为系统全屏）。
- 三个 Tab：`Reminder`、`Todo`、`Archive`。上次选中的 Tab 记在本机；冷启动仍默认 Reminder。

### Reminder

- 上方「待确认 Reminder」：Turn end 后需人工确认的项；未装 hooks 时提示安装命令；可单条或全部确认，点击系统通知也可确认。
- 下方「运行中」：只列出 LIVE / `running` / `subagent`。
- 卡片「馆藏」：标为 Todo / Archive（可填标题、备注、目标树文件夹；**不含**附件与优先级）；标注后留在 Reminder，不跳转 Tab。
- `↗`：打开工作区并尽量聚焦对应 Chat。

### Todo / Archive（馆藏整理）

- 左侧文件夹树（顶项「全部」= 本 Tab 全量，固定置顶、不可拖），右侧条目列表。同父（含根级）文件夹可上下拖拽改相对顺序，写入馆藏树（侧栏与文件夹下拉同一序）；拖拽不改父级。新建文件夹落在同级末尾。写入失败会 toast，并恢复为馆藏库中的顺序。
- **折叠 / 展开**（按文件夹各自记忆，Todo 树与 Archive 树不共用）：折叠后隐藏备注与附件，仅留标题行与底栏；**默认折叠**。紧凑态下标题最多两行、灰色 meta 一行（超出省略，悬停可看全文），同列卡片等高。展开后备注/附件完整显示，不套限高。
- **Archive 搜索**（仅 Archive）：列表标题行搜索框；在当前文件夹视图内按标题 / 会话名 / 备注做子串、大小写不敏感过滤；空白不过滤。换文件夹保留关键字；离开 Archive Tab 清空。侧栏目录数字仍为全量，不随搜索变化。Todo 无此搜索。
- 可创建、改名、删除文件夹；可改馆藏标题与备注；可在代办 ↔ 归档间互迁（落到目标树「全部」/不进文件夹；标题、备注与附件保留，**Todo 优先级丢弃**）；可取消标注（丢弃标题、备注、附件、优先级与文件夹归属）。
- 源会话不可用时条目仍保留并标为失效；附件与 Todo 优先级仍可管理；`↗` 可能失败并以 toast 提示。

### Todo 优先级

- 仅 Todo 整理面：互斥三档「紧急 / 重要 / 无」（卡片三段控件；编辑对话框亦可改）。新标 Todo 默认为「无」。
- 打开「全部」或某文件夹时，按紧急 → 重要 → 无排序；同档内保持原相对顺序。Archive 无此字段。

### 馆藏附件

- 仅在 Todo / Archive 整理面绑定；一条目可挂多个，按添加顺序混排，绝对路径去重。
- 允许扩展名：`.md`、`.html`（不含 `.htm`）；不强制落在该 Chat 工作区内；只存路径引用，不拷贝文件内容。
- 「预览」按类型分流：`.md` → 面板内只读 Markdown；`.html` → 系统默认浏览器打开。次要动作可在 Finder 中显示。失败以 toast 提示。
- 文件被挪走后引用仍保留，列表标为不可用。

### 设置与其它展示

- 外观四套主题（Blueprint 默认；另有 Phosphor、Ink、Brass）。
- 工作区别名：已知工程绝对路径 → 短名，仅面板展示层覆盖，悬停仍可看全路径；通知与 HUD 文案在 v1 不解析别名。别名与声音等同属本机 prefs；清空馆藏不会删除别名。
- 会话快照保留：未读一直保留；进行中始终可见；已读且本轮结束约 30 分钟；纯 idle 约 15 分钟。顶栏色点统计全部会话（含未在「运行中」列出的 waiting / idle / error）。
- 卡片标题优先侧边栏 chat 名，否则首条用户消息摘要；馆藏列表主行优先馆藏标题。

## 架构概览

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
        ├─ ReminderHub / LibraryHub / prefs
        │         │              ──读写──►  ~/.cursor-watch/
        │         │                    （reminders / library / prefs / …）
        │         ▼
        └─ Fastify：静态面板 + /api/* + /ws
                  │
                  ▼
         WKWebView 面板（或浏览器）
                  │
         Reminder：壳系统通知 → 失败时 HUD 浮层
```

流程要点：

1. 打开 App 拉起捆绑包 daemon（默认不接管旧进程）；或执行 `cursor-watch open` 拉起或复用已在跑的本服务。随后自检 hooks 与桥扩展，再打开面板。
2. watcher 发现变更后，由 scan-worker 扫描并推断状态，写入内存 store。
3. 面板通过 `GET /api/sessions` 与 `/ws` 近实时刷新；Reminder 与 library 另有 REST 与 WebSocket 推送；prefs 走 `/api/prefs`。
4. 展示前聚合子会话、丢弃已不存在的工作区，并按分层保留策略裁剪。馆藏条目不因会话被 prune 而自动删除。

## 信任边界

- HTTP / WebSocket 仅监听 `127.0.0.1`（默认端口 `7423`）。
- 面板展示工作区路径与消息摘要的原文，不做脱敏。
- 勿将端口暴露到公网，也勿通过反向代理供他人访问。
- 只读范围：扫描 `~/.cursor/projects` 与 `composerHeaders` 时不写回会话内容。
- 写盘例外：`hooks install` 写入 `~/.cursor/hooks.json`、`~/.cursor/hooks/`；运行时写入 `~/.cursor-watch/` 下的 live、reminders、library、prefs、loop-ledger、shell-notify 等。馆藏附件只存路径引用，预览时按路径读盘（html 则交给默认浏览器），不把附件内容拷贝进 watch home。
- 「在 Cursor 中打开」/ Open Chat 只接受当前已扫描会话、待确认 Reminder 或馆藏条目中出现过的工作区路径。
- 服务本身无登录鉴权：信任边界等于能登录本机 Mac 的用户。

## 附录：实现说明

### 模块职责

| 模块 | 作用 |
|---|---|
| `cli.ts` | `open` / `status` / `stop` / `daemon` / `hooks` |
| `daemon.ts` | 写 pid、起 HTTP、挂 watcher、自检组件 |
| `ensure-components.ts` | hooks + 桥扩展默认安装与自检 |
| `watcher.ts` + `scan-worker.ts` | 文件监听；子进程扫描 |
| `scanner.ts` | 遍历 projects、解析 transcript / terminals、合并 live |
| `aggregator.ts` | 子会话并入父会话；过滤不可见会话 |
| `infer/status.ts` | 由 transcript + shell 推断 `AgentStatus` |
| `live-state.ts` / `reminders/*` | LIVE、Turn end Reminder、通知适配器 |
| `library/*` | Chat library 状态、失效判定、附件路径；`.md` 预览与 `.html` 默认浏览器打开 |
| `prefs.ts` | 通知声音、工作区别名、面板主题 |
| `loop-ledger/*` | Active `/loop` 哨兵账本（压制误报） |
| `open-workspace.ts` | 校验路径后 `open -a Cursor <path>` |
| `open-chat.ts` / `bridge/hub.ts` | 开工程 + 经扩展桥聚焦 Chat |
| `server.ts` | 静态资源、`/api/*`、`/ws`、`/ws/bridge` |
| `web/*` | Reminder 收件箱 + Todo / Archive 馆藏 + 设置 |
| `macos/CursorWatch` + `scripts/package-*.sh` | 菜单栏壳、`.app` / `.dmg` 打包 |

### 数据源

| 路径 | 用途 |
|---|---|
| `~/.cursor/projects/<key>/agent-transcripts/` | 会话 JSONL |
| 同项目下 terminals | Shell 是否仍在跑 / 退出码 |
| Cursor 本地 DB `composerHeaders` | chat 名称、`hasUnread` 等 |
| `~/.cursor-watch/live/<conversationId>.json` | hooks LIVE 快照（可选） |
| `~/.cursor-watch/reminders.json` | 待确认 Reminder |
| `~/.cursor-watch/library.json` | Todo / Archive 馆藏与文件夹树 |
| `~/.cursor-watch/prefs.json` | 声音、工作区别名、`uiTheme` |
| `~/.cursor-watch/shell-notify/` | 壳通知桥（`shell.alive` + intent JSON） |

扫描时跳过 mtime 早于 7 天（`SCAN_LOOKBACK_MS`）的 transcript。

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
2. 近期工具 / shell 活动 → `running`
3. 有子 Agent 在跑 → `subagent`
4. 最后一条是 assistant → `waiting`
5. 否则 → `idle`

LIVE 盖写（非 error）：live → 强制 `running`；turn ended 或非运行态 → 按未读变为 `waiting` / `idle`。

### HTTP / WebSocket

| 接口 | 说明 |
|---|---|
| `GET /api/health` | `{ ok: true }` |
| `GET /api/sessions` | 当前 `SessionState[]` |
| `GET /api/reminders` | 待确认 Reminder 列表 |
| `POST /api/reminders/:conversationId/ack` | 确认一条 Reminder |
| `GET /api/library` | 馆藏快照（folders + entries，含 `stale`） |
| `POST /api/library/entries` | 标注 / 更新条目 |
| `PATCH /api/library/entries/:conversationId` | 改 mark / 标题 / 备注 / 文件夹 / Todo 优先级 |
| `DELETE /api/library/entries/:conversationId` | 取消标注 |
| `POST/DELETE …/attachments` | 绑定 / 解绑本机 `.md` / `.html` 路径 |
| `GET …/attachments/preview` | 只读预览 `.md` 附件内容 |
| `POST …/attachments/open` | 用默认浏览器打开 `.html` 附件 |
| `POST …/attachments/reveal` | Finder 显示附件 |
| `POST/PATCH/DELETE /api/library/folders[/:id]` | 文件夹 CRUD |
| `POST /api/library/folders/reorder` | 同级重排；body `{ orderedIds }` 须为完整兄弟集合 |
| `GET/PUT /api/prefs` | 读取 / 部分合并本机偏好 |
| `GET /api/hooks-status` | hooks 是否已安装 |
| `POST /api/open-workspace` | body `{ path }` |
| `POST /api/open-chat` | body `{ conversationId, workspacePath }` → 开工程并聚焦 Chat |
| `GET /api/bridge-status` | `{ online, extensionVersion? }` |
| `GET /ws` | 推送 `sessions` / `reminders` / `library` |
| `GET /ws/bridge` | 桥扩展连接 |

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
