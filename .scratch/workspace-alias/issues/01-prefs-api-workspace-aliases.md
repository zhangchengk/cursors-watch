# 01 — Prefs + API：Workspace alias 可持久化

**What to build:** 用户（或面板）可以通过本机 Watch prefs 保存工作区绝对路径到昵称的映射；读取偏好时带上该映射；更新通知声音时不会擦掉别名；提交空昵称会被拒绝；删除别名表现为映射中不再包含该路径。尚不要求面板 UI，但 API/存储行为可独立验证。

**Blocked by:** None — can start immediately.

**Status:** done

**Parent:** `.scratch/workspace-alias/issues/00-spec-workspace-alias.md`  
**Glossary / ADR:** `CONTEXT.md`, `docs/adr/0005-workspace-alias-as-machine-prefs.md`

- [ ] `WatchPrefs` 含 `workspaceAliases`（path → 非空昵称）；缺字段加载为 `{}`
- [ ] 持久化 round-trip；与 `notificationSound` 共存
- [ ] `GET /api/prefs` 返回完整 prefs（含 aliases）
- [ ] `PUT /api/prefs` 部分合并：只传声音不改 aliases；只传 aliases 不改声音；传 aliases 时整表替换该 map
- [ ] 提交的 aliases 中任一 value 为空串/非字符串 → 400；删除靠省略 key
- [ ] 既有声音相关测试仍绿（合并语义下）

Prototype shape (from spec):

```ts
type WatchPrefs = {
  notificationSound: boolean;
  workspaceAliases: Record<string, string>;
};
```
