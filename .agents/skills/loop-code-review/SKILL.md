---
name: loop-code-review
description: Use when the user asks for review loop, multi-round review on uncommitted git diff, @代码Review循环agent, or Review→Fix→Test before merge; symptoms include premature loop exit before 3 consecutive clean rounds or Ready to merge Yes without consecutive clean rounds. NOT for skill-only maintenance with no code diff (use writing-skills).
---

# Code Review Loop

## Overview

对**工作区未提交变更**（或用户 `@` 指定的 gitignore 路径）执行多轮 **Review → Fix → Test → Log**，直至合规退出或达轮数上限。默认不 commit / push。

**违反字面规则即违反精神规则**：`Ready to merge: Yes` **不能**单独结束 Loop。

## When to Use

- 用户 `@private/agents/代码Review循环agent.md` 或 `@loop-code-review`
- 消息含「review loop」「审查循环」「多轮 review」
- 合入前要对未提交 diff 自动 fix + 单测验证

**When NOT to use**

- 无未提交变更且未 `@` 待审文件（退出条件 #4）
- 用户要求**只修/优化本 skill 文档**、无业务代码 diff → 走 **Skill 维护模式**（见下），不跑 Loop
- 仅单次 code review、无 fix 循环 → 用 `requesting-code-review`
- 用户明确要求只 review 不改代码

## Skill 维护模式（非 Loop）

用户消息为「修复/优化 loop-code-review 技能」等，且无 tracked 业务 diff 时：

1. **不进入** Review Loop
2. 按 `.claude/skills/writing-skills/SKILL.md` 改 `.claude/skills/loop-code-review/`
3. 同步 `private/agents/代码Review循环agent.md`（人类可读副本）
4. 若设计决策变更，更新 `docs/superpowers/specs/2026-07-01-code-review-loop-agent-design.md`

## Quick Reference

**INIT 必读** [config.yaml](config.yaml)：`max_rounds`、`consecutive_clean_rounds`、`paths`（用户消息 `轮数=N` 可覆盖 `max_rounds`）。

| 项 | 值 |
|----|-----|
| 范围 | `git diff HEAD` + `git diff --cached`（**tracked**）；gitignore 路径靠用户 `@` 补全 |
| 默认 maxRounds | `config.yaml` → `max_rounds` |
| 连续空轮退出 | `config.yaml` → `consecutive_clean_rounds` |
| 可选参数 | `仅Critical`（只 fix Critical）；`含Minor`（也 auto-fix Minor） |
| Git 类 Review | **忽略**，仅记入报告；**禁止**因 Review 自主 `commit`/`push`/`add` |
| 自动修复 | Critical + Important（默认） |
| Review | 只读 `Task` subagent + `code-reviewer.md` + [reviewer-prompt-addendum.md](references/reviewer-prompt-addendum.md) |
| Fix | 主 Agent + **REQUIRED:** `receiving-code-review` |
| 测试 | fix 后 `mvn -pl {modules} -am test -DskipITs`；纯 docs/skill 无 Java 变更可 skip |
| 进行中状态 | `config.yaml` → `paths.status_dir`（每轮覆写 YAML，**不入库**） |
| 最终报告 | 有 plan → `{plan}-review-loop.md`；否则 `config.yaml` → `paths.report_dir` |

## Exit Conditions（唯一正常结束口径）

| # | 条件 | 结果 |
|---|------|------|
| 1 | 连续 **`consecutive_clean_rounds`** 轮无 Critical/Important | ✅ `consecutive-clean` |
| 2 | `round == maxRounds` 且未满足 #1 | ⏱️ `max-rounds` |
| 3 | 同一 C/I issueKey **连续 2 轮**未消除 | ⚠️ `stuck` |
| 4 | 开始前无 diff 且未 `@` 待审文件 | ℹ️ 不进入 Loop |

**空轮计数**：无 C/I → `emptyRoundCount++`；有 C/I → **置 0**。

**禁止提前退出**：`emptyRoundCount < consecutive_clean_rounds` 时 **不得**结束，即使 Reviewer 说 Yes。

## Round Flow（不可跳步）

```text
INIT: 读 config.yaml → maxRounds, consecutiveCleanRounds, statusPath, reportPath
      创建 status YAML（见 status-template.yaml）；初始化 report 骨架
FOR round = 1..maxRounds:
  R — Review（readonly subagent；先读 requesting-code-review + reviewer-prompt-addendum）
  若无 C/I: L — Log（空轮）→ emptyRoundCount++ → 覆写 status → if >= consecutive_clean_rounds exit → continue
  若有 C/I: emptyRoundCount=0 → F — Fix → T — Test → L — Log（覆写 status + 追加 report）
  if stuck: exit(manual)
  if round >= maxRounds: exit(max-rounds)
END: status.status=completed；补全 report 最终结论
```

