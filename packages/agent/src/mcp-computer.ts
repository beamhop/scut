#!/usr/bin/env bun
// Computer-use MCP server (stdio). Every harness (Pi, Codex, Copilot CLI, opencode) gets the same tools.
// It forwards to agentd's local control API, which applies the agent's autonomy policy (approvals).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = process.env.SCUT_CONTROL_URL ?? "http://127.0.0.1:8080";
const TOKEN = process.env.SCUT_INTERNAL_TOKEN ?? "";

async function call(action: Record<string, unknown>) {
  const r = await fetch(`${BASE}/internal/computer`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-token": TOKEN },
    body: JSON.stringify(action),
  });
  if (!r.ok) throw new Error(`${action.kind} failed: ${r.status} ${await r.text()}`);
  return r;
}

async function shot() {
  const r = await call({ kind: "screenshot", format: "png" });
  const png = Buffer.from(await r.arrayBuffer()).toString("base64");
  return { content: [{ type: "image" as const, data: png, mimeType: "image/png" }] };
}

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });

const server = new McpServer({ name: "computer", version: "0.1.0" });
const xy = { x: z.number().describe("x in pixels (0-1279)"), y: z.number().describe("y in pixels (0-799)") };

server.tool("screenshot", "Take a screenshot of your 1280x800 screen", {}, async () => shot());
server.tool("click", "Click at a screen position", { ...xy, button: z.enum(["left", "right", "middle"]).optional() }, async (a) => {
  await call({ kind: "click", x: a.x, y: a.y, button: a.button === "right" ? 3 : a.button === "middle" ? 2 : 1 });
  return ok(`clicked ${a.x},${a.y}`);
});
server.tool("double_click", "Double-click at a screen position", xy, async (a) => {
  await call({ kind: "dblclick", x: a.x, y: a.y });
  return ok(`double-clicked ${a.x},${a.y}`);
});
server.tool("type_text", "Type text at the focused element", { text: z.string() }, async (a) => {
  await call({ kind: "type", text: a.text });
  return ok("typed");
});
server.tool("key", "Press keys, xdotool syntax, e.g. 'Return', 'ctrl+l', 'ctrl+shift+t'", { keys: z.string() }, async (a) => {
  await call({ kind: "key", keys: a.keys });
  return ok(`pressed ${a.keys}`);
});
server.tool("scroll", "Scroll at a position; positive dy scrolls down", { ...xy, dy: z.number() }, async (a) => {
  await call({ kind: "scroll", x: a.x, y: a.y, dy: a.dy });
  return ok("scrolled");
});
server.tool("open_url", "Open a URL in your Chromium browser", { url: z.string() }, async (a) => {
  await call({ kind: "open_url", url: a.url });
  return ok(`opened ${a.url}`);
});
server.tool(
  "request_approval",
  "Ask your owner to approve a risky action (payment, new contact, delete, credentials). Blocks until answered.",
  { title: z.string(), detail: z.string().optional() },
  async (a) => {
    const r = await call({ kind: "approval", title: a.title, detail: a.detail });
    const { ok: approved } = (await r.json()) as { ok: boolean };
    return ok(approved ? "approved" : "denied — do not do it");
  },
);

server.tool("remember", "Save a durable fact to your long-term memory (preferences, names, decisions). Keep it short.", { text: z.string() }, async (a) => {
  await call({ kind: "remember", text: a.text });
  return ok("remembered");
});
server.tool("forget", "Remove a memory by id (see list_memories)", { id: z.string() }, async (a) => {
  await call({ kind: "forget", id: a.id });
  return ok("forgotten");
});
server.tool("list_memories", "List everything in your long-term memory with ids", {}, async () => {
  const r = await call({ kind: "memories" });
  return ok(JSON.stringify(await r.json()));
});
server.tool("crew_post", "Post a message to your crew room (your owner and the other agents). Mention an agent by name to ask it something.", { text: z.string() }, async (a) => {
  const r = await call({ kind: "crew_post", text: a.text });
  const { ok: posted } = (await r.json()) as { ok: boolean };
  return ok(posted ? "posted to the crew room" : "no crew room configured");
});
server.tool("crew_list", "List the members of your crew room", {}, async () => {
  const r = await call({ kind: "crew_list" });
  return ok(JSON.stringify(await r.json()));
});

await server.connect(new StdioServerTransport());
