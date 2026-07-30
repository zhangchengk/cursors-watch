# 02 — Menubar shell 最小常驻：启停 daemon + 菜单栏 + WKWebView 面板

**What to build:** 打开 Cursors Watch 壳后，菜单栏有图标；壳负责拉起 daemon；从菜单打开原生窗口即可看到现有 Inbox-first 面板；退出壳时 daemon 一并停下。用户不必再手动 `启动` 再开浏览器。

**Blocked by:** None — can start immediately.

**Status:** done

**Parent:** `.scratch/menubar-shell/issues/00-spec-menubar-shell-v1.md`

- [x] 启动壳 → daemon 在约定本地地址可访问
- [x] 菜单栏图标可见；有「显示面板」入口
- [x] WKWebView（或等价原生 Web 视图）加载 Inbox-first 面板且可操作收件箱/列表
- [x] 退出壳 → daemon 停止（端口不再被该实例占用）
- [x] 若端口被非本壳进程占用，菜单/状态有可读错误提示（不静默连错服务）
