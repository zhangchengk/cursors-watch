# 代码 Review 循环 Agent — 完整规格

> **版本**：2026-07-04（连续空轮退出，见 config.yaml）  
> **SSOT**：`.claude/skills/loop-code-review/SKILL.md`（本文件为展开规格）  
> **配置**：`.claude/skills/loop-code-review/config.yaml`（`max_rounds`、`consecutive_clean_rounds`）  
> **人类副本**：`private/agents/代码Review循环agent.md`  
> **设计规格**：`docs/superpowers/specs/2026-07-01-code-review-loop-agent-design.md`

---

## 1. 设计决策摘要

| 决策项 | 选择 |
|--------|------|
| Review 范围 | tracked：`git diff` + `git diff --cached`；gitignore 路径靠用户 `@` |
| 自动修复 | **Critical + Important**；Minor 只写入报告（`含Minor` 可全开） |
| 验收标准 | 用户消息 + 可选 `@` plan/设计文档 |
| 默认轮数 | `config.yaml` → `max_rounds`（消息 `轮数=N` 可覆盖） |
| Git 类 Review | **忽略**（仅报告）；**禁止**因 Review 自主 `commit`/`push`/`add` |
| 提前通过 | **仅**连续 **`consecutive_clean_rounds`** 轮无 C/I（`Ready to merge: Yes` **不能**单独触发退出） |
| 失败保护 | 同一 C/I **连续 2 轮**未消除 → 「需人工」并停止 |
| Review | `Task` 只读 subagent + `code-reviewer.md` + `reviewer-prompt-addendum.md` |
| Fix | 主 Agent + `receiving-code-review` |
| 单测 | 有 Java 变更时 fix 后 `mvn -pl … test`；纯 docs/skill 可 skip |
| 进行中状态 | `config.yaml` → `paths.status_dir`（YAML，每轮覆写） |
| 最终报告 | 有 plan → `{plan名}-review-loop.md`；否则 `paths.report_dir/` |
| Skill 维护 | 无业务 diff 时走 `writing-skills`，不跑 Loop |

---

## 2. 触发方式

```text
@.claude/skills/loop-code-review
@private/agents/代码Review循环agent.md
@docs/superpowers/plans/xxx.md
实现了 XXX，请 review loop
```

**可选参数**：

| 参数 | 作用 |
|------|------|
| `轮数=N` | 覆盖 `config.yaml` 的 `max_rounds` |
| `仅Critical` | 只 auto-fix Critical |
| `含Minor` | 也 auto-fix Minor |

**输入要求**：

1. tracked 未提交变更 **或** 用户 `@` 了待审文件（含 gitignore 路径）
2. 消息说明「实现了什么」（`DESCRIPTION`）
3. 可选 `@` plan/spec 作 `PLAN_OR_REQUIREMENTS`

---

## 3. 审查范围与 gitignore

| 路径类型 | 如何纳入审查 |
|----------|--------------|
| tracked 源码 | `git diff {BASE_SHA}` + `git diff --cached {BASE_SHA}` |
| `.agents/`、`private/`、`docs/superpowers/` 等 gitignore | 用户 `@` 指定；Reviewer 直接 Read，不依赖 diff |
| 两者皆无 | 退出条件 #4，提示用户 |

**常见陷阱**：`code-reviewer.md` 默认 `git diff BASE..HEAD` 在 fix 未 commit 时为空。Loop 派发时必须追加 [reviewer-prompt-addendum.md](reviewer-prompt-addendum.md)。

---

## 4. Loop 总览

```text
INIT
  读 config.yaml → maxRounds, consecutiveCleanRounds, statusDir, reportDir
  sessionStem = sanitize(branch) + "-" + localTime("YYYYMMDD-HHmmss")  # 分支 / → -
  statusPath = statusDir/{sessionStem}.yaml
  reportPath = reportDir/{sessionStem}-loop.md（或 plan 同目录）
  写 status YAML（status=running）；创建 report 骨架
  BASE_SHA = git rev-parse HEAD
  emptyRoundCount = 0
  stuckTracker = {}
  reportPath = 解析 §9

FOR round = 1 .. maxRounds:
  R — Review
  若无 C/I: L — Log（空轮）→ emptyRoundCount++ → 检查 §5 退出
  若有 C/I: emptyRoundCount=0 → F — Fix → T — Test → L — Log
  检查 stuck / maxRounds

END → 聊天摘要 §12
```

---

## 5. 退出条件

| # | 条件 | exitReason |
|---|------|------------|
| 1 | 连续 **`consecutive_clean_rounds`** 轮无 C/I | `consecutive-clean` |
| 2 | `round == maxRounds` 且未满足 #1 | `max-rounds` |
| 3 | 任一 issueKey stuck ≥ 2 | `stuck` |
| 4 | 无 diff 且未 `@` 待审文件 | （不进入 Loop） |

**issueKey**：`file:line` + 摘要前 40 字。

**禁止**：`emptyRoundCount < consecutive_clean_rounds` 时因 `Ready to merge: Yes` 结束。

---

## 6. Phase R — Review

### 6.1 准备

```bash
git diff HEAD
git diff --cached
git diff --stat HEAD
git rev-parse HEAD
```

### 6.2 派发

