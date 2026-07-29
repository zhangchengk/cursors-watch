# Spec — Cursors Watch Menubar shell (Shell v1)

**Status:** ready-for-agent  
**Labels:** `ready-for-agent`  
**Date:** 2026-07-29  
**Glossary:** `CONTEXT.md`  
**ADRs:** `docs/adr/0001-reminder-over-attention.md`, `docs/adr/0002-menubar-shell-informal-app.md`  
**Approved test seams:** Reminder delivery exit (`notifyReminder` / delivery adapters); Menubar shell lifecycle (manual/script acceptance)

---

## Problem Statement

As a Cursors Watch user on macOS, I have to manually start the daemon and open a browser to use the Inbox-first panel. That friction means I often skip the tool entirely, miss Reminder delivery, and lose the benefit of Turn end alerts. I want a single informal app I can install once so the service stays up after login and the panel opens from the menu bar without hunting for a browser tab or re-running terminal commands.

## Solution

Ship an **Informal app** named **Cursors Watch** installed at `/Applications/Cursors Watch.app`: a thin **Menubar shell** (Swift status item + WKWebView) that embeds Node and cursor-watch, starts the daemon, defaults to **Open at login**, and shows the existing Inbox-first panel in a native window. **Reminder delivery** prefers real OS notifications from the shell (notification permission on the `.app`), and falls back to the existing **HUD** when permission is missing or delivery fails. Rebuild and reinstall with one package command that overwrites `/Applications/Cursors Watch.app`.

## User Stories

1. As a Cursors Watch user, I want to install one `.app` into Applications, so that I do not depend on a git checkout path for daily use.
2. As a Cursors Watch user, I want the app to start when I log into macOS by default, so that I do not remember to launch a daemon each morning.
3. As a Cursors Watch user, I want a menu bar icon while the app is running, so that I can see the tool is alive without looking for a terminal.
4. As a Cursors Watch user, I want to click the menu bar icon to open the panel window, so that I do not open a separate browser.
5. As a Cursors Watch user, I want the panel window to load the existing Inbox-first UI, so that Reminder inbox and running sessions behave as they do today.
6. As a Cursors Watch user, I want the embedded daemon to start when the app launches, so that Reminder pipeline and APIs are available without `npx cursor-watch open`.
7. As a Cursors Watch user, I want the embedded daemon to stop cleanly when I quit the app, so that ports and workers are not left orphaned.
8. As a Cursors Watch user, I want only one daemon instance on the configured port, so that the WebView always talks to the app-managed service.
9. As a Cursors Watch user, I want Reminder delivery to prefer macOS system notifications from the app, so that I get a real top-right banner when permission allows.
10. As a Cursors Watch user, I want notification permission to be requested by the Menubar shell, so that unsigned helper binaries are not the permission principal.
11. As a Cursors Watch user, I want HUD fallback when system notification is denied or fails, so that I still get a visible interrupt.
12. As a Cursors Watch user, I want Reminder acknowledgment via panel confirm/open or notification click to still clear the inbox item, so that delivery channel changes do not change ack semantics.
13. As a Cursors Watch user, I want notification deep links to focus the Menubar shell panel and select the conversation, so that click-through lands in the inbox-first UI.
14. As a Cursors Watch user, I want Reminder coalescing to keep one pending item per conversation, so that neither OS notifications nor HUD spam me.
15. As a Cursors Watch user, I want notification sound to remain opt-in via existing prefs, so that default delivery stays quiet.
16. As a Cursors Watch user, I want Focus policy unchanged (no suppress because Cursor is frontmost), so that multi-monitor workflows keep working.
17. As a Cursors Watch user, I want Active loop suppression unchanged, so that `/loop` naps still do not false-trigger Reminder.
18. As a Cursors Watch user, I want Hooks gate unchanged (`open`/app launch still does not auto-install hooks), so that Shell v1 does not expand hooks scope.
19. As a Cursors Watch user, I want to toggle “Open at login” from the menu, so that I can disable auto-start without uninstalling.
20. As a Cursors Watch user, I want a Quit action in the menu, so that I can fully stop shell + daemon.
21. As a Cursors Watch user, I want a “Show panel” action even if the window was closed, so that I can reopen without relaunching.
22. As a Cursors Watch user, I want the WebView to recover if the daemon was briefly unavailable at click time, so that a slow start does not strand me on a blank page.
23. As a developer, I want a single package command that builds the informal app with embedded runtime and installs/overwrites `/Applications/Cursors Watch.app`, so that updates are mechanical.
24. As a developer, I want ad-hoc signing sufficient for local use, so that notarization is not a v1 gate.
25. As a developer, I want the package to include the cursor-watch server assets needed for the panel and Reminder delivery adapters, so that the installed app does not read my working tree.
26. As a developer, I want Reminder delivery adapters to be swappable behind the existing notify exit, so that shell notification vs HUD can be tested at one seam.
27. As a Cursors Watch user, I want pending Reminders to remain in the inbox even if OS notify/HUD fails, so that delivery failure never erases the durable reminder.
28. As a Cursors Watch user, I want status feedback in the menu (e.g. daemon up/down), so that I can tell whether the panel will work before opening it.
29. As a Cursors Watch user, I want the app name and notification title to read “Cursors Watch”, so that banners and menu identity match.
30. As a Cursors Watch user, I want not to need a browser login for the local panel, so that “install app” replaces the old start+browser ritual (no account gate on localhost panel).
31. As a Cursors Watch user, I want clicking an OS notification to bring the shell panel forward if it was hidden, so that deep link works with the native window.
32. As a developer, I want packaging to be repeatable on Apple Silicon, so that my machine can rebuild without special notarization hardware.
33. As a Cursors Watch user, I want Shell v1 to exclude hooks installer UI, so that the first ship stays small.
34. As a Cursors Watch user, I want Shell v1 to exclude auto-update, so that updates remain the explicit package command.
35. As a Cursors Watch user, I want Shell v1 to keep a single panel window (not a multi-window workspace browser), so that the shell stays thin.
36. As a developer, I want existing Reminder pipeline tests to keep passing with a fake notify adapter, so that shell packaging does not regress Turn end behavior.
37. As a Cursors Watch user, I want HUD appearance to remain non-modal and auto-dismissing, so that fallback is less disruptive than alert dialogs.
38. As a Cursors Watch user, I want the menubar shell to not replace Cursor itself, so that the product remains a companion Reminder tool.
39. As a developer, I want documentation of the package command in the repo README or package scripts, so that future me can reinstall after pulls.
40. As a Cursors Watch user, I want quitting Cursor IDE to leave Cursors Watch running (when Open at login / app is running), so that Reminder delivery continues while I work elsewhere.

