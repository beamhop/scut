#!/usr/bin/env bash
# Build the single-file desktop app for every OS/arch (UI embedded), packaged so opening it shows the app's window
# and no terminal: a Beamhop.app bundle on macOS, a console-less .exe on Windows. Both carry the app icon
# (image/icon, made by scripts/make-icons.sh). The bare binaries stay for the CLI.
set -euo pipefail
cd "$(dirname "$0")/.."
bun run --cwd packages/ui build
bun scripts/embed-ui.ts
mkdir -p dist
trap "rm -f packages/drivers/src/engine-blob.ts" EXIT
# Bun sets Windows executable options (no console, icon, name) only when compiling on Windows: CI builds the
# Windows app there. Elsewhere only the plain CLI .exe is made.
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ON_WINDOWS=1 ;; *) ON_WINDOWS=0 ;; esac
VERSION="$(bun -e 'console.log(require("./package.json").version)')"
for t in ${TARGETS:-bun-linux-x64 bun-linux-arm64 bun-darwin-arm64 bun-darwin-x64 bun-windows-x64}; do
  ext=""; [[ $t == *windows* ]] && ext=".exe"
  bun scripts/embed-engine.ts "$t" # the microVM engine rides inside the binary: nothing to install
  icon=(); [[ $t == *windows* && $ON_WINDOWS == 1 ]] && icon=(--windows-icon=image/icon/beamhop.ico)
  bun build apps/app/src/main.ts --compile --minify --target="$t" ${icon[@]+"${icon[@]}"} --outfile "dist/scut-${t#bun-}$ext"
  if [[ $t == *windows* && $ON_WINDOWS == 0 ]]; then echo "skipping Beamhop-${t#bun-}.exe: build it on Windows (CI does)"; fi
  if [[ $t == *windows* && $ON_WINDOWS == 1 ]]; then
    # Double-clicked on Windows: no Command Prompt next to the app's window.
    bun build apps/app/src/main.ts --compile --minify --target="$t" --windows-hide-console --windows-icon=image/icon/beamhop.ico \
      --windows-title=Beamhop --windows-description=Beamhop --windows-version="$VERSION.0" --outfile "dist/Beamhop-${t#bun-}.exe"
  fi
  if [[ $t == *darwin* ]]; then
    ./scripts/mac-bundle.sh "dist/scut-${t#bun-}" "dist/Beamhop-${t#bun-}.app" "$VERSION"
    # A zip keeps the bundle's executable bit through downloads and CI artifacts.
    (cd dist && rm -f "Beamhop-${t#bun-}.app.zip" && zip -qry "Beamhop-${t#bun-}.app.zip" "Beamhop-${t#bun-}.app")
  fi
done
ls -la dist
