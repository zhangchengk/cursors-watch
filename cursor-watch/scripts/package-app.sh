#!/usr/bin/env bash
# Build informal Cursor Watch.app and optionally install to /Applications.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MACOS_DIR="$ROOT/macos/CursorWatch"
SRC="$MACOS_DIR/Sources/main.swift"
DIST="$MACOS_DIR/dist"
APP="$DIST/Cursor Watch.app"
BIN_DIR="$APP/Contents/MacOS"
RES_DIR="$APP/Contents/Resources"
INSTALL_TO="${INSTALL_TO:-/Applications/Cursor Watch.app}"
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
  <string>Cursor Watch</string>
  <key>CFBundleIdentifier</key>
  <string>com.cursor-watch.app</string>
  <key>CFBundleName</key>
  <string>Cursor Watch</string>
  <key>CFBundleDisplayName</key>
  <string>Cursor Watch</string>
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
  <string>Cursor Watch needs notifications for Reminder delivery.</string>
</dict>
</plist>
PLIST
echo -n 'APPL????' > "$APP/Contents/PkgInfo"
mv "$TMP_BIN" "$BIN_DIR/Cursor Watch"
chmod +x "$BIN_DIR/Cursor Watch"

# Bundle cursor-watch package (dev copy; node binary optional)
rsync -a --delete \
  --exclude node_modules \
  --exclude macos/CursorWatch/dist \
  --exclude '.git' \
  "$ROOT/" "$RES_DIR/cursor-watch/"
# Keep node_modules for tsx/runtime deps
if [ -d "$ROOT/node_modules" ]; then
  rsync -a "$ROOT/node_modules/" "$RES_DIR/cursor-watch/node_modules/"
fi
# Prefer system node via PATH when not embedding; copy real binary if available
NODE_BIN="$(node -p 'process.execPath' 2>/dev/null || true)"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "error: Node.js >= 20 required to embed runtime into Cursor Watch.app" >&2
  exit 1
fi
rm -f "$RES_DIR/node"
cp -f "$NODE_BIN" "$RES_DIR/node"
chmod +x "$RES_DIR/node"

xattr -cr "$APP" 2>/dev/null || true
# Drop previous signature so re-sign succeeds after resource refresh
codesign --remove-signature "$APP" 2>/dev/null || true
codesign --force --deep --sign - "$APP" 2>&1 | tail -5

echo "Built: $APP"

if [ "$DO_INSTALL" = "install" ]; then
  rm -rf "$INSTALL_TO"
  ditto "$APP" "$INSTALL_TO"
  xattr -cr "$INSTALL_TO" 2>/dev/null || true
  codesign --force --deep --sign - "$INSTALL_TO" 2>&1 | tail -5
  echo "Installed: $INSTALL_TO"
fi
