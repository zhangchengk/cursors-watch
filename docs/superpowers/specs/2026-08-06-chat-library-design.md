# cursor-watch：Chat library（代办 / 归档）设计

状态：已实现  
日期：2026-08-06  
范围：与 Reminder **并列主职**的会话馆藏——Todo / Archive 标注、本机全局文件夹树、标题/备注、面板三 Tab  
前置：`CONTEXT.md`、`docs/adr/0004-reminder-and-chat-library-dual-primary.md`（部分取代 ADR 0001 的「唯一主职」表述）  
相关：`2026-07-25-cursor-watch-reminder-design.md`（Reminder / Inbox-first）、`2026-08-05-cursor-watch-open-chat-design.md`（Open Chat jump）

## 1. 问题与目标

### 1.1 痛点

1. Cursor Agent 列表**没有**目录与备注；验证过想法但未落地的 Chat、值得回看/当面宣讲的 Chat，无法在本机统一管理。  
2. Reminder 收件箱解决「该你看了」，**不**解决「我要记着回头做 / 留着讲」。

### 1.2 目标（本版）

1. **Chat library** 与 Reminder 并列主职（见 glossary / ADR-0004）。  
2. 一条 Chat **互斥**馆藏状态：`无标注` / `代办(todo)` / `归档(archive)`。  
3. 面板顶层三 Tab：`Reminder`（冷启动默认）｜`Todo`｜`Archive`；Reminder Tab 内仍 Inbox-first。  
4. 每状态一棵**本机全局**、**任意深度**文件夹树；可选标题 + 备注；馆藏 Tab 内完整整理。  
5. 源会话不可用时保留**失效条目**；宣讲仅本机 Open Chat，无导出/多人同步。

### 1.3 硬约束

- 数据只落本机 `~/.cursor-watch/`（与 reminders/prefs 同目录约定）；服务仍绑 localhost。  
- 不自动推断馆藏状态（不把未读 / Turn end 当成代办或归档）。  
- 标注入口仅 Reminder Tab 当前可见列表；标完**不**跳 Tab；首版**不**做全历史搜索添加。  
- 不是泛任务中枢、不替代 Cursor 侧边栏。

### 1.4 非目标（本版）

- 本机历史会话搜索后标注。  
- 馆藏导出、分享链接、团队多人同步。  
- 按工作区拆多套文件夹树。  
- 结构化多字段备注模板。  
- 改 Cursor 侧会话名。

## 2. 决策记录

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 产品定位 | Reminder + Chat library 双主职（grilling B） |
| 2 | 状态模型 | 互斥：无标注 / 代办 / 归档（A） |
| 3 | 目录 | 可选文件夹；分状态两套树；任意深度；本机全局（A+C+A） |
| 4 | 互迁文件夹 | 退出原文件夹 → 目标状态未归组（A） |
| 5 | 备注形态 | 短标题 + 长备注（B）；互迁保留；取消标注丢弃（A） |
| 6 | 面板 | 三 Tab：Reminder \| Todo \| Archive；冷启动 Reminder（A+用户细化） |
| 7 | 标注入口 | 仅 Reminder 可见列表；不跳转；接受历史缺口（A） |
| 8 | 馆藏 Tab | 完整整理（A） |
| 9 | 源消失 | 保留失效条目（A） |
| 10 | 宣讲 | 纯本机 Open Chat（A） |
| 11 | 存储方案 | JSON 文件 + REST，对齐 reminders（实现方案 A） |

## 3. 方案选择

1. **`library.json` + Fastify REST + 现有 `web/` 三 Tab（选用）** — 与 `reminders` / `prefs` 同构，易测、无新依赖。  
2. SQLite 馆藏库 — 对本机小数据过重。  
3. 仅 localStorage — 壳 WebView / 清数据易丢，且无法与 daemon 侧 open-chat 白名单统一。

## 4. 概念与状态

术语以 `CONTEXT.md` 为准。实现层映射：

| 概念 | 实现要点 |
|------|----------|
| Library mark | entry 上 `mark: "todo" \| "archive"`；无 entry = 无标注 |
| Library folder | `folders[]` 节点；`mark` 限定所属树；`parentId` 可空（根下） |
| Library title / note | entry 可选字符串；列表主行用 title（空则回退 chatName / summary / id） |
| Library mark entry | Reminder Tab UI → `POST /api/library/entries` |
| Library curation | Todo/Archive Tab → PATCH/DELETE entry、文件夹 CRUD |
| Stale library entry | 源 transcript（或等价解析）不可用；`stale: true`；仍可取消标注 |

### 4.1 馆藏状态机（单 conversationId）

```text
  无标注 ──mark(todo|archive)──► 代办或归档
     ▲                              │
     │                              │ moveMark / unmark
     └──────── unmark ──────────────┘
              （丢弃 title/note/folderId）

  代办 ←── setMark ──► 归档
       （保留 title/note；folderId ← null）
```

## 5. 数据模型

### 5.1 文件

路径：`~/.cursor-watch/library.json`（`libraryFile(home)` 写入 `constants.ts`）。

原子写：与 reminders 相同（tmp + rename）。

### 5.2 形状

```ts
type LibraryMark = "todo" | "archive";

interface LibraryFolder {
  id: string;                 // uuid
  mark: LibraryMark;          // 所属树
  parentId: string | null;    // null = 该 mark 树根下
  name: string;               // trim 后非空
  sortKey: number;            // 同级排序
}

interface LibraryEntry {
  conversationId: string;
  mark: LibraryMark;
  folderId: string | null;    // null = 未归组；若设则必须同 mark 且存在
  title?: string;
  note?: string;
  projectKey?: string;
  workspacePath?: string;
  workspaceLabel?: string;
  chatName?: string;
  transcriptPath?: string;    // 标注时从 SessionState 拷贝；供 stale / open
  updatedAt: number;          // ms
}

interface LibraryState {
  version: 1;
  folders: LibraryFolder[];
  entries: LibraryEntry[];
}
```

