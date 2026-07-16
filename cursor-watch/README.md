# cursor-watch

本地 **Cursor Agent 态势感知** 面板：只读扫描本机 Cursor 会话，在浏览器里看谁在跑、谁在等你。不修改会话、不脱敏、不跳转 Cursor。

## 安装

```bash
cd cursor-watch && npm install
```

## 使用

```bash
npx cursor-watch open    # 按需拉起 daemon 并打开面板
npx cursor-watch status  # 查看 daemon / 端口状态
npx cursor-watch stop    # 停止 daemon
```

## 面板

会话按工作区（工程路径）分区展示；顶栏计数仍按会话条数。组头显示路径、「显示 k / 组内 m」与状态摘要（每组最多 Top4，并始终保留未读/本轮结束提醒）。卡片标题优先用 Cursor Agent 侧边栏 chat name（`composerHeaders`），找不到再回退到首条用户消息。LIVE 会话显示迷你滚动（或 LIVE 徽标）；有未读 / 本轮结束时显示完成行。

## Hooks（可选）

```bash
npx cursor-watch hooks install   # 用户级观察脚本 → ~/.cursor-watch/live
npx cursor-watch hooks status
npx cursor-watch hooks uninstall
```

不安装也可使用面板；安装后可显示 LIVE 迷你滚动与更准的「在跑」状态。hooks 失败不影响 Cursor。

## 端口

- 默认：`http://127.0.0.1:7423`
- 覆盖：环境变量 `CURSOR_WATCH_PORT`

## 数据源

扫描 `~/.cursor/projects` 下的 agent transcripts 与 terminals（只读）。可选 hooks 写入 `~/.cursor-watch/live`。

## 信任边界

- 仅监听 **localhost**（`127.0.0.1`）
- 展示原文路径与消息摘要，**不做脱敏**；请勿把端口暴露到公网

## v2 路线图

后续计划：从面板一键跳转回 Cursor 会话。
