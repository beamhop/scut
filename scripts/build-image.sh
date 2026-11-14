#!/usr/bin/env bash
# Build the agent image. Pass a CA bundle via SCUT_BUILD_CA when building behind a TLS-intercepting proxy.
set -euo pipefail
cd "$(dirname "$0")/.."
bun run --cwd packages/ui build
TAG="${1:-ghcr.io/beamhop/scut-agent:dev}"
SECRET=()
if [ -n "${SCUT_BUILD_CA:-}" ]; then SECRET=(--secret "id=ca,src=$SCUT_BUILD_CA"); fi
DOCKER_BUILDKIT=1 docker build "${SECRET[@]}" -f image/Dockerfile -t "$TAG" .
