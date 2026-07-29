# 03 — 非正式 App 打包安装到 /Applications

**What to build:** 一条打包命令生成自包含的非正式 Cursor Watch `.app`（内嵌运行时与 cursor-watch），并覆盖安装到 `/Applications/Cursor Watch.app`。安装后日常使用不依赖仓库路径或临时 `npx`。

**Blocked by:** 02 — Menubar shell 最小常驻

**Status:** done

**Parent:** `.scratch/menubar-shell/issues/00-spec-menubar-shell-v1.md`

- [x] 存在可重复执行的打包/安装命令（文档或脚本入口明确）
- [x] 产物安装到 `/Applications/Cursor Watch.app`（覆盖旧版）
- [x] 从 Applications 启动的 App 能完成 02 的启停与面板行为，且不读开发者 git worktree 作为运行时源
- [x] ad-hoc 签名足以本机打开（不以公证为验收条件）
