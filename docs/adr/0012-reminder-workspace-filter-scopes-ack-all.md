# Reminder workspace filter scopes「全部确认」

Reminder 收件箱需要按工作区快速收窄待确认列表。筛选是**客户端二次过滤**（Reminder workspace filter），不是服务端查询；「全部确认」若仍 ack 全量 pending，会在有筛选时误清隐藏条目，和用户所见不一致。

**Accepted：** 收件箱计数与「全部确认」只作用于当前筛选可见的 pending；零选中 = 全部。筛选按 `workspacePath` 精确匹配（OR），chip 文案走 Workspace alias。会话内有效；通知深链若目标会被藏住则清筛选再选中。不持久化 prefs。

**Rejected：** 有筛选时「全部确认」仍打全量 pending；按展示文案/会话标题过滤；把筛选写入 prefs；首版把同一套 chip 筛到运行中或 Todo/Archive。
