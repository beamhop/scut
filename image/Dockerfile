# scut agent image: one image for every host (smolvm locally, a container or Firecracker VM in the cloud).
ARG REGISTRY=mirror.gcr.io/
# CI passes REGISTRY= to pull from Docker Hub directly.
FROM ${REGISTRY}library/node:22-bookworm-slim AS node
FROM ${REGISTRY}oven/bun:1-debian AS bun

FROM ${REGISTRY}library/debian:bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/beamhop/scut" org.opencontainers.image.description="Beamhop agent: a sandboxed Linux desktop + agent harness"
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb x11-utils openbox xdotool ffmpeg chromium \
      fonts-liberation fonts-noto-color-emoji fonts-dejavu-core \
      ca-certificates curl tar gzip procps tini libnss3-tools \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

# Agent harnesses. Pi is the default; Codex CLI, Copilot CLI and opencode are optional per agent.
ARG HARNESSES="@earendil-works/pi-coding-agent @openai/codex @github/copilot opencode-ai"
ENV BUN_INSTALL_GLOBAL_DIR=/opt/harness BUN_INSTALL_BIN=/usr/local/bin
# Optional build secret "ca" lets builds behind a TLS-intercepting proxy reach npm.
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    bun add -g $HARNESSES || bun add -g @earendil-works/pi-coding-agent

WORKDIR /opt/scut
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps ./apps
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    bun install --production --frozen-lockfile || bun install --production
COPY packages/ui/dist /opt/scut/ui

ENV SCUT_DATA=/data PORT=8080 SCUT_UI_DIR=/opt/scut/ui SCUT_BROWSER=chromium \
    SCUT_MCP_CMD="bun /opt/scut/packages/agent/src/mcp-computer.ts"
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "/opt/scut/packages/agentd/src/main.ts"]