## Phase R — Review

**REQUIRED:** `.claude/skills/requesting-code-review/SKILL.md` + `code-reviewer.md` + [references/reviewer-prompt-addendum.md](references/reviewer-prompt-addendum.md)

```bash
git diff HEAD && git diff --cached && git diff --stat HEAD && git rev-parse HEAD
```

Task 派发：`subagent_type=generalPurpose`，`readonly=true`，**不传 model**。

Prompt 须填充 `[DESCRIPTION]`、`[PLAN_OR_REQUIREMENTS]`、`[BASE_SHA]`、`[HEAD_SHA]`，并**追加** reviewer-prompt-addendum 全文（替换 `{BASE_SHA}`/`{HEAD_SHA}`）。

### 解析时过滤 Git 类 issue

Reviewer 若提出 **Git 工作流 / 版本控制操作** 类意见，**不计入** Critical/Important，**不进入 Fix**，仅在报告中记为「已忽略（Git）」：

- 要求或建议：`commit`、`push`、`git add`/`stage`、`rebase`、`merge`、`amend`、`squash`、拆 commit、写 commit message
- 分支策略、是否应提交、PR/MR 流程、历史清理等 **非代码** 事项

**即使** Reviewer 将上述标为 Critical/Important，主 Agent 解析时仍须降级忽略。Loop **绝不**因 Review 结果自主执行 `git commit` / `git push` / `git add`（除非用户在本条消息中明确要求）。

## Phase F — Fix

**REQUIRED:** `.claude/skills/receiving-code-review/SKILL.md`

VERIFY → EVALUATE（误报 push back）→ IMPLEMENT（最小改动）。不 fix Minor（除非 `含Minor`）。**不 fix** 已过滤的 Git 类 issue。

## Phase T — Test

从 diff 路径（及 `@` 文件）映射 `-pl` 模块；在**仓库根**执行：

```bash
mvn -pl {modules} -am test -DskipITs
```

- 变更**仅** docs / skill / 脚本且无对应 Java 模块 → 报告标注 `skip`，不阻断 Loop
- 单测失败 = Important，**同一 round 内**修完再进入下一轮 Review

## Phase L — Log（status + report）

**进行中**：每轮结束覆写 `paths.status_dir/{branch}-{YYYYMMDD-HHmmss}.yaml`（字段见 [status-template.yaml](references/status-template.yaml)）。须含 `round`、`empty_round_count`、`exit_reason`（进行中为 `null`）、`last_round`。

**最终报告**（Loop 结束时补全）：

| 条件 | 路径 |
|------|------|
| 用户 `@` plan | `{plan 目录}/{plan 去后缀}-review-loop.md` |
| 无 plan | `paths.report_dir/{branch}-{YYYYMMDD-HHmmss}-loop.md` |

两者 **stem 同名**（仅扩展名 `.yaml` / `.md`），便于对照。`sessionStem = sanitize(branch)-YYYYMMDD-HHmmss`（精确到秒，同日多次 Loop 可区分；分支名 `/` 替换为 `-`）。目录均 **不入库**（见 `.gitignore`）。

## Red Flags — STOP

- Round 1 无 C/I 就宣布「通过」
- 在未达 **`consecutive_clean_rounds` 连续空轮** 前因 `Ready to merge: Yes` 退出
- Reviewer 用 `git diff BASE..HEAD` 且 BASE==HEAD 却判「无变更」
- Reviewer subagent 非 readonly
- 未读 receiving-code-review 直接改代码
- 自动 `git commit` / `git push`（用户未要求时）
- 将 Git 工作流类 Review 当作 C/I 进入 Fix

| 借口 | 现实 |
|------|------|
| 「Reviewer 已说 Yes」 | 须连续 **`consecutive_clean_rounds` 空轮**，Yes 不是退出条件 |
| 「只剩 Minor」 | Minor 写报告，不阻塞也不假装 Loop 完成 |
| 「改过了不用再 review」 | 有 fix 必须下一轮 R |
| 「git diff 为空」 | 检查 gitignore 路径与用户 `@` 文件 |

## 完整规格

细则、报告模板、模块映射表、伪代码：见 [references/agent-spec.md](references/agent-spec.md)

## 参考

- `private/agents/代码Review循环agent.md`（人类可读副本，与 agent-spec 同步）
- `.claude/skills/requesting-code-review/`
- `.claude/skills/receiving-code-review/`
- `.claude/skills/writing-skills/`（Skill 维护模式）
- `.claude/skills/verification-before-completion/`
