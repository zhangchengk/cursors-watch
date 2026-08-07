# 02 — 面板展示层覆盖工程路径

**What to build:** 面板内凡展示工程位置之处，若该绝对路径在 Workspace alias 表中有精确匹配，则显示昵称；否则仍显示完整绝对路径（无路径时再回退原有 label）。悬停/`title` 可露出真实路径。Open Chat 等动作继续使用真实路径。通知/HUD 文案不变。

**Blocked by:** 01 — Prefs + API：Workspace alias 可持久化

**Status:** done

**Parent:** `.scratch/workspace-alias/issues/00-spec-workspace-alias.md`  
**Glossary / ADR:** `CONTEXT.md`, `docs/adr/0005-workspace-alias-as-machine-prefs.md`

- [ ] 存在统一的展示解析行为（有别名→昵称；否则→绝对路径；再否则→label/`—`）
- [ ] Reminder 卡片工程行使用该解析结果
- [ ] 会话抽屉「工程」行使用同一规则
- [ ] Todo / Archive 条目来源行使用同一规则（子文件夹 hint 等既有附加信息不被破坏）
- [ ] 精确匹配：父路径别名不影响子路径工作区
- [ ] 面板已加载的 prefs aliases 变更后，重渲染能反映新昵称（例如重新 fetch prefs 或保存后刷新）
- [ ] 纯函数/seam 单测覆盖解析规则；不依赖 CSS/DOM 结构断言

Prototype shape (from spec):

```ts
function displayWorkspacePlace(
  workspacePath: string | undefined,
  workspaceLabel: string | undefined,
  aliases: Record<string, string>,
): { text: string; titlePath: string }
```
