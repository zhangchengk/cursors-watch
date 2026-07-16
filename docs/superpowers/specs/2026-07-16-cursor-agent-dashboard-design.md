# Cursor Agent 态势面板（cursor-watch）设计

状态：已评审共识  
日期：2026-07-16  
仓库：`/Users/zhangcheng/idea/Cursors`

## 1. 问题与目标

### 1.1 痛点

本地多开多个 Cursor（不同工程 / 同一工程不同工作区），每个 Cursor 内又并行多个 Agent 会话与 subagent。任务一多，无法一眼知道：

- 谁在跑、谁在等我、谁闲着
- 某个会话当前在干什么
- 哪个会话已经等了很久却被忘掉

### 1.2 目标（MVP）

做一个**本机态势感知面板**（只读）：实时汇总所有 Cursor Agent 会话状态，降低认知负担。

**非目标（MVP）**：任务调度、暂停/取消 Agent、菜单栏 App、登录自启、内容脱敏。

### 1.3 成功标准

| 指标 | 标准 |
|------|------|
| 首屏 | 打开面板 ≤3s 内看到活跃 + 等你会话 |
| 列表规模 | 典型多开场景下列表 ≤20 条，可扫一眼 |
| 刷新 | 新消息 / 新 tool 调用 ≤3s 反映到面板 |
| 区分度 | 卡片上可肉眼区分工程（workspace 路径） |

## 2. 决策记录

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 核心目标 | 态势感知（只看） |
| 2 | 卡片字段 | 状态 / workspace 路径 / 当前动作 / 时长 / 会话摘要 |
| 3 | 数据采集 | MVP：文件监听；v2：加 Cursor Hooks |
| 4 | UI | 纯 Web 面板（`localhost`） |
| 5 | 会话过滤 | 30min 内活跃 ∪ 「等你回复」会话 |
| 6 | 工程识别 | 缩短后的 workspace 路径（如 `idea/datad-2026/datad`） |
| 7 | daemon | 打开面板时若未运行则自动拉起 |
| 8 | 技术栈 | TypeScript / Node |
| 9 | 交互 | 点击展开详情抽屉；v2：跳转 Cursor |
| 10 | 脱敏 | 不脱敏（本机 localhost） |

## 3. 方案选择

### 3.1 候选

1. **单体 Daemon + 静态 Web**（选用）：chokidar 监听 → 解析 → Fastify + WebSocket → 卡片 UI
2. MVP 即 Hooks 事件流：更准但配置与兼容成本更高，推迟到 v2
3. CLI TUI 先行：与已选 Web 形态不符，弃用

### 3.2 选用理由

文件监听即可支撑 5 字段推断；零配置、1–2 天可出 MVP；v2 再叠 Hooks 精修「思考中」等瞬时状态。

## 4. 架构

```
~/.cursor/projects/**
        │ chokidar
        ▼
┌───────────────────┐
│  scanner/watcher  │
│  parser           │──► SessionState[]
│  aggregator       │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐     WebSocket/HTTP      ┌─────────────┐
│  Fastify server   │ ◄─────────────────────► │  Web 面板   │
│  (port 7423)      │                         │  localhost  │
└───────────────────┘                         └─────────────┘
          ▲
          │ fork if needed
┌───────────────────┐
│  CLI: open/status │
│  /stop            │
└───────────────────┘
```

### 4.1 目录结构

```
cursor-watch/
├── bin/cursor-watch
├── package.json
├── src/
│   ├── scanner/       # 扫描 ~/.cursor/projects
│   ├── watcher/       # chokidar：transcripts + terminals
│   ├── parser/        # jsonl → SessionState
│   ├── aggregator/    # 过滤、排序、subagent 归并
│   ├── server/        # Fastify + WebSocket
│   └── web/           # 卡片列表 + 详情抽屉
└── README.md
```

落点：本仓库根下 `cursor-watch/`（与 `.agents/skills/` 并列）。

### 4.2 生命周期

1. 用户执行 `cursor-watch open` 或访问 `http://127.0.0.1:7423`
2. 若 daemon 未运行：CLI/首请求侧 fork 后台进程并写 pid 文件（如 `~/.cursor-watch/daemon.pid`）
3. daemon 全量扫描一次，再增量 watch
4. 浏览器经 WebSocket 订阅状态变更
5. `cursor-watch stop` 结束 daemon

仅绑定 `127.0.0.1`，不对外网开放。

## 5. 数据模型

### 5.1 SessionState（MVP）

```ts
type AgentStatus = "waiting" | "running" | "subagent" | "idle" | "error";

interface SessionState {
  id: string;                 // transcript uuid
  projectKey: string;         // ~/.cursor/projects 下目录名
  workspacePath: string;      // 绝对路径（若可解析）
  workspaceLabel: string;     // 缩短展示，如 idea/datad-2026/datad
  status: AgentStatus;
  summary: string;            // 首条用户消息前 ~50 字
  currentAction: string;      // 如 "Shell: mvn test" / "等待你确认"
  lastActivityAt: number;     // ms epoch
  waitingSince?: number;      // 进入 waiting 的时刻
  runningSince?: number;
  subagentCount: number;
  subagentRunning: number;
  transcriptPath: string;
  recentMessages: Array<{     // 详情抽屉用，最近 3 条
    role: "user" | "assistant" | "system";
    text: string;
    at?: number;
  }>;
}
```

