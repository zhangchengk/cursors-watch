# cursor-watch：双视图模式 + 路径条 + 可配列数设计

状态：已评审共识  
日期：2026-07-22  
范围：强化工程路径可见性；注意力模式可配置列数；恢复「按工程分组」并与注意力模式可切换  
前置：`docs/superpowers/specs/2026-07-22-cursor-watch-attention-queue-design.md`

## 1. 问题

1. **路径不明显**：注意力卡片虽展示完整路径，但样式偏淡，与摘要/LIVE 糊在一起，难辨「哪个 Cursor 工程」。  
2. **单列纵向过长**：注意力扁平列表一列时浪费横向空间。  
3. **缺旧形态**：需要同时保留「按工程分组墙」与「注意力多列」，并支持切换与记住偏好。

## 2. 决策记录

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 默认视图 | 记住上次（localStorage）；首次 = 注意力 + 2 列 |
| 2 | 路径强调 | 独立路径条（浅底或左边色条）；完整 `workspacePath` |
| 3 | 列数范围 | 注意力模式 **1–4**；顶栏 `− N +`；默认 **2** |
| 4 | 分组布局 | 恢复旧版：组头 + 组内**纵向**叠卡；Top4 + 未读/`turnEnded` 强留 |
| 5 | 模式切换 UI | 顶栏分段 `注意力 \| 按工程`；列数仅注意力模式旁显示 |
| 6 | 路径条出现范围 | **仅注意力模式**；分组模式靠组头，卡片不重复路径 |
| 7 | 实现方案 | 前端双视图 + localStorage；服务端不变 |

## 3. 方案选择

1. **前端双视图 + localStorage（选用）**  
2. 仅 CSS 多列、不恢复分组 — 不满足双形态  
3. 后端返回分组结构 — MVP 过重  

## 4. 视图模式与偏好

### 4.1 模式

| `viewMode` | 行为 |
|------------|------|
| `attention` | `sortAttentionSessions` 扁平列表；CSS grid **N 列**（N∈[1,4]） |
| `workspace` | `groupSessionsForUi` 分组墙；**不**使用全局列数 |

### 4.2 顶栏

- 分段按钮：`注意力 | 按工程`（反映当前 `viewMode`）  
- 当且仅当 `viewMode === "attention"`：显示列数控件 `−` `N` `+`，将 N 夹紧到 1–4  
- 保留：状态点计数、全屏  

### 4.3 localStorage

| 键 | 合法值 | 首次默认 |
|----|--------|----------|
| `cursor-watch.viewMode` | `attention` \| `workspace` | `attention` |
| `cursor-watch.attentionColumns` | `"1"`…`"4"` | `"2"` |

非法或缺省 → 回退默认。切换模式/列数立即写入并重渲染。

### 4.4 窄屏

视口宽度 &lt; **720px** 时，注意力模式强制按 **1 列**渲染（不改存储的 N；加宽后恢复已存列数）。避免路径条在多列下不可读。

## 5. 路径条（注意力模式）

卡片结构：

```text
🟢 标题 · 时长                              [↗]
LIVE / 摘要一行（可空则省略）
┌ 路径条：/Users/.../project ─────────────┐
有未读 / 本轮结束（若有）
```

- 文案：`(workspacePath || workspaceLabel).trim()`  
- `title` 属性：完整路径，便于悬停  
- 样式：独立条——浅底和/或左边强调色；等宽字体；可 `word-break: break-all`  
- **分组模式卡片不渲染此条**（组头已含工程标识）

## 6. 按工程模式（恢复）

与 `2026-07-16-cursor-watch-group-by-workspace-design.md` 行为对齐（作为可选视图，非唯一默认）：

- 分组键：`workspacePath` → `workspaceLabel` → `projectKey`  
- 组头：标签/路径 · `显示 k / 组内 m` · 状态摘要  
- 组内：纵向卡片；**Top 4**（按活动时间）+ `hasUnread || turnEnded` 且未进 Top4 的强留  
- 组/组内排序：沿用既有紧迫度语义  
- 卡片：状态、标题、摘要/LIVE、完成行、↗；**无路径条**

实现上：在 `group-sessions.js` **恢复** `groupSessionsForUi` / `formatStatusSummary`（或等价导出），与现有 `sortAttentionSessions` / `attentionCardLines` 并存。

## 7. 数据流

```text
/api/sessions + /ws  →  SessionState[]（不变）
                         │
         ┌───────────────┴───────────────┐
         ▼                               ▼
  viewMode=attention              viewMode=workspace
  sort + grid(N cols)             groupSessionsForUi
  + path bar                      + group headers
```

服务端可见性 / prune / API **不改**。

## 8. 错误处理

- localStorage 不可用（隐私模式等）：内存内保持默认，不抛错拖垮面板  
- 列数解析失败：回退 2  

## 9. 测试

| 场景 | 期望 |
|------|------|
| prefs 缺省 | attention + 2 |
| prefs 非法列数 `"9"` | → 2 |
| prefs 非法 mode | → attention |
| `groupSessionsForUi` 同工程聚合 | 一组多卡 |
| Top4 + 未读强留 | 未读超出 Top4 仍出现 |
| `attentionCardLines.workspaceDir` | 优先绝对路径 |
| （可选）render 分支 | 注意力不调用分组；分组不输出路径条 class |

## 10. 非目标

- 改服务端契约或保留规则  
- 左工程列表 / 右详情双栏  
- 云端同步偏好  
- 分组模式内再套全局列数 grid  

## 11. 成功标准

1. 注意力模式下路径条一眼可辨为工程锚点  
2. 注意力默认 2 列，可调 1–4 并在刷新后记住  
3. 可切换并记住「按工程」旧式分组墙  
4. 相关单测通过  

## 12. 与既有设计关系

- 注意力队列仍为**产品默认首次体验**（与 attention-queue spec 一致）  
- 分组墙从「唯一布局」变为**可选视图**；旧分组 design 文档描述的行为在 `workspace` 模式下重新生效  
