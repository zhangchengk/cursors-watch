# 01 — Prefactor：Reminder delivery 可插拔通道

**What to build:** Reminder 送达可以换成不同通道（系统通知 / HUD），而不改 Turn end → 收件箱的主路径。现有「注入 notify」测试方式继续可用；为后续 Menubar shell 接系统通知留出稳定出口。送达失败时收件箱里的 pending Reminder 仍然在。

**Blocked by:** None — can start immediately.

**Status:** done

**Parent:** `.scratch/menubar-shell/issues/00-spec-menubar-shell-v1.md`

- [x] Delivery 出口支持注入/选择适配器（至少：现有 HUD 路径 + 可替换的「系统通知」桩）
- [x] pipeline / notify 相关单测在默认适配器下仍通过
- [x] 适配器失败或不可用时，不撤销已 upsert 的 pending Reminder
- [x] 深链所需的 conversation / notify 身份仍随投递意图带出