不变量：

- 同一 `conversationId` 至多一条 entry。  
- `folderId` 非空时：目标 folder 存在且 `folder.mark === entry.mark`。  
- `parentId` 非空时：父 folder 存在、同 `mark`、且不成环。

### 5.3 失效（stale）

`GET` 组装响应时计算，**不**写回文件：

1. 若 `transcriptPath` 有值：文件不存在 → stale。  
2. 否则若 `workspacePath` + `conversationId` 能在当前 `SessionStore` 命中 → 不 stale。  
3. 否则尝试按既有扫描约定解析 transcript（若实现成本高，v1 可仅 1+2；未命中 session 且无 path → stale）。  

**不得**仅因「不在当前运行中列表」且 path 仍在而标 stale（避免 visibility prune 误杀归档）。

## 6. 模块与 API

### 6.1 新模块（建议）

| 路径 | 职责 |
|------|------|
| `cursor-watch/src/library/types.ts` | 类型 |
| `cursor-watch/src/library/store.ts` | load/save、CRUD、不变量、互迁/取消语义 |
| `cursor-watch/src/library/stale.ts` | `isLibraryEntryStale(entry, sessions)` |
| `cursor-watch/src/library/hub.ts` | 可选：订阅 + 封装 store（对齐 ReminderHub） |
| `cursor-watch/src/web/library.js` | 馆藏 view model / Tab 渲染辅助（纯函数优先可测） |

### 6.2 HTTP

| 方法 | 路径 | 行为 |
|------|------|------|
| GET | `/api/library` | `{ folders, entries: (entry & { stale: boolean })[] }` |
| POST | `/api/library/entries` | body: mark + conversationId + 可选 title/note/folderId + 会话快照字段；已存在则视为改 mark/元数据（互迁清 folderId，除非请求显式带**目标树**合法 folderId） |
| PATCH | `/api/library/entries/:conversationId` | 改 title/note/folderId/mark（mark 变更 → folderId 默认 null） |
| DELETE | `/api/library/entries/:conversationId` | 取消标注 |
| POST | `/api/library/folders` | 创建 `{ mark, parentId?, name }` |
| PATCH | `/api/library/folders/:id` | 改 name / parentId / sortKey（同树内） |
| DELETE | `/api/library/folders/:id` | 删除文件夹：子文件夹与其下 entry 的 `folderId` 升到被删节点的 parent（entry 不删除） |

错误：400 校验失败；404 未知 id；409 环或 mark 不一致。

### 6.3 Open Chat

扩展 `openChatInCursor` / server 路由：将 library entries 与 reminders 同等视为「已知目标」（`conversationId` + `workspacePath` 白名单），以便归档在 SessionStore 已 prune 时仍可 ↗。失效条目：仍可调 API，bridge/文件层失败时面板 toast（与现网一致）。

### 6.4 WebSocket

面板 `/ws`：library 变更时推送 `{ type: "library", payload }`（或客户端变更后 refetch；若选 refetch-only，须在设计实现时统一，推荐 subscribe 推送以对齐 reminders）。

## 7. UI

### 7.1 结构

`index.html`：

- 顶栏下或顶栏内：`role="tablist"` → Reminder / Todo / Archive。  
- `#reminderPane`：现有 `#inbox` + `#sessionsSection` + drawer 行为保留。  
- `#todoPane` / `#archivePane`：左侧（或上方）文件夹树 + 「未归组」；右侧/下方条目列表；条目可展开备注。  
- 记忆上次 Tab：`localStorage`（或 prefs）；**冷启动默认 Reminder**（覆盖「上次」仅在同会话内可选——实现取：读 localStorage，缺省 Reminder）。

### 7.2 Reminder Tab 标注

收件箱卡片与运行中卡片：操作「标为 Todo / Archive」。  
对话框：mark、title、note、文件夹选择（仅目标 mark 树）。提交成功 toast，**保持 Reminder Tab**。

### 7.3 Todo / Archive Tab

- 建文件夹、重命名、拖拽或「移动到」改 parent（任意深度）。  
- 条目：编辑标题/备注、移文件夹、改为另一 mark、取消标注、↗ Open Chat。  
- `stale`：角标「源会话不可用」；↗ 失败时 toast。

### 7.4 展示优先级

列表主行：`title` → `chatName` → `summary`（若有）→ `conversationId`；副行可示 `workspaceLabel`。

## 8. 测试

| 层 | 覆盖 |
|----|------|
| `library/store` | 互斥写入、互迁清 folderId 保留 title/note、unmark 删除、文件夹环检测、删文件夹提升子节点、非法跨 mark folderId |
| `library/stale` | path 缺失 → stale；session 命中 → 不 stale |
| `server` | CRUD 状态码；GET 带 stale |
| `web/library.js` | 按 mark 过滤树、未归组分组、主行标题回退 |
| `open-chat` | library entry 可作为已知目标打开 |

## 9. 文档与产品文案

- 实现后更新 README：三 Tab、代办/归档能力与「非任务中枢 / 非导出」边界（简短）。  
- 不改 Bundle ID / 包名。

## 10. 实现顺序（供 plan 拆解）

1. types + store + 单测  
2. stale + hub + server 路由 + open-chat 白名单 + 单测  
3. web：三 Tab 壳 + Reminder 标注入口  
4. web：Todo/Archive 树与整理  
5. README / 手动冒烟  

---

**Self-review：** 无 TBD；与 ADR 0004 / CONTEXT 一致；open-chat 白名单与 stale 规则已写明，避免 prune 误杀；v1 非目标已列全。
