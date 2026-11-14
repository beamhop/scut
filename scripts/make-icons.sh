#!/usr/bin/env bash
# Render image/icon/beamhop.svg into the app icons the build embeds: beamhop.icns (macOS) and beamhop.ico (Windows).
# Needs a Mac (iconutil, sips) with Chrome. The outputs are committed, so builds elsewhere don't need this.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$chrome" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 --window-size=1024,1024 \
  --user-data-dir="$tmp/chrome" --screenshot="$tmp/1024.png" "file://$PWD/image/icon/beamhop.svg" 2>/dev/null
set_="$tmp/beamhop.iconset"; mkdir "$set_"
for s in 16 32 128 256 512; do
  sips -z $s $s "$tmp/1024.png" --out "$set_/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$tmp/1024.png" --out "$set_/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$set_" -o image/icon/beamhop.icns
for s in 16 24 32 48 64 256; do sips -z $s $s "$tmp/1024.png" --out "$tmp/ico-$s.png" >/dev/null; done
bun scripts/png-to-ico.ts image/icon/beamhop.ico "$tmp"/ico-{16,24,32,48,64,256}.png
cp "$tmp/1024.png" image/icon/beamhop-1024.png
ls -la image/icon