- **先读**：`requesting-code-review/SKILL.md`、`code-reviewer.md`、`reviewer-prompt-addendum.md`
- `Task`: `generalPurpose`, `readonly=true`, **不传 model**
- Prompt：填充 `[DESCRIPTION]`、`[PLAN_OR_REQUIREMENTS]`、`[BASE_SHA]`、`[HEAD_SHA]` + addendum 全文

### 6.3 解析

1. `filterGitWorkflowIssues()` — Git 类 → 报告「已忽略（Git）」，不进 Fix
2. Critical / Important → Fix 队列
3. Minor → 仅报告
4. 过滤后无 C/I → 空轮

---

## 7. Phase F — Fix

**REQUIRED:** `receiving-code-review/SKILL.md`

VERIFY → EVALUATE → IMPLEMENT；更新 `stuckTracker`。

---

## 8. Phase T — Test

### 8.1 模块映射

从 `git diff --name-only HEAD` 及 `@` 文件路径推断：

| 路径前缀 | `-pl` 模块 |
|----------|------------|
| `iuap-data-datafusion-service/` | `iuap-data-datafusion-service` |
| `iuap-data-datafusion-domain/` | `iuap-data-datafusion-domain` |
| `datad-develop-service/` | `datad-develop-service` |
| `datad-metrics-service/` | `datad-metrics-service` |
| `datad-datasource-service/` | `datad-datasource-service` |
| `datad-governance-service/` | `datad-governance-service` |
| `datad-base-api/` | `datad-base-api` |
| 其他 | 仓库根下含 `pom.xml` 的顶层目录名 |

多模块：`-pl mod1,mod2 -am`

### 8.2 执行

```bash
mvn -pl {modules} -am test -DskipITs
```

| 情况 | 处理 |
|------|------|
| 测试失败 | Important，同 round 内修完 |
| 无法推断模块 | 报告告警，skip，摘要提醒人工补测 |
| 仅 docs/skill/无 Java | 报告 `skip`，不阻断 |

---

## 9. Phase L — Log（status + report）

### 9.1 进行中状态（status）

| 项 | 值 |
|----|-----|
| 目录 | `config.yaml` → `paths.status_dir` |
| 文件名 | `{branch}-{YYYYMMDD-HHmmss}.yaml` |
| 模板 | [status-template.yaml](status-template.yaml) |
| 更新时机 | **每轮** R/F/T 结束后覆写 |
| 结束 | `status: completed`，写入 `exit_reason` |

**用途**：防 Agent 遗忘 `empty_round_count`、会话中断后可读档续跑、与 report stem 对照。

### 9.2 最终报告（report）

| 条件 | 路径 |
|------|------|
| 用户 `@` plan | `{plan 目录}/{plan 去后缀}-review-loop.md` |
| 无 plan | `paths.report_dir/{branch}-{YYYYMMDD-HHmmss}-loop.md` |

**结构**：元信息 → 最终结论 → Round 明细（含空轮）→ 剩余 Minor → stuck/达上限 → 已忽略（Git）→ 已驳回

空轮也须写 Round 节（Reviewer verdict、空轮=是）。Loop 退出时补全「退出」节并链接对应 status 文件。

---

## 10. 完整 Round 伪代码

```text
round += 1
if no tracked diff and no @files:
  exit(nothing-to-review)

dispatch reviewer (readonly, with addendum) → parse C/I → filterGitWorkflowIssues()

if no Critical and no Important:
  log round (empty)
  emptyRoundCount += 1
  if emptyRoundCount >= consecutiveCleanRounds: exit(consecutive-clean)
  continue   # 即使 Ready: Yes

emptyRoundCount = 0
for each C/I: update stuckTracker
if any stuck >= 2: exit(stuck)

fix all C/I (receiving-code-review)
if java modules touched:
  run tests; while fail: fix (same round)
else:
  log test=skip

log round → 覆写 status YAML；追加 report Round 节
if round >= maxRounds: exit(max-rounds)
continue

# END
status.status = completed; status.exit_reason = ...
finalize report
```

---

## 11. 禁止事项

- 不自动 `git commit` / `git push` / `git add`（除非用户明确要求）
- Git 工作流 Review **过滤**，不进 Fix
- Reviewer **必须** `readonly: true`
- Subagent **禁止**固定 model（须 Auto）
- **`Ready to merge: Yes` 不得作为 Loop 退出条件**
- 不得用 `git diff BASE..HEAD`（BASE==HEAD）代替工作区 diff

---

## 12. 聊天最终摘要模板

```text
Review Loop 结束：{通过|需人工|达上限}（{actual}/{max} 轮）
退出原因：{exitReason}
状态：{statusPath}
报告：{reportPath}
剩余：Critical {n} / Important {n} / Minor {n}
建议：{可提交|请人工处理 XXX|请补跑全量单测}
```

---

## 13. 质量自检（Loop 结束时）

- [ ] 报告已落盘
- [ ] status YAML 已标记 `completed` 且 `empty_round_count` 与退出原因一致
- [ ] 每轮 Review 来自独立只读 subagent（含 addendum）
- [ ] 退出原因明确
- [ ] Minor / 需人工 / 已忽略（Git）/ 已驳回 已列出
- [ ] 未因 Review 自主 commit/push
