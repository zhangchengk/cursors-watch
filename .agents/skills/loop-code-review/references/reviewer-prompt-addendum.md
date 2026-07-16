# Reviewer Prompt Addendum — 未提交变更 / gitignore 路径

Loop 派发 Reviewer 时，在 `code-reviewer.md` 模板**之后**追加本节。覆盖默认的 `git diff BASE..HEAD`（未 commit 时 BASE==HEAD，该命令**无输出**）。

## 审查范围说明（写入 subagent prompt）

```text
## Loop 审查范围（未提交变更）

本 Loop 审查的是 **工作区相对 Loop 开始时 BASE_SHA 的累积变更**，不是 commit 区间。

- **BASE_SHA**（Loop 开始时）: {BASE_SHA}
- **当前 HEAD**: {HEAD_SHA}（fix 未 commit 时常与 BASE 相同，属正常）
- **审查材料**:
  1. `git diff {BASE_SHA}` — unstaged
  2. `git diff --cached {BASE_SHA}` — staged
  3. `git diff --stat {BASE_SHA}` — 统计

若用户 `@` 了 gitignore 路径下的文件（如 `.agents/`、`private/`、`docs/superpowers/`），
这些文件不会出现在上述 diff 中。请额外阅读用户指定的路径，并与消息中的 DESCRIPTION 对照。

**禁止**因 diff 为空就判定「无变更」—— 须先确认是否有 @ 指定的 gitignore 文件。

## 只读铁律

- 禁止修改 working tree / index / HEAD
- 禁止 commit / push / stage
- Git 工作流建议（应提交、应 push 等）可写在 Recommendations，但主 Agent 会过滤，不计入 C/I
```

## 占位符

| 占位符 | 来源 |
|--------|------|
| `{BASE_SHA}` | Loop INIT 时 `git rev-parse HEAD` |
| `{HEAD_SHA}` | 每轮 Review 前 `git rev-parse HEAD` |

## 输出要求（重申）

Issues 须含 **file:line**；Assessment 的 **Ready to merge?** 不能替代 Loop 退出条件（主 Agent 须连续 `consecutive_clean_rounds` 空轮，见 `config.yaml`）。
