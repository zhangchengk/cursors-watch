# Spec — cursor-watch：macOS 右上角横幅通知设计

**Status:** done
**Labels:** `done`
**Date:** 2026-07-25
**Glossary:** `CONTEXT.md`
**Migrated from:** `docs/superpowers/specs/2026-07-25-cursor-watch-banner-notify-design.md` (Matt `/to-spec` shape; former superpowers tree removed)

---

## Problem Statement

1. `osascript display notification` 在本机常 **exit 0 但不出现横幅**（Script Editor / osascript 通知中心授权不可靠）。 2. 临时改为 `display alert` 能看见，但 **模态打断**，体验差。 3. 用户明确要求 **macOS 右上角系统提示**（Notification Center banner）。

## Solution

1. Reminder 触发时出现 **右上角横幅**，标题 `Cursor Watch`。 2. 通过 **随包自带** 的 `terminal-notifier.app` 投递（用户已接受首次授权该助手）。 3. 保留 `notify-worker` 干净 FD，避免 daemon `spawn EBADF`。 4. 声音仍由 `prefs.notificationSound` 控制（默认静音与 Reminder 总设计一致；实现不改默认值语义）。 5. 同会话用稳定 `-group`（`notifyId`）合并，点击打开面板深链。

## User Stories

1. As a Cursors Watch user, I want Reminder 触发时出现 **右上角横幅**，标题 `Cursor Watch`, so that the product behavior matches CONTEXT.md.
2. As a Cursors Watch user, I want 通过 **随包自带** 的 `terminal-notifier.app` 投递（用户已接受首次授权该助手）, so that the product behavior matches CONTEXT.md.
3. As a Cursors Watch user, I want 保留 `notify-worker` 干净 FD，避免 daemon `spawn EBADF`, so that the product behavior matches CONTEXT.md.
4. As a Cursors Watch user, I want 声音仍由 `prefs.notificationSound` 控制（默认静音与 Reminder 总设计一致；实现不改默认值语义）, so that the product behavior matches CONTEXT.md.
5. As a Cursors Watch user, I want 同会话用稳定 `-group`（`notifyId`）合并，点击打开面板深链, so that the product behavior matches CONTEXT.md.

## Implementation Decisions

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 投递载体 | Vendored `terminal-notifier.app`（从 `node-notifier` mac vendor 拷贝） |
| 2 | 运行时依赖 | **不**引入 `node-notifier` npm 依赖；只提交 mac `.app` + LICENSE |
| 3 | 主路径 | worker → `terminal-notifier` CLI |
| 4 | 回退 | vendor 缺失 → `osascript display notification`（可能仍无横幅） |
| 5 | 弹窗 | **移除** `display alert` 主路径 |
| 6 | 声音 | `-sound Glass` 当且仅当 `notificationSound`；不再默认 `afplay` 旁路 |
| 7 | 合并 / 深链 | `-group <notifyId>`；`-open <panel deep link>` |

## Testing Decisions

Test external behavior at documented seams (HTTP, prefs, pure helpers); follow prior art in `cursor-watch/tests/`.

## Out of Scope

_None beyond legacy design record._

## Further Notes

Legacy design prose (migrated verbatim, superpowers boilerplate removed):

# cursor-watch：macOS 右上角横幅通知设计

状态：已实现  
日期：2026-07-25  
范围：将 Reminder 的 OS 送达从打断式 `display alert` 改回 **Notification Center 右上角横幅**  
前置：`2026-07-25-cursor-watch-reminder-design.md`（送达 = 系统通知 + 面板收件箱）  
相关实现：`cursor-watch/src/reminders/notify.ts`、`notify-worker.mjs`、`pipeline.ts`

## 1. 问题与目标

### 1.1 痛点

1. `osascript display notification` 在本机常 **exit 0 但不出现横幅**（Script Editor / osascript 通知中心授权不可靠）。
2. 临时改为 `display alert` 能看见，但 **模态打断**，体验差。
3. 用户明确要求 **macOS 右上角系统提示**（Notification Center banner）。

### 1.2 目标

1. Reminder 触发时出现 **右上角横幅**，标题 `Cursor Watch`。
2. 通过 **随包自带** 的 `terminal-notifier.app` 投递（用户已接受首次授权该助手）。
3. 保留 `notify-worker` 干净 FD，避免 daemon `spawn EBADF`。
4. 声音仍由 `prefs.notificationSound` 控制（默认静音与 Reminder 总设计一致；实现不改默认值语义）。
5. 同会话用稳定 `-group`（`notifyId`）合并，点击打开面板深链。

### 1.3 非目标

