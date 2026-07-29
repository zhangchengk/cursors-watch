# 05 — Reminder：壳发系统通知优先，失败回退 HUD

**What to build:** Turn end 且非 Active loop 产生 Reminder 后：优先由 Menubar shell 弹出系统通知（可授权的 `.app`）；权限未开或投递失败则 HUD 浮层兜底。点击通知聚焦壳面板并选中对应会话；收件箱确认语义不变。声音仍跟现有 prefs（默认静音）。

**Blocked by:** 01 — Prefactor：Reminder delivery 可插拔通道；02 — Menubar shell 最小常驻

**Status:** done

**Parent:** `.scratch/menubar-shell/issues/00-spec-menubar-shell-v1.md`

- [x] 壳可请求并使用通知权限发送 Reminder 系统通知
- [x] 通知不可用/失败时自动走 HUD，且用户能看见兜底提示
- [x] 送达失败不删除 pending Reminder
- [x] 通知激活 → 面板前置 + 选中对应 conversation（Notification deep link）
- [x] Reminder coalescing / notification sound 语义与现规格一致
- [x] 送达适配器层有自动化测试覆盖「优先 / 回退」选择行为（不测 Swift 内部实现细节）
