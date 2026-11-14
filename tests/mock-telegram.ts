// Minimal Telegram Bot API stand-in: queue updates, record outgoing messages.
export function startMockTelegram() {
  const queue: any[] = [];
  const sent: any[] = [];
  const edited: any[] = [];
  let updateId = 1;
  const server = Bun.serve({
    port: 0,
    hostname: "0.0.0.0",
    async fetch(req) {
      const method = new URL(req.url).pathname.split("/").pop();
      if (new URL(req.url).pathname.includes("BAD")) return Response.json({ ok: false, error_code: 401, description: "Unauthorized" }, { status: 401 });
      const body = (await req.json().catch(() => ({}))) as any;
      if (method === "getMe") return Response.json({ ok: true, result: { id: 1, username: "mock_bot" } });
      if (method === "getUpdates") {
        const t0 = Date.now();
        while (!queue.length && Date.now() - t0 < 2000) await Bun.sleep(50);
        const out = queue.splice(0).filter((u) => u.update_id >= (body.offset ?? 0));
        return Response.json({ ok: true, result: out });
      }
      if (method === "sendMessage") {
        sent.push(body);
        return Response.json({ ok: true, result: { message_id: sent.length } });
      }
      if (method === "editMessageText") {
        edited.push(body);
        return Response.json({ ok: true, result: { message_id: body.message_id } });
      }
      return Response.json({ ok: true, result: true });
    },
  });
  return {
    server,
    sent,
    edited,
    port: server.port,
    message(fromId: number, text: string, chatId = fromId) {
      queue.push({ update_id: updateId++, message: { text, chat: { id: chatId }, from: { id: fromId, username: `user${fromId}` } } });
    },
    callback(fromId: number, data: string) {
      queue.push({ update_id: updateId++, callback_query: { id: String(updateId), data, from: { id: fromId, username: `user${fromId}` } } });
    },
    async waitSent(pred: (m: any) => boolean, ms = 30_000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const m = sent.find(pred);
        if (m) return m;
        await Bun.sleep(100);
      }
      throw new Error(`no matching sendMessage; sent: ${JSON.stringify(sent.slice(-4))}`);
    },
  };
}