- 自制签名 .app / 改显示名为「Cursor Watch」应用图标品牌化（可后续）。
- Windows / Linux 通知。
- 保证点通知能跳进 Cursor 具体 Chat（仍只保证打开面板 + 选中会话）。
- 用 Homebrew 作为硬依赖（可选 PATH 探测可作为增强，非本版必须）。

## 2. 决策

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 投递载体 | Vendored `terminal-notifier.app`（从 `node-notifier` mac vendor 拷贝） |
| 2 | 运行时依赖 | **不**引入 `node-notifier` npm 依赖；只提交 mac `.app` + LICENSE |
| 3 | 主路径 | worker → `terminal-notifier` CLI |
| 4 | 回退 | vendor 缺失 → `osascript display notification`（可能仍无横幅） |
| 5 | 弹窗 | **移除** `display alert` 主路径 |
| 6 | 声音 | `-sound Glass` 当且仅当 `notificationSound`；不再默认 `afplay` 旁路 |
| 7 | 合并 / 深链 | `-group <notifyId>`；`-open <panel deep link>` |

## 3. 架构

```
pipeline.onEffectiveTurnEnd
  → notifyReminder({ record, sound, panelUrl })
      → build argv for terminal-notifier
      → sendViaWorker({ type: "notify", argv })
           → notify-worker spawn(argv[0], argv.slice(1))
      → else fallback: osascript display notification
```

### 3.1 Vendor 布局

```
cursor-watch/vendor/mac/
  terminal-notifier.app/          # 完整 .app 树
  terminal-notifier-LICENSE
```

二进制入口：

`vendor/mac/terminal-notifier.app/Contents/MacOS/terminal-notifier`

体积约 ~500KB。路径相对包内 `src/reminders/` 用 `fileURLToPath` + `../..` 解析到 `vendor/mac/...`（实现时以实际相对深度为准，单测可 mock `run`）。

### 3.2 CLI 参数约定

| 参数 | 值 |
|------|-----|
| `-title` | `Cursor Watch` |
| `-subtitle` | 截断后的 `chatName`（缺省可省略或同标题策略：实现选「有则 subtitle」） |
| `-message` | 截断后的 summary / 「本轮结束」 |
| `-group` | `record.notifyId` |
| `-open` | `buildReminderDeepLink(panelUrl, conversationId)` |
| `-sound` | `Glass`（仅 sound=true） |

正文仍做长度截断，避免异常长 markdown。

### 3.3 Worker IPC

现有 worker 从 `{ type: "notify", script }`（osascript）改为：

- `{ type: "notify", argv: string[] }` — 直接 `spawn(argv[0], argv.slice(1), { detached, stdio: ignore })`
- 可选保留 `{ type: "sound", path }` **仅**给 osascript 回退路径；主路径不发。

`startNotifyWorker` 仍在 daemon 启动早期、chokidar 之前调用。

### 3.4 回退与可观测性

1. 若 vendor binary 不存在或不可执行：打 `[cursor-watch] terminal-notifier missing`，走 osascript `display notification`。
2. spawn 失败：worker / notify 现有 error 日志。
3. 不自动降级到 `display alert`。

### 3.5 首次权限（运维说明，非代码强制）

首次投递后，系统可能提示允许「terminal-notifier」通知。若无横幅：

**系统设置 → 通知 → terminal-notifier → 允许通知**（横幅样式）。

## 4. 测试

### 4.1 单测

- `notifyReminder` + mock `run`：argv 指向 vendor 路径形态（或注入 resolver）、含 `-title`/`-group`/`-open`；`sound:true` 含 `-sound Glass`；`sound:false` 不含。
- 截断行为保留。
- 删除 / 改写原「必须 display alert」断言。

### 4.2 手工

1. 确认 `vendor/mac/.../terminal-notifier` 存在且可执行。
2. 重启 daemon；触发一次 Reminder（或 CLI 探测）。
3. 确认右上角横幅；点击打开面板深链。
4. 确认不再出现模态 alert。

## 5. 实现触点（文件）

| 文件 | 变更 |
|------|------|
| `cursor-watch/vendor/mac/**` | 新增 vendored app + LICENSE |
| `src/reminders/notify.ts` | 组装 terminal-notifier argv；回退 osascript；移除 alert 主路径 |
| `src/reminders/notify-worker.mjs` | IPC `argv` 执行 |
| `tests/notify.test.ts` | 断言横幅 CLI，不测 alert |
| （可选）README / 面板空态 | 一句「若无横幅请允许 terminal-notifier 通知」 |

## 6. 与 Reminder 总设计的关系

本 spec **只替换 OS 投递实现**，不改变：Turn end 触发、Active loop 压制、收件箱 ack、coalesce、`notificationSound` 语义。原 Reminder design §「实现提示：osascript / terminal-notifier」中，本版选定 **vendored terminal-notifier** 为主。

