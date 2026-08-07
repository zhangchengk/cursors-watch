# 03 — Panel settings：齿轮管理别名

**What to build:** 用户点击面板右上角齿轮打开「设置」壳；首版只有工作区别名分区。列表来自当前会话 ∪ 待确认 Reminder ∪ 馆藏条目路径并集，并始终包含已保存别名的路径。每行只读路径 + 昵称输入 + 显式删除；保存写入 prefs；已有别名存空昵称被拒绝并提示用删除；关闭不保存则丢弃未提交编辑。无手填陌生路径。声音/列数控件仍留在顶栏。

**Blocked by:** 01 — Prefs + API：Workspace alias 可持久化；02 — 面板展示层覆盖工程路径

**Status:** done

**Parent:** `.scratch/workspace-alias/issues/00-spec-workspace-alias.md`  
**Glossary / ADR:** `CONTEXT.md`, `docs/adr/0005-workspace-alias-as-machine-prefs.md`

- [ ] 顶栏有齿轮入口，打开可扩展的设置 dialog/壳（文案为设置，非一次性「别名工具」）
- [ ] v1 仅实现工作区别名分区；声音与列数不迁入
- [ ] 候选路径 = sessions ∪ pending reminders ∪ library entries ∪ 已有 alias keys；无手填路径
- [ ] 可新建/编辑昵称并保存到 prefs；保存后面板展示立即用新昵称
- [ ] 显式删除去掉映射并恢复全路径展示
- [ ] 已有别名保存空昵称被拒绝，并提示使用删除
- [ ] 关闭/取消丢弃未保存编辑
- [ ] 不依赖 `window.prompt`（Menubar shell WebView 可用）
- [ ] 通知/HUD 仍不走别名（本票不改交付文案）
