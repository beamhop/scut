#!/usr/bin/env bash
# Build the single-file desktop app for every OS/arch (UI embedded).
set -euo pipefail
cd "$(dirname "$0")/.."
bun run --cwd packages/ui build
bun scripts/embed-ui.ts
mkdir -p dist
trap "rm -f packages/drivers/src/engine-blob.ts" EXIT
for t in ${TARGETS:-bun-linux-x64 bun-linux-arm64 bun-darwin-arm64 bun-darwin-x64 bun-windows-x64}; do
  ext=""; [[ $t == *windows* ]] && ext=".exe"
  bun scripts/embed-engine.ts "$t" # the microVM engine rides inside the binary: nothing to install
  bun build apps/app/src/main.ts --compile --minify --target="$t" --outfile "dist/scut-${t#bun-}$ext"
done
ls -la dist
