// Mock Slack (Web API + Socket Mode) and Discord (REST + Gateway) for tests. Containers reach them via host.docker.internal.
import type { ServerWebSocket } from "bun";

export function startMockSlack() {
  const posts: any[] = [];
  const updates: any[] = [];
  const sockets = new Set<ServerWebSocket<unknown>>();
  let env = 0;
  const server: ReturnType<typeof Bun.serve> = Bun.serve({
    port: 0,
    hostname: "0.0.0.0",
    async fetch(req, srv): Promise<Response | undefined> {
      const path = new URL(req.url).pathname;
      if (path === "/ws") return srv.upgrade(req, { data: undefined }) ? undefined : new Response("no", { status: 400 });
      const method = path.split("/").pop();
      const body = (await req.json().catch(() => ({}))) as any;
      if (method === "auth.test") return Response.json({ ok: true, user: "mock_slack", user_id: "UBOT" });
      if (method === "apps.connections.open") return Response.json({ ok: true, url: `ws://host.docker.internal:${server.port}/ws` });
      if (method === "chat.postMessage") {
        posts.push(body);
        return Response.json({ ok: true, channel: body.channel, ts: String(posts.length) });
      }
      if (method === "chat.update") {
        updates.push(body);
        return Response.json({ ok: true, channel: body.channel, ts: body.ts });
      }
      return Response.json({ ok: false, error: "unknown_method" });
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
        ws.send(JSON.stringify({ type: "hello" }));
      },
      message() {},
      close(ws) {
        sockets.delete(ws);
      },
    },
  });
  const push = (m: any) => {
    for (const s of sockets) s.send(JSON.stringify({ envelope_id: `e${++env}`, ...m }));
  };
  return {
    server,
    posts,
    updates,
    connected: () => sockets.size,
    /** Kill every socket from the server side, as a network drop during laptop sleep would. */
    dropAll: () => { for (const s of [...sockets]) s.close(1006 as any); },
    dm: (user: string, text: string, channel = `D${user}`) => push({ type: "events_api", payload: { event: { type: "message", channel_type: "im", user, text, channel } } }),
    channelMessage: (user: string, text: string, channel = "CGEN") => push({ type: "events_api", payload: { event: { type: "message", channel_type: "channel", user, text, channel } } }),
    mention: (user: string, text: string, channel = "CGEN") => push({ type: "events_api", payload: { event: { type: "app_mention", user, text: `<@UBOT> ${text}`, channel } } }),
    click: (user: string, value: string) => push({ type: "interactive", payload: { user: { id: user }, actions: [{ value }] } }),
  };
}

export function startMockDiscord() {
  const posts: { channel: string; body: any }[] = [];
  const edits: { channel: string; id: string; body: any }[] = [];
  const callbacks: string[] = [];
  const sockets = new Set<ServerWebSocket<unknown>>();
  let seq = 1;
  const server: ReturnType<typeof Bun.serve> = Bun.serve({
    port: 0,
    hostname: "0.0.0.0",
    async fetch(req, srv): Promise<Response | undefined> {
      const path = new URL(req.url).pathname;
      if (path === "/gw") return srv.upgrade(req, { data: undefined }) ? undefined : new Response("no", { status: 400 });
      if (path.endsWith("/users/@me")) return Response.json({ id: "BOT1", username: "mock_discord" });
      if (path.endsWith("/gateway/bot")) return Response.json({ url: `ws://host.docker.internal:${server.port}/gw` });
      const m = path.match(/\/channels\/([^/]+)\/messages$/);
      if (m && req.method === "POST") {
        posts.push({ channel: m[1], body: await req.json() });
        return Response.json({ id: String(posts.length) });
      }
      const e = path.match(/\/channels\/([^/]+)\/messages\/([^/]+)$/);
      if (e && req.method === "PATCH") {
        edits.push({ channel: e[1], id: e[2], body: await req.json() });
        return Response.json({ id: e[2] });
      }
      if (path.includes("/interactions/")) {
        callbacks.push(path);
        return new Response(null, { status: 204 });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
        ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 30000 } }));
      },
      message(ws, raw) {
        const p = JSON.parse(String(raw));
        if (p.op === 2) ws.send(JSON.stringify({ op: 0, s: seq++, t: "READY", d: { user: { id: "BOT1", username: "mock_discord" } } }));
      },
      close(ws) {
        sockets.delete(ws);
      },
    },
  });
  const dispatch = (t: string, d: any) => {
    for (const s of sockets) s.send(JSON.stringify({ op: 0, s: seq++, t, d }));
  };
  return {
    server,
    posts,
    edits,
    callbacks,
    connected: () => sockets.size,
    dm: (userId: string, text: string) => dispatch("MESSAGE_CREATE", { channel_id: `DM${userId}`, content: text, author: { id: userId, username: `u${userId}` }, mentions: [] }),
    guildMessage: (userId: string, text: string, mention = false) =>
      dispatch("MESSAGE_CREATE", { guild_id: "G1", channel_id: "CH1", content: mention ? `<@BOT1> ${text}` : text, author: { id: userId, username: `u${userId}` }, mentions: mention ? [{ id: "BOT1" }] : [] }),
    click: (userId: string, customId: string) => dispatch("INTERACTION_CREATE", { id: `i${seq}`, token: "tok", type: 3, data: { custom_id: customId }, member: { user: { id: userId } } }),
  };
}
