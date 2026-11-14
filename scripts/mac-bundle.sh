#!/usr/bin/env bash
# Wrap the compiled binary in a macOS app bundle. Finder opens a bare executable in Terminal; an .app opens without
# one. The app has no window of its own (its window is a browser in app mode), so it stays out of the Dock
# (LSUIElement): opening it again just brings the window back.
# Usage: scripts/mac-bundle.sh <binary> <out.app> <version>
set -euo pipefail
bin="$1"; app="$2"; version="$3"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin" "$app/Contents/MacOS/Beamhop"
chmod +x "$app/Contents/MacOS/Beamhop"
cp "$(dirname "$0")/../image/icon/beamhop.icns" "$app/Contents/Resources/Beamhop.icns"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Beamhop</string>
  <key>CFBundleDisplayName</key><string>Beamhop</string>
  <key>CFBundleIdentifier</key><string>dev.beamhop.app</string>
  <key>CFBundleExecutable</key><string>Beamhop</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>Beamhop</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
# Ad-hoc sign the bundle on a Mac (Apple Silicon refuses unsigned code); elsewhere the binary keeps its own signature.
if command -v codesign >/dev/null; then codesign --force --sign - "$app" >/dev/null 2>&1 || true; fi
