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

会话按工作区（工程路径）分区展示；顶栏计数仍按会话条数。组头显示路径、会话数与状态摘要。

## 端口

- 默认：`http://127.0.0.1:7423`
- 覆盖：环境变量 `CURSOR_WATCH_PORT`

## 数据源

扫描 `~/.cursor/projects` 下的 agent transcripts 与 terminals（只读）。

## 信任边界

- 仅监听 **localhost**（`127.0.0.1`）
- 展示原文路径与消息摘要，**不做脱敏**；请勿把端口暴露到公网

## v2 路线图

后续计划：接入 Cursor Hooks、以及从面板一键跳转回 Cursor 会话。
