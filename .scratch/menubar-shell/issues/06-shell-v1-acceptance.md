# 06 — Shell v1 验收与文档收口

**What to build:** 按规格做完 Shell v1 端到端验收：Applications 里的非正式 App、登录打开、面板、系统通知优先 + HUD 回退均可演示；打包命令写进仓库可发现处；与 ADR-0002 / CONTEXT glossary 一致。不含 hooks 一键安装与自动更新。

**Blocked by:** 03 — 非正式 App 打包安装到 /Applications；04 — Open at login 默认开 + 菜单可关；05 — Reminder：壳发系统通知优先，失败回退 HUD

**Status:** done

**Parent:** `.scratch/menubar-shell/issues/00-spec-menubar-shell-v1.md`

- [x] 从 `/Applications/Cursor Watch.app` 冷启动走通：daemon + 面板 + 菜单退出
- [x] Open at login 默认开、菜单可关，行为已手验
- [x] Reminder 系统通知优先与 HUD 回退至少各验证一条路径
- [x] 打包/覆盖安装命令在 README 或 package 脚本中可发现
- [x] Out of scope 项未偷做进 v1（hooks 一键、自动更新、Electron、公证上架）
