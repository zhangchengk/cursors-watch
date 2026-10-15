# 02 — cursor-watch Chat purge — Delete 探针 Spike Implementation Plan

**What to build:** Implement the work described in `.scratch/chat-purge/issues/00-spec-chat-purge.md` and the checklist below.

**Blocked by:** None — can start immediately (or follow task order inside checklist).

**Status:** ready-for-agent

**Parent:** `.scratch/chat-purge/issues/00-spec-chat-purge.md`

- [ ] Acceptance: behavior matches spec and CONTEXT.md
- [ ] Tests updated or added at agreed seams

## Implementation checklist (migrated plan)

# cursor-watch Chat purge — Delete 探针 Spike Implementation Plan

**Goal:** 证明（或证伪）本机 Cursor 版本上，桥扩展能否按 `conversationId` **单条删除** Agent Chat（等价侧边栏 Delete）——在任何设置页、daemon purge API、写 `state.vscdb` 之前。

**Architecture:** 扩展现有 `cursor-watch-bridge`：增强 command dump（含 delete）、新增 delete-by-id 探针与纯函数候选命令排序；人工跑 notes 记录 verdict。**不**接 Chat purge 产品 UI / 馆藏白名单执行路径。

**Tech Stack:** 现有桥扩展（`vscode`）、TypeScript、vitest（纯助手）、macOS。

**Spec:** `.scratch/specs/2026-10-14-chat-purge-design.md` §4

## Global Constraints

- **Spike only** — 禁止：设置页 Chat purge、daemon `/api/purge*`、批量馆藏过滤执行、直接读写 `state.vscdb`、清备份、VACUUM。  
- **过线** = 按 id 的 `executeCommand`（或扩展可调的同类命令面）删除成功；**仅有** `developer.deleteOldChats` = **fail**（可记入 notes 作对照，不得标 pass）。  
- **禁止** CDP / 页面注入删除（无 `fragile_pass`）。  
- 测试 id：用户提供的**无标注**本地 Agent UUID（勿用 Todo/Archive 馆藏 id）。  
- 每条 notes 记录 Cursor 版本。  
- Commits：仅当用户明确要求时提交。

---

## File map

| File | Responsibility |
|------|----------------|
| `cursor-watch/extensions/cursor-watch-bridge/src/delete-probe.ts` | dump 过滤、候选 delete 命令排序、按 id 尝试删除、结构化 `ProbeAttempt` |
| `cursor-watch/extensions/cursor-watch-bridge/src/extension.ts` | 注册 dumpDelete / deleteById 命令；输出 Output Channel |
| `cursor-watch/extensions/cursor-watch-bridge/package.json` | 贡献新命令标题 |
| `cursor-watch/tests/delete-probe.test.ts` | 纯函数单测（过滤 / 排序 / 阻挡按天命令当 pass 源） |
| `.scratch/specs/2026-10-14-chat-purge-delete-spike-notes.md` | 人工运行日志 + verdict |

复用已有 `spike-verdict.ts` 的 `ProbeAttempt` / `classifySpikeVerdict`（仅 `strategy: "command"`；无 cdp）。

---

### Task 1: delete-probe 纯助手（TDD）

**Files:**
- Create: `cursor-watch/extensions/cursor-watch-bridge/src/delete-probe.ts`
- Create: `cursor-watch/tests/delete-probe.test.ts`

**Interfaces:**

```ts
export const AGE_BATCH_DELETE_COMMANDS = ["developer.deleteOldChats"] as const;

/** Command ids that must never be treated as per-id delete success. */
export function isAgeBatchDeleteCommand(id: string): boolean;

/** Broaden dump beyond composer|chat|agent to catch delete* / remove*. */
export function listDeleteInterestingCommands(allCommandIds: string[]): string[];

/**
 * Prefer explicit per-composer delete-shaped ids; exclude age-batch commands
 * from the auto-try list (they may still appear in dump notes).
 */
export function preferredDeleteCommands(interesting: string[]): string[];

export type DeleteProbeDeps = {
  executeCommand: (command: string, ...args: unknown[]) => Thenable<unknown>;
  getCommands: (filterInternal?: boolean) => Thenable<string[]>;
  log: (line: string) => void;
  /** Human: chat gone from Agents sidebar? */
  confirmVisualDeleted?: () => Promise<boolean>;
};

export async function probeDeleteByConversationId(
  conversationId: string,
  deps: DeleteProbeDeps,
): Promise<import("./spike-verdict").ProbeAttempt[]>;
```

行为约定：

