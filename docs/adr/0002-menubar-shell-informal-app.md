# Menubar shell as informal Cursors Watch app

cursor-watch’s daily friction was manual daemon start plus browser for the inbox-first panel. We will ship an **informal** macOS **Menubar shell**: a thin Swift status-item app with WKWebView over the existing panel, **embedding Node + cursor-watch**, default **Open at login**, install to **`/Applications/Cursors Watch.app`**, rebuild via a single package command. Reminder delivery stays **OS notification first** (from the shell’s notification entitlement) with **HUD** fallback. Shell v1 stays minimal (no one-click hooks, no auto-update, no Electron rewrite).

**Rejected for v1:** browser-only workflow; Electron/Tauri full rewrite; App that only orchestrates a repo-local `npx`; LaunchAgent-only without a UI shell; Mac App Store / notarization as a gate; mounting the git worktree as the runtime source of truth.
