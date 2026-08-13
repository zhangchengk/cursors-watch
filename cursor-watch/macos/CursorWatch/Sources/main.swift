import AppKit
import Foundation
import ServiceManagement
import UserNotifications
import WebKit

enum CWConfig {
  static let panelURL = URL(string: "http://127.0.0.1:7423/")!
  static let host = "127.0.0.1"
  static let port = 7423
  static let stateDir: URL = {
    FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".cursor-watch", isDirectory: true)
  }()
  static var shellNotifyDir: URL {
    stateDir.appendingPathComponent("shell-notify", isDirectory: true)
  }
  static var shellAlive: URL {
    shellNotifyDir.appendingPathComponent("shell.alive")
  }
  static var packageRoot: URL? {
    if let env = ProcessInfo.processInfo.environment["CURSOR_WATCH_ROOT"], !env.isEmpty {
      return URL(fileURLWithPath: env, isDirectory: true)
    }
    if let res = Bundle.main.resourceURL?
      .appendingPathComponent("cursor-watch", isDirectory: true),
      FileManager.default.fileExists(atPath: res.path)
    {
      return res
    }
    return nil
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate, WKScriptMessageHandler {
  private var statusItem: NSStatusItem!
  private var panel: NSWindow?
  private var webView: WKWebView?
  private var daemon: Process?
  private var notifyWatcher: DispatchSourceFileSystemObject?
  private var openAtLoginMenuItem: NSMenuItem!
  private var daemonStatusMenuItem: NSMenuItem!
  private var statusMenu: NSMenu!
  private var aliveHeartbeat: Timer?
  private var statusRefresh: Timer?
  /// true when we started the daemon process ourselves
  private var ownsDaemon = false
  /// port was already open and is not a cursor-watch API
  private var foreignPortAtLaunch = false
  /// port was already open and answered as cursor-watch — reuse it
  private var adoptedExistingDaemon = false
  /// Prefer this URL on next successful panel load (notification deep link).
  private var pendingPanelURL: URL?

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)
    UNUserNotificationCenter.current().delegate = self
    UNUserNotificationCenter.current()
      .requestAuthorization(options: [.alert, .sound]) { _, _ in }

    setupStatusItem()
    ensureStateDirs()
    touchShellAlive()
    aliveHeartbeat = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
      self?.touchShellAlive()
    }
    statusRefresh = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
      self?.refreshDaemonStatusMenu()
    }
    startDaemon()
    startShellNotifyWatcher()
    applyDefaultOpenAtLogin()
    refreshDaemonStatusMenu()
    // After notification auth sheet; only once if FDA is missing.
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
      self?.maybePromptFullDiskAccess()
    }
  }

  func applicationWillTerminate(_ notification: Notification) {
    aliveHeartbeat?.invalidate()
    aliveHeartbeat = nil
    statusRefresh?.invalidate()
    statusRefresh = nil
    stopDaemon()
    try? FileManager.default.removeItem(at: CWConfig.shellAlive)
  }

  private func setupStatusItem() {
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    if let button = statusItem.button {
      button.title = "CW"
      button.toolTip = "Cursors Watch"
      button.target = self
      button.action = #selector(statusItemClicked(_:))
      button.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }
    statusMenu = NSMenu()
    daemonStatusMenuItem = NSMenuItem(
      title: "daemon: …",
      action: nil,
      keyEquivalent: ""
    )
    daemonStatusMenuItem.isEnabled = false
    statusMenu.addItem(daemonStatusMenuItem)
    statusMenu.addItem(NSMenuItem.separator())
    statusMenu.addItem(NSMenuItem(title: "显示面板", action: #selector(showPanel), keyEquivalent: "o"))
    openAtLoginMenuItem = NSMenuItem(
      title: "登录时打开",
      action: #selector(toggleOpenAtLogin),
      keyEquivalent: ""
    )
    openAtLoginMenuItem.state = isOpenAtLoginEnabled() ? .on : .off
    statusMenu.addItem(openAtLoginMenuItem)
    statusMenu.addItem(
      NSMenuItem(
        title: "完全磁盘访问…",
        action: #selector(openFullDiskAccessSettings),
        keyEquivalent: ""
      )
    )
    statusMenu.addItem(NSMenuItem.separator())
    statusMenu.addItem(
      NSMenuItem(title: "退出 Cursors Watch", action: #selector(quit), keyEquivalent: "q")
    )
  }

  @objc private func statusItemClicked(_ sender: Any?) {
    guard let event = NSApp.currentEvent else {
      showPanel()
      return
    }
    if event.type == .rightMouseUp || event.modifierFlags.contains(.control) {
      refreshDaemonStatusMenu()
      statusItem.menu = statusMenu
      statusItem.button?.performClick(nil)
      statusItem.menu = nil
    } else {
      showPanel()
    }
  }

  @objc private func quit() {
    NSApp.terminate(nil)
  }

  private func refreshDaemonStatusMenu() {
    let up = isPortOpen()
    if foreignPortAtLaunch && !ownsDaemon && !adoptedExistingDaemon {
      daemonStatusMenuItem.title = "daemon: 端口被占用（非本服务）"
    } else if up {
      if ownsDaemon {
        daemonStatusMenuItem.title = "daemon: 运行中"
      } else if adoptedExistingDaemon {
        daemonStatusMenuItem.title = "daemon: 运行中（已接管）"
      } else {
        daemonStatusMenuItem.title = "daemon: 运行中"
      }
    } else {
      daemonStatusMenuItem.title = "daemon: 未运行"
    }
  }

  @objc private func showPanel() {
    presentPanel(url: nil)
  }

  private func presentPanel(url: URL?) {
    if let url { pendingPanelURL = url }
    if panel == nil { buildPanel() }
    guard let panel else { return }
    if foreignPortAtLaunch && !ownsDaemon && !adoptedExistingDaemon {
      loadErrorPage(
        "端口 \(CWConfig.port) 已被其他程序占用，且不是 Cursors Watch 服务。请结束该进程后重新打开。"
      )
      panel.makeKeyAndOrderFront(nil)
      NSApp.activate(ignoringOtherApps: true)
      return
    }
    waitForDaemon(attempts: 40) { [weak self] ok in
      guard let self else { return }
      if !ok {
        self.loadErrorPage(
          "daemon 未在 \(CWConfig.host):\(CWConfig.port) 就绪。请设置 CURSOR_WATCH_ROOT 或使用打包安装版。"
        )
      } else {
        let target = self.pendingPanelURL ?? CWConfig.panelURL
        self.pendingPanelURL = nil
        self.webView?.load(URLRequest(url: target))
      }
      panel.makeKeyAndOrderFront(nil)
      NSApp.activate(ignoringOtherApps: true)
      self.refreshDaemonStatusMenu()
    }
  }

  private func buildPanel() {
    let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
    let width: CGFloat = min(1100, screen.width * 0.85)
    let height: CGFloat = min(760, screen.height * 0.85)
    let rect = NSRect(
      x: screen.midX - width / 2,
      y: screen.midY - height / 2,
      width: width,
      height: height
    )
    // NSWindow (not NSPanel): HTML fullscreen is unreliable in WKWebView;
    // the panel button bridges to native toggleFullScreen instead.
    let panel = NSWindow(
      contentRect: rect,
      styleMask: [.titled, .closable, .resizable, .miniaturizable],
      backing: .buffered,
      defer: false
    )
    panel.title = "Cursors Watch"
    panel.collectionBehavior = [.fullScreenPrimary, .managed]
    panel.isReleasedWhenClosed = false

    let config = WKWebViewConfiguration()
    config.preferences.setValue(true, forKey: "fullScreenEnabled")
    config.userContentController.add(self, name: "cursorWatch")
    let webView = WKWebView(frame: panel.contentView!.bounds, configuration: config)
    webView.autoresizingMask = [.width, .height]
    panel.contentView?.addSubview(webView)
    self.panel = panel
    self.webView = webView

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(windowFullScreenChanged(_:)),
      name: NSWindow.didEnterFullScreenNotification,
      object: panel
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(windowFullScreenChanged(_:)),
      name: NSWindow.didExitFullScreenNotification,
      object: panel
    )
  }

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard message.name == "cursorWatch" else { return }
    let type: String?
    if let body = message.body as? [String: Any] {
      type = body["type"] as? String
    } else {
      type = message.body as? String
    }
    if type == "toggleFullscreen" {
      toggleNativeFullscreen()
    } else if type == "queryFullscreen" {
      pushFullscreenStateToWeb()
    } else if type == "pickAttachmentFiles" || type == "pickMarkdownFiles" {
      pickAttachmentFiles()
    }
  }

  private func pickAttachmentFiles() {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      let panel = NSOpenPanel()
      panel.canChooseFiles = true
      panel.canChooseDirectories = false
      panel.allowsMultipleSelection = true
      panel.allowedFileTypes = ["md", "html"]
      panel.message = "选择要绑定的 .md 或 .html 文件"
      panel.begin { [weak self] response in
        guard let self else { return }
        var paths: [String] = []
        if response == .OK {
          paths = panel.urls.map { $0.path }
        }
        self.pushPickedAttachmentPaths(paths)
      }
    }
  }

  private func pushPickedAttachmentPaths(_ paths: [String]) {
    let data = (try? JSONSerialization.data(withJSONObject: paths, options: [])) ?? Data("[]".utf8)
    let json = String(data: data, encoding: .utf8) ?? "[]"
    let js = "window.__cwPickedAttachments && window.__cwPickedAttachments(\(json))"
    webView?.evaluateJavaScript(js, completionHandler: nil)
  }

  private func toggleNativeFullscreen() {
    guard let panel else { return }
    panel.toggleFullScreen(nil)
  }

  @objc private func windowFullScreenChanged(_ note: Notification) {
    pushFullscreenStateToWeb()
  }

  private func pushFullscreenStateToWeb() {
    let on = panel?.styleMask.contains(.fullScreen) == true
    let js = "window.__cwSetFullscreen && window.__cwSetFullscreen(\(on ? "true" : "false"))"
    webView?.evaluateJavaScript(js, completionHandler: nil)
  }

  private func loadErrorPage(_ message: String) {
    let escaped = message
      .replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
    let html =
      "<html><body style=\"font-family:-apple-system;padding:24px\">"
      + "<h2>Cursors Watch</h2><p>\(escaped)</p></body></html>"
    webView?.loadHTMLString(html, baseURL: nil)
  }

  private func startDaemon() {
    if isPortOpen() {
      if probeCursorWatchApi() {
        adoptedExistingDaemon = true
        log("adopting existing cursor-watch on port \(CWConfig.port)")
        return
      }
      foreignPortAtLaunch = true
      log("port \(CWConfig.port) open but not cursor-watch API")
      return
    }
    guard let root = CWConfig.packageRoot else {
      log("CURSOR_WATCH_ROOT / bundled cursor-watch missing")
      return
    }
    let cli = root.appendingPathComponent("src/cli.ts").path
    let bin = root.appendingPathComponent("bin/cursor-watch.mjs").path
    let proc = Process()
    var env = ProcessInfo.processInfo.environment
    env["PATH"] =
      "\(root.appendingPathComponent("node_modules/.bin").path):\(env["PATH"] ?? "/usr/bin:/bin")"
    env["CURSOR_WATCH_STATE_DIR"] =
      env["CURSOR_WATCH_STATE_DIR"] ?? CWConfig.stateDir.path
    proc.currentDirectoryURL = root
    proc.environment = env

    let logPath = CWConfig.stateDir.appendingPathComponent("shell-daemon.log").path
    FileManager.default.createFile(atPath: logPath, contents: nil)
    let logHandle = FileHandle(forWritingAtPath: logPath)
    logHandle?.seekToEndOfFile()
    proc.standardOutput = logHandle
    proc.standardError = logHandle

    if let node = bundledNode() {
      proc.executableURL = URL(fileURLWithPath: node)
      if FileManager.default.fileExists(
        atPath: root.appendingPathComponent("node_modules/tsx").path
      ) {
        proc.arguments = ["--import", "tsx", cli, "daemon"]
      } else {
        proc.arguments = [bin, "daemon"]
      }
    } else {
      proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
      proc.arguments = [
        "-lc",
        "cd \(shellEscape(root.path)) && exec node --import tsx src/cli.ts daemon",
      ]
    }
    do {
      try proc.run()
      daemon = proc
      ownsDaemon = true
      log(
        "daemon pid=\(proc.processIdentifier) root=\(root.path) node=\(bundledNode() ?? "zsh")"
      )
    } catch {
      log("daemon start failed: \(error)")
    }
  }

  /// True when localhost:port serves cursor-watch `/api/sessions`.
  private func probeCursorWatchApi() -> Bool {
    guard
      let url = URL(string: "http://\(CWConfig.host):\(CWConfig.port)/api/sessions")
    else { return false }
    var request = URLRequest(url: url)
    request.timeoutInterval = 1.5
    let sem = DispatchSemaphore(value: 0)
    var ok = false
    URLSession.shared.dataTask(with: request) { _, resp, _ in
      if let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
        ok = true
      }
      sem.signal()
    }.resume()
    _ = sem.wait(timeout: .now() + 2)
    return ok
  }

  private func log(_ message: String) {
    let line = "[CursorWatch] \(message)\n"
    NSLog("%@", line)
    let url = CWConfig.stateDir.appendingPathComponent("shell.log")
    if !FileManager.default.fileExists(atPath: url.path) {
      FileManager.default.createFile(atPath: url.path, contents: nil)
    }
    if let handle = try? FileHandle(forWritingTo: url) {
      defer { try? handle.close() }
      handle.seekToEndOfFile()
      handle.write(Data(line.utf8))
    }
  }

  private func stopDaemon() {
    guard ownsDaemon else { return }
    if let daemon, daemon.isRunning {
      daemon.terminate()
      daemon.waitUntilExit()
      self.daemon = nil
    }
    guard let root = CWConfig.packageRoot else { return }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/zsh")
    p.arguments = [
      "-lc",
      "cd \(shellEscape(root.path)) && node --import tsx src/cli.ts stop || true",
    ]
    try? p.run()
    p.waitUntilExit()
    ownsDaemon = false
  }

  private func bundledNode() -> String? {
    guard let url = Bundle.main.resourceURL?.appendingPathComponent("node"),
          FileManager.default.isExecutableFile(atPath: url.path)
    else { return nil }
    return url.path
  }

  private func isPortOpen() -> Bool {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    defer { close(fd) }
    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = in_port_t(CWConfig.port).bigEndian
    inet_pton(AF_INET, CWConfig.host, &addr.sin_addr)
    return withUnsafePointer(to: &addr) { ptr -> Bool in
      ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
        Darwin.connect(fd, sa, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
      }
    }
  }

  private func waitForDaemon(attempts: Int, done: @escaping (Bool) -> Void) {
    func tick(_ n: Int) {
      if isPortOpen() {
        done(true)
        return
      }
      if n <= 0 {
        done(false)
        return
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { tick(n - 1) }
    }
    tick(attempts)
  }

  private func ensureStateDirs() {
    try? FileManager.default.createDirectory(
      at: CWConfig.shellNotifyDir,
      withIntermediateDirectories: true
    )
  }

  private func touchShellAlive() {
    ensureStateDirs()
    let data = Data("1".utf8)
    if FileManager.default.fileExists(atPath: CWConfig.shellAlive.path) {
      try? data.write(to: CWConfig.shellAlive)
    } else {
      FileManager.default.createFile(
        atPath: CWConfig.shellAlive.path,
        contents: data
      )
    }
  }

  private func startShellNotifyWatcher() {
    ensureStateDirs()
    let dir = CWConfig.shellNotifyDir.path
    let fd = open(dir, O_EVTONLY)
    guard fd >= 0 else { return }
    let src = DispatchSource.makeFileSystemObjectSource(
      fileDescriptor: fd,
      eventMask: [.write, .extend, .rename],
      queue: DispatchQueue.global()
    )
    src.setEventHandler { [weak self] in
      self?.drainShellNotifyQueue()
    }
    src.setCancelHandler { close(fd) }
    src.resume()
    notifyWatcher = src
    drainShellNotifyQueue()
  }

  private func drainShellNotifyQueue() {
    let fm = FileManager.default
    guard let files = try? fm.contentsOfDirectory(
      at: CWConfig.shellNotifyDir,
      includingPropertiesForKeys: nil
    ) else { return }
    for url in files where url.pathExtension == "json" {
      guard let data = try? Data(contentsOf: url),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else {
        try? fm.removeItem(at: url)
        continue
      }
      try? fm.removeItem(at: url)
      let title = obj["title"] as? String ?? "Cursors Watch"
      let subtitle = obj["subtitle"] as? String ?? ""
      let body = obj["message"] as? String ?? ""
      let openUrl = obj["openUrl"] as? String
      let sound = obj["sound"] as? Bool ?? false
      postNotification(
        title: title,
        subtitle: subtitle,
        body: body,
        openUrl: openUrl,
        sound: sound
      )
    }
  }

  private func postNotification(
    title: String,
    subtitle: String,
    body: String,
    openUrl: String?,
    sound: Bool
  ) {
    let content = UNMutableNotificationContent()
    content.title = title
    if !subtitle.isEmpty { content.subtitle = subtitle }
    content.body = body
    if sound { content.sound = .default }
    if let openUrl { content.userInfo["openUrl"] = openUrl }
    let req = UNNotificationRequest(
      identifier: UUID().uuidString,
      content: content,
      trigger: nil
    )
    UNUserNotificationCenter.current().add(req) { [weak self] err in
      if let err {
        NSLog("[CursorWatch] notify failed: \(err) — HUD fallback")
        self?.runHudFallback(
          title: title,
          subtitle: subtitle,
          body: body,
          openUrl: openUrl ?? CWConfig.panelURL.absoluteString,
          sound: sound
        )
        return
      }
      // Also check authorization; denied → HUD
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        let ok =
          settings.authorizationStatus == .authorized
          || settings.authorizationStatus == .provisional
        if !ok {
          NSLog("[CursorWatch] notify not authorized — HUD fallback")
          self?.runHudFallback(
            title: title,
            subtitle: subtitle,
            body: body,
            openUrl: openUrl ?? CWConfig.panelURL.absoluteString,
            sound: sound
          )
        }
      }
    }
  }

  private var hudPanel: NSPanel?
  private var hudHideWork: DispatchWorkItem?
  private var hudOpenUrl: String?

  private func runHudFallback(
    title: String,
    subtitle: String,
    body: String,
    openUrl: String,
    sound: Bool
  ) {
    DispatchQueue.main.async { [weak self] in
      self?.showNativeHud(
        title: title,
        subtitle: subtitle,
        body: body,
        openUrl: openUrl,
        sound: sound
      )
    }
  }

  private func showNativeHud(
    title: String,
    subtitle: String,
    body: String,
    openUrl: String,
    sound: Bool
  ) {
    hudHideWork?.cancel()
    hudPanel?.orderOut(nil)
    hudPanel = nil
    hudOpenUrl = openUrl

    let screen = NSScreen.main?.visibleFrame
      ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
    let width: CGFloat = 360
    let height: CGFloat = 96
    let margin: CGFloat = 16
    let rect = NSRect(
      x: screen.maxX - width - margin,
      y: screen.maxY - height - margin,
      width: width,
      height: height
    )

    let panel = NSPanel(
      contentRect: rect,
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    panel.level = .statusBar
    panel.isFloatingPanel = true
    panel.hidesOnDeactivate = false
    panel.hasShadow = true
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

    let root = NSView(frame: NSRect(origin: .zero, size: rect.size))
    root.wantsLayer = true
    root.layer?.backgroundColor = NSColor(calibratedWhite: 0.12, alpha: 0.92).cgColor
    root.layer?.cornerRadius = 12

    let titleField = NSTextField(labelWithString: title)
    titleField.font = .systemFont(ofSize: 13, weight: .semibold)
    titleField.textColor = .white
    titleField.frame = NSRect(x: 14, y: 58, width: width - 28, height: 18)

    let subField = NSTextField(labelWithString: subtitle)
    subField.font = .systemFont(ofSize: 12, weight: .medium)
    subField.textColor = NSColor(calibratedWhite: 0.85, alpha: 1)
    subField.frame = NSRect(x: 14, y: 38, width: width - 28, height: 16)

    let bodyField = NSTextField(labelWithString: body)
    bodyField.font = .systemFont(ofSize: 12)
    bodyField.textColor = NSColor(calibratedWhite: 0.75, alpha: 1)
    bodyField.frame = NSRect(x: 14, y: 14, width: width - 28, height: 20)
    bodyField.lineBreakMode = .byTruncatingTail

    root.addSubview(titleField)
    if !subtitle.isEmpty { root.addSubview(subField) }
    root.addSubview(bodyField)
    panel.contentView = root

    let click = NSClickGestureRecognizer(
      target: self,
      action: #selector(hudClicked)
    )
    root.addGestureRecognizer(click)

    panel.orderFrontRegardless()
    hudPanel = panel

    if sound {
      NSSound(named: "Glass")?.play()
    }

    let work = DispatchWorkItem { [weak self] in
      self?.hudPanel?.orderOut(nil)
      self?.hudPanel = nil
      self?.hudOpenUrl = nil
    }
    hudHideWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: work)
  }

  @objc private func hudClicked() {
    let openUrl = hudOpenUrl ?? CWConfig.panelURL.absoluteString
    hudHideWork?.cancel()
    hudPanel?.orderOut(nil)
    hudPanel = nil
    hudOpenUrl = nil
    if let url = URL(string: openUrl) {
      presentPanel(url: url)
    } else {
      presentPanel(url: nil)
    }
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    if let openUrl = response.notification.request.content.userInfo["openUrl"] as? String,
       let url = URL(string: openUrl)
    {
      presentPanel(url: url)
    } else {
      presentPanel(url: nil)
    }
    completionHandler()
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler:
      @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .list, .sound])
  }

  private func applyDefaultOpenAtLogin() {
    let key = "CWDidSetOpenAtLoginDefault"
    if !UserDefaults.standard.bool(forKey: key) {
      setOpenAtLogin(true)
      UserDefaults.standard.set(true, forKey: key)
    }
    openAtLoginMenuItem.state = isOpenAtLoginEnabled() ? .on : .off
  }

  /// One-time guide: grant Full Disk Access instead of many folder TCC prompts.
  private static let didPromptFullDiskAccessKey = "CWDidPromptFullDiskAccess"

  private func maybePromptFullDiskAccess() {
    let defaults = UserDefaults.standard
    if defaults.bool(forKey: Self.didPromptFullDiskAccessKey) { return }
    if hasFullDiskAccess() {
      defaults.set(true, forKey: Self.didPromptFullDiskAccessKey)
      return
    }

    let alert = NSAlert()
    alert.messageText = "需要完全磁盘访问权限"
    alert.informativeText =
      "Cursors Watch 会读取本机 Cursor 会话与工程路径。"
      + "授权一次「完全磁盘访问」后，一般不必再对桌面、文稿等逐个点允许。"
      + "\n\n请在系统设置中勾选 Cursors Watch，然后回到本应用即可。"
    alert.alertStyle = .informational
    alert.addButton(withTitle: "打开系统设置")
    alert.addButton(withTitle: "以后再说")

    NSApp.activate(ignoringOtherApps: true)
    let response = alert.runModal()
    defaults.set(true, forKey: Self.didPromptFullDiskAccessKey)
    if response == .alertFirstButtonReturn {
      openFullDiskAccessSettings()
    }
  }

  /// Heuristic: readable FDA-gated files ⇒ Full Disk Access is on.
  private func hasFullDiskAccess() -> Bool {
    let home = FileManager.default.homeDirectoryForCurrentUser
    let probes: [URL] = [
      home.appendingPathComponent(
        "Library/Application Support/com.apple.TCC/TCC.db"
      ),
      home.appendingPathComponent("Library/Safari/Bookmarks.plist"),
      home.appendingPathComponent("Library/Safari/CloudTabs.db"),
      URL(fileURLWithPath: "/Library/Preferences/com.apple.TimeMachine.plist"),
    ]
    for url in probes {
      do {
        _ = try Data(contentsOf: url, options: [.mappedIfSafe])
        return true
      } catch let err as NSError {
        if err.domain == NSCocoaErrorDomain,
           err.code == NSFileReadNoPermissionError
        {
          return false
        }
        if err.domain == NSPOSIXErrorDomain,
           err.code == Int(EPERM) || err.code == Int(EACCES)
        {
          return false
        }
        // Missing file — try next probe.
        continue
      } catch {
        continue
      }
    }
    return false
  }

  @objc private func openFullDiskAccessSettings() {
    let candidates = [
      "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles",
    ]
    for s in candidates {
      if let url = URL(string: s), NSWorkspace.shared.open(url) {
        return
      }
    }
  }

  @objc private func toggleOpenAtLogin() {
    let next = !isOpenAtLoginEnabled()
    setOpenAtLogin(next)
    openAtLoginMenuItem.state = next ? .on : .off
  }

  private func isOpenAtLoginEnabled() -> Bool {
    if #available(macOS 13.0, *) {
      return SMAppService.mainApp.status == .enabled
    }
    return UserDefaults.standard.bool(forKey: "CWOpenAtLogin")
  }

  private func setOpenAtLogin(_ enabled: Bool) {
    if #available(macOS 13.0, *) {
      do {
        if enabled {
          try SMAppService.mainApp.register()
        } else {
          try SMAppService.mainApp.unregister()
        }
      } catch {
        NSLog("[CursorWatch] Open at login: \(error)")
      }
    }
    UserDefaults.standard.set(enabled, forKey: "CWOpenAtLogin")
  }

  private func shellEscape(_ s: String) -> String {
    "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
  }
}

@main
enum CursorWatchMain {
  static func main() {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.run()
  }
}