- `listDeleteInterestingCommands`：匹配 `/delete|remove|purge|composer/i`，排除明显无关（如 `DeleteFile`、notebook 等可用 `/File|Notebook|GrokBot|SharedConversation|BackgroundComposer/i` 再收窄——以测试钉死）。  
- `preferredDeleteCommands`：**不得**包含 `developer.deleteOldChats`。  
- `probeDeleteByConversationId`：对每个 preferred id 尝试常见 argv 形（至少：`(id)`、`(id, true)`、`({ composerId: id })`）；`executeCommand` 抛错 = 该形失败；全部命令形跑完后若有 `confirmVisualDeleted === true` 则对应 attempt `ok: true`（与 focus spike 一样：**人眼确认**才算删成功，不能仅凭无抛错）。

- [ ] **Step 1: 写失败单测**（`isAgeBatchDeleteCommand`、`preferredDeleteCommands` 排除按天命令、兴趣过滤含假想 `composer.deleteComposer`）

- [ ] **Step 2: 跑测期望 FAIL**

```bash
cd /Users/zhangcheng/idea/Cursors/cursor-watch && npx vitest run tests/delete-probe.test.ts
```

- [ ] **Step 3: 实现 `delete-probe.ts` 至测过**

- [ ] **Step 4: 再跑测期望 PASS**

---

### Task 2: 扩展命令 + manifest

**Files:**
- Modify: `extension.ts`、`package.json`

贡献：

| command id | title |
|------------|--------|
| `cursor-watch.bridge.dumpDeleteCommands` | Dump delete/remove-related commands |
| `cursor-watch.bridge.deleteById` | Probe delete chat by conversationId |

`dumpDeleteCommands`：打印 `listDeleteInterestingCommands` 全量，并单独标注 `AGE_BATCH_DELETE_COMMANDS` 是否存在。  
`deleteById`：InputBox 贴 UUID → `probeDeleteByConversationId` → `classifySpikeVerdict` → Output + InformationMessage。

确认文案：`Did that Agent chat disappear from the sidebar?` Yes/No。

- [ ] **Step 1: 改 manifest + extension 接线**

- [ ] **Step 2: `npm run compile`（扩展目录）无错误**

```bash
cd /Users/zhangcheng/idea/Cursors/cursor-watch/extensions/cursor-watch-bridge && npm run compile
```

---

### Task 3: 人工 Spike 运行 → 填 notes

**Files:**
- Update: `.scratch/specs/2026-10-14-chat-purge-delete-spike-notes.md`

前置：

1. Cursor 已开；桥扩展已加载（开发：Extension Development Host 或已安装 VSIX）。  
2. 从 Watch `/api/sessions` 或侧边栏选一条**无标注**、可牺牲的旧 Chat，复制 `conversationId`。  
3. 记录 `Cursor → About` 版本。

步骤：

- [ ] **Step 1:** 命令面板跑 `Dump delete/remove-related commands`，把完整列表贴进 notes（或附文件路径）。  
- [ ] **Step 2:** 跑 `Probe delete chat by conversationId`，填 Attempts 表。  
- [ ] **Step 3:** 若某命令无抛错但侧边栏仍在 → `ok: false`（人眼否决）。  
- [ ] **Step 4:** 可选对照：记录 `developer.deleteOldChats` 是否出现在 dump（**不**为了 pass 去执行清全库）。  
- [ ] **Step 5:** 勾选 verdict；写 Recommendation（pass → 开产品 plan；fail → 停自动删）。

**过线检查清单（notes 内）：**

- [ ] 至少一次 Yes（聊天消失）  
- [ ] 换同一或另一无标注 id 再成功一次（可重复）  
- [ ] 未对 Todo/Archive 馆藏 id 做删除探针

---

### Task 4: 收尾

- [ ] `npx vitest run tests/delete-probe.test.ts` 仍绿  
- [ ] notes `Status` 改为 `pass` 或 `fail`  
- [ ] 若 pass：另开 `2026-*-chat-purge-product.md` plan（**本 plan 不写产品任务**）  
- [ ] 若 fail：在 design §4.4 状态改为失败结论；不实现自动删除

---

## 风险与禁止事项

| 禁止 | 原因 |
|------|------|
| 对馆藏 Todo/Archive id 跑删除探针 | 不可恢复 |
| 为「试试」执行 `developer.deleteOldChats` 清大量会话 | 与保留集无关，易误伤 |
| Spike 内写 `state.vscdb` | 越界；失败路径另议 |
| 用 CDP 删除标过线 | 设计明确禁止 |

## 预研摘要（已写入 design，实现时勿当过线）

- 菜单 `delete-composer` → `ComposerService.deleteComposer`（非 command id）。  
- `developer.deleteOldChats` 内部循环 `deleteComposer` + `saveComposers` + KV GC——有官方清理路径，但按天、非白名单。