## Implementation Decisions

1. **Architecture:** Thin Menubar shell owns process lifecycle and OS notification permission; existing Node daemon owns scan/hooks/Reminder pipeline/Inbox-first panel HTTP+WS. Respect ADR-0002.
2. **Shell tech:** Swift status-item app + WKWebView loading the local panel URL served by the embedded daemon. No Electron/Tauri for v1.
3. **Embedding:** Package embeds a Node runtime and the cursor-watch application needed to run `daemon` and serve the web UI. Runtime must not require the developer’s git worktree path.
4. **Install locus:** Build output installs/overwrites `/Applications/Cursors Watch.app` (Informal app). Ad-hoc code signing is enough for v1.
5. **Open at login:** Register as a login item by default on first successful launch; expose menu toggle to disable/enable.
6. **Single instance / port:** Shell ensures the embedded daemon is the listener for the existing local host/port convention; if an alien process holds the port, surface a clear menu/status error rather than silently attaching to a foreign daemon when possible.
7. **Reminder delivery seam (primary test seam):** Keep the high-level “submit Reminder for OS delivery” exit used today. Adapters:
   - Prefer: ask Menubar shell to post a system notification (IPC or local authenticated HTTP callback owned by the shell).
   - Fallback: existing HUD path.
   - Inbox persistence remains upstream of delivery success.
8. **Deep link:** Notification activation focuses the shell’s panel window and applies the existing conversation selection query semantics.
9. **Prefs:** Reuse existing notification sound preference semantics (default silent).
10. **Packaging:** One developer-facing package command rebuilds the app bundle and copies it to `/Applications`.
11. **Hooks:** Unchanged Hooks gate — app launch does not auto-install hooks.
12. **Out-of-process workers:** Preserve notify-worker / queue durability ideas where needed so daemon FD exhaustion does not block delivery; shell-side notifications should not rely on daemon `spawn` of GUI helpers when the shell can present them directly.
13. **Modules (logical):** Menubar shell (lifecycle, WebView, login item, UNUserNotificationCenter); daemon packaging/bootstrap; Reminder delivery adapter selection; package/install script. Do not rewrite Inbox-first panel frontend for v1.

## Testing Decisions

1. **Good tests** assert external behavior only: given a Reminder ready for delivery, the chosen adapter path is invoked with stable identity (conversation / notify id), title/body semantics, and deep-link intent; inbox remains pending if delivery fails; fallback engages when the preferred channel reports failure/unavailable. Do not assert Swift internals or private IPC framing.
2. **Primary automated seam:** Reminder delivery exit / adapter selection (Node side), following existing notify and pipeline test style (mock `run` / inject notify function). Prefer extending current notify/pipeline tests over new low-level suites.
3. **Shell lifecycle:** Manual or scripted acceptance (launch → daemon up → WebView loads panel → quit stops daemon; login item toggle; package installs to Applications). Not required as the Node unit-test seam.
4. **Prior art:** `cursor-watch` vitest suites for reminders notify/pipeline; existing HUD/banner probe habits for visual fallback checks.
5. **Non-goals for tests:** Re-testing Turn end / Active loop / hooks install; pixel-perfect WebView chrome.

## Out of Scope

- Mac App Store, notarization, Sparkle/auto-update
- Electron/Tauri rewrite of the panel
- One-click hooks install from the menu (Shell v1)
- Multi-window IDE-like shell, attention-queue redesign
- Windows/Linux packaging
- Guaranteeing jump into a specific Cursor Chat (panel selection remains the deep-link promise)
- Changing Reminder primary trigger away from Turn end / Active loop rules
- Mounting the git worktree as the production runtime source of truth

## Further Notes

- Domain language: Menubar shell, Informal app, Shell v1, Open at login, Reminder delivery, HUD, Inbox-first panel — see `CONTEXT.md`.
- Seams approved with the user before writing this spec: (1) Reminder delivery exit; (2) Menubar shell lifecycle acceptance.
- Mirror path for durable review: `docs/superpowers/specs/2026-07-29-cursor-watch-menubar-shell-design.md`.
- Next optional step: `/to-tickets` to slice Shell v1 into tracer-bullet tickets.
