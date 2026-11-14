#!/usr/bin/env bun
// scut — Beamhop desktop app + CLI (cli.ts). The same binary also runs an agent directly on this computer, for
// agents without a sandbox (packages/drivers/src/host.ts):
//   scut agentd          the agent daemon (what a sandbox runs as PID 1)
//   scut mcp-computer    the computer-use MCP server its harness talks to
const sub = Bun.argv[2];
if (sub === "agentd") await import("../../../packages/agentd/src/main.ts");
else if (sub === "mcp-computer") await import("../../../packages/agent/src/mcp-computer.ts");
else await import("./cli.ts");
export {};
