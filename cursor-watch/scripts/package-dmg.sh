#!/usr/bin/env bash
# Build Cursors Watch.app then pack a drag-to-Applications .dmg
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/macos/CursorWatch/dist"
APP="$DIST/Cursors Watch.app"
VERSION="$(node -p "require('$ROOT/package.json').version" 2>/dev/null || echo 0.1.0)"
DMG_NAME="Cursors-Watch-${VERSION}.dmg"
DMG="$DIST/$DMG_NAME"

bash "$ROOT/scripts/package-app.sh"

if [ ! -d "$APP" ]; then
  echo "error: missing app at $APP" >&2
  exit 1
fi

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/cursors-watch-dmg.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

ditto "$APP" "$STAGE/Cursors Watch.app"
ln -s /Applications "$STAGE/Applications"

rm -f "$DMG"
hdiutil create \
  -volname "Cursors Watch" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDZO \
  "$DMG"

# Ad-hoc sign the dmg (optional; Gatekeeper may still warn for unsigned)
codesign --force --sign - "$DMG" 2>/dev/null || true

echo "DMG: $DMG"
ls -lh "$DMG"
