#!/usr/bin/env bash
# Build informal Cursors Watch.app and optionally install to /Applications.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MACOS_DIR="$ROOT/macos/CursorWatch"
SRC="$MACOS_DIR/Sources/main.swift"
DIST="$MACOS_DIR/dist"
APP="$DIST/Cursors Watch.app"
BIN_DIR="$APP/Contents/MacOS"
RES_DIR="$APP/Contents/Resources"
INSTALL_TO="${INSTALL_TO:-/Applications/Cursors Watch.app}"
DO_INSTALL="${1:-}"

mkdir -p "$BIN_DIR" "$RES_DIR"
TMP_BIN="$(mktemp)"
xcrun swiftc -O -parse-as-library \
  -framework AppKit \
  -framework WebKit \
  -framework UserNotifications \
  -framework ServiceManagement \
  "$SRC" -o "$TMP_BIN"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>Cursors Watch</string>
  <key>CFBundleIdentifier</key>
  <string>com.cursor-watch.app</string>
  <key>CFBundleName</key>
  <string>Cursors Watch</string>
  <key>CFBundleDisplayName</key>
  <string>Cursors Watch</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSUserNotificationUsageDescription</key>
  <string>Cursors Watch needs notifications for Reminder delivery.</string>
</dict>
</plist>
PLIST
echo -n 'APPL????' > "$APP/Contents/PkgInfo"
mv "$TMP_BIN" "$BIN_DIR/Cursors Watch"
chmod +x "$BIN_DIR/Cursors Watch"

# Bundle cursor-watch package (dev copy; node binary optional)
rsync -a --delete \
  --exclude node_modules \
  --exclude macos/CursorWatch/dist \
  --exclude 'vendor/mac/*.app' \
  --exclude 'vendor/mac/_bundles' \
  --exclude '.git' \
  "$ROOT/" "$RES_DIR/cursor-watch/"
# Keep node_modules for tsx/runtime deps
if [ -d "$ROOT/node_modules" ]; then
  rsync -a "$ROOT/node_modules/" "$RES_DIR/cursor-watch/node_modules/"
fi
# Prefer system node via PATH when not embedding; copy real binary if available
NODE_BIN="$(node -p 'process.execPath' 2>/dev/null || true)"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "error: Node.js >= 20 required to embed runtime into Cursors Watch.app" >&2
  exit 1
fi
rm -f "$RES_DIR/node"
cp -f "$NODE_BIN" "$RES_DIR/node"
chmod +x "$RES_DIR/node"

# Bundle bridge VSIX when present (built via extensions/cursor-watch-bridge)
VSIX_SRC="$(ls -1 "$ROOT/extensions/cursor-watch-bridge"/*.vsix 2>/dev/null | tail -1 || true)"
if [ -n "$VSIX_SRC" ] && [ -f "$VSIX_SRC" ]; then
  mkdir -p "$RES_DIR/cursor-watch/extensions/cursor-watch-bridge"
  cp -f "$VSIX_SRC" "$RES_DIR/cursor-watch/extensions/cursor-watch-bridge/"
  echo "Bundled VSIX: $(basename "$VSIX_SRC")"
else
  echo "warn: no bridge VSIX found under extensions/cursor-watch-bridge — run vsce package there first" >&2
fi

xattr -cr "$APP" 2>/dev/null || true
# Drop previous signature so re-sign succeeds after resource refresh
codesign --remove-signature "$APP" 2>/dev/null || true

# Stable local identity (not ad-hoc): preserves macOS TCC folder grants across reinstalls.
SIGN_IDENTITY="${CURSOR_WATCH_CODESIGN_IDENTITY:-}"
if [ -z "$SIGN_IDENTITY" ]; then
  SIGN_IDENTITY="$("$ROOT/scripts/ensure-codesign-identity.sh")"
fi
KEYCHAIN="${CURSOR_WATCH_CODESIGN_KEYCHAIN:-}"
if [ -z "$KEYCHAIN" ]; then
  if [ -f "$HOME/.cursor-watch/codesign.keychain-db" ]; then
    KEYCHAIN="$HOME/.cursor-watch/codesign.keychain-db"
  else
    KEYCHAIN="$HOME/.cursor-watch/codesign.keychain"
  fi
fi
if [ -f "$KEYCHAIN" ]; then
  security unlock-keychain -p "${CURSOR_WATCH_CODESIGN_KEYCHAIN_PASS:-cursor-watch-local-codesign}" "$KEYCHAIN" >/dev/null 2>&1 || true
  codesign --force --deep --sign "$SIGN_IDENTITY" --keychain "$KEYCHAIN" "$APP" 2>&1 | tail -8
else
  codesign --force --deep --sign "$SIGN_IDENTITY" "$APP" 2>&1 | tail -8
fi
echo "Signed with: $SIGN_IDENTITY"

echo "Built: $APP"

LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

if [ "$DO_INSTALL" = "install" ]; then
  OLD_INSTALL="/Applications/Cursor Watch.app"
  if [ -d "$OLD_INSTALL" ]; then
    rm -rf "$OLD_INSTALL"
    if [ -x "$LSREG" ]; then
      "$LSREG" -u "$OLD_INSTALL" 2>/dev/null || true
    fi
    echo "Removed old: $OLD_INSTALL"
  fi
  rm -rf "$INSTALL_TO"
  ditto "$APP" "$INSTALL_TO"
  xattr -cr "$INSTALL_TO" 2>/dev/null || true
  if [ -f "$KEYCHAIN" ]; then
    security unlock-keychain -p "${CURSOR_WATCH_CODESIGN_KEYCHAIN_PASS:-cursor-watch-local-codesign}" "$KEYCHAIN" >/dev/null 2>&1 || true
    codesign --force --deep --sign "$SIGN_IDENTITY" --keychain "$KEYCHAIN" "$INSTALL_TO" 2>&1 | tail -8
  else
    codesign --force --deep --sign "$SIGN_IDENTITY" "$INSTALL_TO" 2>&1 | tail -8
  fi
  echo "Installed: $INSTALL_TO"
  echo "Tip: after the first Allow round, later package:app:install keeps TCC if this identity stays the same."
  echo "Optional: System Settings → Privacy & Security → Full Disk Access → enable Cursors Watch (one-time)."

  # Drop local dist copy so Open/Spotlight only see /Applications
  rm -rf "$APP"

  if [ -x "$LSREG" ]; then
    "$LSREG" -u "$APP" 2>/dev/null || true
    "$LSREG" -u "$ROOT/vendor/mac/terminal-notifier.app" 2>/dev/null || true
    # Rebuild user Launch Services domain so stale duplicates disappear
    "$LSREG" -kill -r -domain user 2>/dev/null || true
    "$LSREG" -f "$INSTALL_TO" 2>/dev/null || true
  fi
fi
