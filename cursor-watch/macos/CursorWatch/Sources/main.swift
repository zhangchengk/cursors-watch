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

final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
  private var statusItem: NSStatusItem!
  private var panel: NSPanel?
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
  /// port was already open before we tried to start (foreign/shared)
  private var foreignPortAtLaunch = false
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
      button.toolTip = "Cursor Watch"
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
    statusMenu.addItem(NSMenuItem.separator())
    statusMenu.addItem(
      NSMenuItem(title: "退出 Cursor Watch", action: #selector(quit), keyEquivalent: "q")
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
    if foreignPortAtLaunch && !ownsDaemon {
      daemonStatusMenuItem.title = "daemon: 端口被占用（非本壳）"
    } else if up {
      daemonStatusMenuItem.title = ownsDaemon ? "daemon: 运行中" : "daemon: 运行中（外部）"
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
    if foreignPortAtLaunch && !ownsDaemon {
      loadErrorPage(
        "端口 \(CWConfig.port) 已被其他进程占用。请先停止已有 cursor-watch daemon，再重新打开 Cursor Watch。"
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
    let panel = NSPanel(
      contentRect: rect,
      styleMask: [.titled, .closable, .resizable, .miniaturizable],
      backing: .buffered,
      defer: false
    )
    panel.title = "Cursor Watch"
    panel.isFloatingPanel = false
    panel.hidesOnDeactivate = false

    let webView = WKWebView(frame: panel.contentView!.bounds)
    webView.autoresizingMask = [.width, .height]
    panel.contentView?.addSubview(webView)
    self.panel = panel
    self.webView = webView
  }

  private func loadErrorPage(_ message: String) {
    let escaped = message
      .replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
    let html =
      "<html><body style=\"font-family:-apple-system;padding:24px\">"
      + "<h2>Cursor Watch</h2><p>\(escaped)</p></body></html>"
    webView?.loadHTMLString(html, baseURL: nil)
  }

  private func startDaemon() {
    if isPortOpen() {
      foreignPortAtLaunch = true
      log("port \(CWConfig.port) already open — not starting owned daemon")
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
      let title = obj["title"] as? String ?? "Cursor Watch"
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

  private func runHudFallback(
    title: String,
    subtitle: String,
    body: String,
    openUrl: String,
    sound: Bool
  ) {
    let candidates = [
      Bundle.main.resourceURL?
        .appendingPathComponent(
          "cursor-watch/vendor/mac/CursorWatchBanner.app/Contents/MacOS/CursorWatchBanner"
        ).path,
      CWConfig.packageRoot?
        .appendingPathComponent(
          "vendor/mac/CursorWatchBanner.app/Contents/MacOS/CursorWatchBanner"
        ).path,
    ].compactMap { $0 }
    guard let bin = candidates.first(where: {
      FileManager.default.isExecutableFile(atPath: $0)
    }) else {
      NSLog("[CursorWatch] HUD binary missing")
      return
    }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: bin)
    p.arguments = [
      title,
      subtitle,
      body,
      openUrl,
      "5",
      sound ? "1" : "0",
    ]
    try? p.run()
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
