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

// Any tool can block on the owner's approval (autonomy policy), and people take minutes to answer, while MCP clients
// give up on a request after a minute or so. While a tool runs, send progress every 15 s: clients that support it
// (Pi does) restart their timeout on each one.
const registerTool = server.tool.bind(server) as (...a: any[]) => any;
(server as any).tool = (...a: any[]) => {
  const handler = a[a.length - 1];
  a[a.length - 1] = async (...args: any[]) => {
    const extra = args[args.length - 1];
    const token = extra?._meta?.progressToken;
    let n = 0;
    const beat = token === undefined ? undefined : setInterval(() => {
      extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: ++n, message: "still working (maybe waiting for your owner)" } }).catch(() => {});
    }, 15_000);
    try {
      return await handler(...args);
    } finally {
      if (beat) clearInterval(beat);
    }
  };
  return registerTool(...a);
};
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
  "Ask your owner to approve a risky action (payment, message to a new contact, delete, login/credentials, an unfamiliar site). Blocks until answered. Give a short verb-first title and put the exact payload (message text, amount and merchant, URL, files) in detail.",
  {
    title: z.string().describe('verb-first, plain words, e.g. "Pay the €42 invoice from ACME" or "Send an email to jan@example.nl"'),
    detail: z.string().optional().describe("the exact payload: message text, amount + merchant, URL, item names"),
    kind: z.enum(["payment", "message", "login", "delete", "open", "other"]).optional().describe("what sort of action this is"),
  },
  async (a) => {
    const r = await call({ kind: "approval", title: a.title, detail: a.detail, approval_kind: a.kind });
    const { ok: approved, by } = (await r.json()) as { ok: boolean; by?: string };
    if (approved) return ok("approved");
    return ok(by === "timeout" ? "no answer from your owner in time — do not do it; skip this step and tell them you skipped it" : "denied — do not do it");
  },
);

server.tool(
  "schedule_task",
  "Set up a task you will run on your own on a schedule, e.g. 'every morning at 8 send the top 3 Hacker News stories'. Give daily_at as HH:MM in your owner's local time, or every_minutes (5 or more). Results go to your owner's chat apps.",
  { prompt: z.string().describe("what to do each time, as an instruction to yourself"), daily_at: z.string().optional(), every_minutes: z.number().optional() },
  async (a) => {
    const r = await call({ kind: "schedule_task", ...a });
    const j = (await r.json()) as { id: string; timeZone: string };
    return ok(`scheduled (id ${j.id}, time zone ${j.timeZone}); your owner can see and change it in Settings`);
  },
);
server.tool("list_tasks", "List your scheduled tasks", {}, async () => ok(JSON.stringify((await (await call({ kind: "list_tasks" })).json()) as object)));
server.tool("cancel_task", "Cancel one of your scheduled tasks by id (see list_tasks)", { id: z.string() }, async (a) => {
  const j = (await (await call({ kind: "cancel_task", id: a.id })).json()) as { ok: boolean };
  return ok(j.ok ? "cancelled" : "no task with that id");
});
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
server.tool(
  "connect_channel",
  "Connect yourself to a chat app once you have its bot token(s): telegram (token from @BotFather), discord (bot token), or slack (appToken xapp-… and botToken xoxb-…).",
  { channel: z.enum(["telegram", "discord", "slack"]), token: z.string().optional(), appToken: z.string().optional(), botToken: z.string().optional() },
  async (a) => {
    const r = await call({ kind: "connect_channel", ...a });
    return ok(JSON.stringify(await r.json()));
  },
);
server.tool(
  "give_cloud_key",
  "Hand a cloud provider API key you created during an assisted signup (fly, render or railway) to your owner's Beamhop app. Never paste keys into chat.",
  { provider: z.enum(["fly", "render", "railway"]), token: z.string() },
  async (a) => {
    const r = await call({ kind: "cloud_key", ...a });
    const j = (await r.json()) as { delivered: boolean };
    return ok(j.delivered ? "delivered to the owner's app" : "the owner's app isn't open right now; ask them to open it, then try again");
  },
);
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