### 5.2 workspaceLabel 规则

1. 从 project 目录名反推路径（`Users-zhangcheng-idea-datad-2026-datad` → `/Users/zhangcheng/idea/datad-2026/datad`），或从已知 Cursor 元数据读取
2. 展示时去掉当前用户 home 前缀，保留如 `idea/datad-2026/datad`
3. MVP **不**读 git 分支；路径本身用于肉眼区分

### 5.3 过滤与排序

**纳入列表：**

- 最近 30 分钟内有 transcript / 关联 terminals 活动；**或**
- 当前状态为 `waiting`（等你回复），不受 30 分钟窗口裁掉

**排除：**

- 纯 subagent 行：归并到父会话，卡片上显示 `N subagents` / `M running`
- 无法解析且超过窗口的冷历史

**排序：** `waiting`（等最久优先）→ `running` / `subagent` → `idle` → `error` 可置顶或与 running 同级（实现时：`error` 紧跟 waiting 之后）

最终排序：`waiting` → `error` → `running`/`subagent` → `idle`。

## 6. 状态推断

数据源（只读）：

- `~/.cursor/projects/<project>/agent-transcripts/<uuid>/<uuid>.jsonl`
- `.../agent-transcripts/<uuid>/subagents/*.jsonl`
- `~/.cursor/projects/<project>/terminals/*.txt`（可选辅助：shell 是否活跃）

| 状态 | 判定（启发式，可调） |
|------|----------------------|
| `waiting` | 最后一条有效消息为 assistant，且其后无 user；且无近 2min 的 tool_use / shell 活跃 |
| `running` | 近 2min 内有 tool_use，或关联 terminal 仍在跑 |
| `subagent` | 父会话下存在近 2min 有更新的 subagent transcript（父卡片可标 🔵） |
| `idle` | 落在 30min 活跃窗内，但不满足 running/waiting |
| `error` | 最近 tool 失败，或关联 terminal `exit_code ≠ 0` 且为该会话近期活动 |

说明：MVP 无法可靠检测「纯思考、尚未写文件」——接受短暂滞后，v2 Hooks 弥补。

## 7. UI

### 7.1 列表

- 顶栏计数：`🟢 running` / `🟡 waiting` / `⚪ idle` / `🔴 error`（及可选 subagent 提示）
- 卡片字段：状态色标 + `workspaceLabel` + `currentAction` + 时长 + `summary`
- 点击卡片：展开详情抽屉（右侧或底部）

### 7.2 详情抽屉

- workspace 路径、状态、时长
- 最近 3 条消息原文（不脱敏）
- subagent 列表（id / 是否活跃 / 可选类型）
- transcript 完整路径（只读展示；MVP 不做「一键复制」按钮，也不做跳转）

### 7.3 明确不做（MVP）

- 跳转 Cursor 窗口（**v2**）
- 菜单栏徽章、launchd 自启（**v2+**）
- Hooks 事件总线（**v2**）
- 暂停 / 取消 / 调度
- 内容脱敏

## 8. API（本机）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 静态面板 |
| GET | `/api/sessions` | 当前 SessionState[] |
| GET | `/api/health` | daemon 存活 |
| WS | `/ws` | 推送 `{ type: "sessions", payload: SessionState[] }` |

默认端口：`7423`（可环境变量覆盖）。

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Cursor 目录布局变更 | 解析层集中；失败时降级为 projectKey 展示 |
| 误判 waiting/running | 规则可配置常量；面板展示「推断」而非官方状态 |
| 同路径多窗口撞名 | MVP 用路径区分；v2 再评估窗口跳转 / 实例 id |
| transcript 含敏感信息 | 仅 localhost；文档注明本机信任边界 |
| 文件量大扫描慢 | 首扫限近 N 天或按 mtime；后续增量 watch |

## 10. 里程碑

### MVP

1. 扫描 + 解析 + 过滤排序
2. daemon + HTTP/WS + 按需拉起
3. Web 卡片列表 + 详情抽屉
4. README：安装、`open` / `stop`、端口

### v2（已记入路线图）

- Cursor Hooks 精修状态
- 跳转对应 Cursor / 会话
- 可选菜单栏数字徽章 / 登录自启
- 可选基础脱敏

## 11. 开放实现细节（计划阶段敲定）

- project 目录名 → 绝对路径的精确映射方式
- `waiting` 是否用启发式问句检测，还是「assistant 后无 user」即可
- pid 文件与单实例锁路径
- 前端是否用零构建静态 HTML 还是轻量 Vite

以上不影响产品共识，写入实施计划时选定即可。
