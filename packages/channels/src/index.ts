// Chat channels. All connections are outbound (long polling / websockets), so an agent can run behind NAT.
// A channel only runs while this host holds the agent's lease, so two hosts never share a bot token.

export interface IncomingMessage {
  channel: string; // "telegram"
  chatId: string;
  from: string;
  fromId: string;
  text: string;
}

export interface Channel {
  name: string;
  start(onMessage: (m: IncomingMessage) => void, onApproval: (id: string, ok: boolean, byId: string) => void): void;
  stop(): Promise<void>;
  send(chatId: string, text: string): Promise<void>;
  askApproval(chatId: string, id: string, title: string): Promise<void>;
}

export class TelegramChannel implements Channel {
  name = "telegram";
  private running = false;
  private offset = 0;
  private abort?: AbortController;
  private loop?: Promise<void>;

  constructor(private token: string, private api = process.env.SCUT_TELEGRAM_API ?? "https://api.telegram.org") {}

  private async call(method: string, body: unknown, signal?: AbortSignal) {
    const r = await fetch(`${this.api}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const j = (await r.json()) as { ok: boolean; result?: any; description?: string };
    if (!j.ok) throw new Error(`telegram ${method}: ${j.description}`);
    return j.result;
  }

  async botName(): Promise<string | undefined> {
    return (await this.call("getMe", {}).catch(() => null))?.username;
  }

  start(onMessage: (m: IncomingMessage) => void, onApproval: (id: string, ok: boolean, byId: string) => void) {
    if (this.running) return;
    this.running = true;
    this.loop = (async () => {
      // Make sure no webhook is set, so long polling works without a public URL.
      await this.call("deleteWebhook", {}).catch(() => {});
      while (this.running) {
        this.abort = new AbortController();
        try {
          const updates: any[] = await this.call(
            "getUpdates",
            { offset: this.offset, timeout: 25, allowed_updates: ["message", "callback_query"] },
            this.abort.signal,
          );
          for (const u of updates) {
            this.offset = u.update_id + 1;
            if (u.message?.text) {
              onMessage({
                channel: "telegram",
                chatId: String(u.message.chat.id),
                from: u.message.from?.username ?? String(u.message.from?.id),
                fromId: String(u.message.from?.id),
                text: u.message.text,
              });
            } else if (u.callback_query?.data?.startsWith("ap:")) {
              const [, id, verdict] = u.callback_query.data.split(":");
              onApproval(id, verdict === "y", String(u.callback_query.from?.id));
              await this.call("answerCallbackQuery", { callback_query_id: u.callback_query.id }).catch(() => {});
            }
          }
        } catch (e) {
          if (!this.running) break;
          await Bun.sleep(2000); // 409 conflict or network error: back off
        }
      }
    })();
  }

  async stop() {
    this.running = false;
    this.abort?.abort();
    await this.loop?.catch(() => {});
  }

  async send(chatId: string, text: string) {
    await this.call("sendMessage", { chat_id: chatId, text: text.slice(0, 4000) });
  }

  async askApproval(chatId: string, id: string, title: string) {
    await this.call("sendMessage", {
      chat_id: chatId,
      text: `Approval needed: ${title}`,
      reply_markup: { inline_keyboard: [[{ text: "Approve", callback_data: `ap:${id}:y` }, { text: "Deny", callback_data: `ap:${id}:n` }]] },
    });
  }
}

// ---------------- Nostr (NIP-17 private DMs) ----------------
import { SimplePool, finalizeEvent, getPublicKey, nip17, type Event } from "nostr-tools";

export const DEFAULT_RELAYS = ["wss://relay.primal.net", "wss://relay.damus.io", "wss://nos.lol"];

/**
 * Private DMs over Nostr (NIP-17 gift wraps). The agent's own key is its identity; replies go back to the sender.
 * Approvals are asked by DM to the owner, who answers "yes <id>" or "no <id>".
 * `cursorFile` keeps the newest processed message time so restarts and beams don't replay old messages.
 */
export class NostrChannel implements Channel {
  name = "nostr";
  private pool = new SimplePool();
  private sub?: { close: () => void };
  private seen = new Set<string>();
  private pub: string;

  constructor(
    private sk: Uint8Array,
    private relays: string[] = DEFAULT_RELAYS,
    private cursorFile?: string,
    private profile?: { name: string; about?: string; picture?: string },
  ) {
    this.pub = getPublicKey(sk);
  }

  private async cursor(): Promise<number> {
    if (!this.cursorFile) return Math.floor(Date.now() / 1000) - 60;
    const f = Bun.file(this.cursorFile);
    return (await f.exists()) ? Number(await f.text()) : Math.floor(Date.now() / 1000) - 60;
  }

  start(onMessage: (m: IncomingMessage) => void, onApproval: (id: string, ok: boolean, byId: string) => void) {
    (async () => {
      let since = await this.cursor();
      if (this.profile) {
        const ev = finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(this.profile) }, this.sk);
        await this.publish(ev, 2).catch(() => {});
      }
      // Gift wraps carry a randomised created_at (up to ~2 days back), so subscribe wide and filter on the rumor's time.
      this.sub = this.pool.subscribeMany(this.relays, { kinds: [1059], "#p": [this.pub], since: since - 3 * 86400 }, {
        onevent: async (wrap: Event) => {
          if (this.seen.has(wrap.id)) return;
          this.seen.add(wrap.id);
          let rumor: any;
          try {
            rumor = nip17.unwrapEvent(wrap, this.sk);
          } catch {
            return;
          }
          // "<" not "<=": several messages can share a second. Rumor ids dedupe the same message seen on several relays.
          if (rumor.kind !== 14 || rumor.pubkey === this.pub || rumor.created_at < since || this.seen.has(`r:${rumor.id}`)) return;
          this.seen.add(`r:${rumor.id}`);
          since = Math.max(since, rumor.created_at);
          if (this.cursorFile) await Bun.write(this.cursorFile, String(since));
          const text = String(rumor.content).trim();
          const ps = (rumor.tags as string[][]).filter((t) => t[0] === "p").map((t) => t[1]);
          const isCrew = (rumor.tags as string[][]).some((t) => t[0] === "subject" && t[1] === CREW_SUBJECT) || ps.length > 1;
          if (isCrew) {
            this.onCrew?.({ from: rumor.pubkey, text, ts: rumor.created_at * 1000 });
            return;
          }
          const ap = text.match(/^(yes|no|approve|deny)\s+([0-9a-f]{6,})$/i);
          if (ap) return onApproval(ap[2], /^(yes|approve)$/i.test(ap[1]), rumor.pubkey);
          onMessage({ channel: "nostr", chatId: rumor.pubkey, from: rumor.pubkey.slice(0, 8), fromId: rumor.pubkey, text });
        },
      });
    })();
  }

  async stop() {
    this.sub?.close();
    this.pool.close(this.relays);
  }

  /** Publish to all relays; succeed if any relay accepts. Retries with backoff (relays rate-limit bursts). */
  private async publish(ev: Event, tries = 4) {
    let last: unknown;
    for (let i = 0; i < tries; i++) {
      try {
        await Promise.any(this.pool.publish(this.relays, ev, { maxWait: 6000 } as any));
        return;
      } catch (e) {
        last = e;
        await Bun.sleep(800 * (i + 1) + Math.random() * 400);
      }
    }
    throw new Error(`nostr publish failed on all relays: ${String((last as any)?.errors?.map?.((x: any) => x?.message ?? x) ?? last)}`);
  }

  async send(to: string, text: string) {
    await this.publish(nip17.wrapEvent(this.sk, { publicKey: to }, text));
  }

  async askApproval(to: string, id: string, title: string) {
    await this.send(to, `Approval needed: ${title}\nReply "yes ${id}" or "no ${id}".`);
  }

  /** Crew room: a private NIP-17 group conversation between the owner and all their agents. */
  onCrew?: (m: { from: string; text: string; ts: number }) => void;
  async sendCrew(members: string[], text: string) {
    const others = members.filter((p) => p !== this.pub);
    const wraps = nip17.wrapManyEvents(this.sk, others.map((publicKey) => ({ publicKey })), text, CREW_SUBJECT);
    const failures: string[] = [];
    for (const w of wraps) await this.publish(w).catch((e) => failures.push(String(e?.message ?? e)));
    if (failures.length === wraps.length) throw new Error(failures[0]);
  }
}

export const CREW_SUBJECT = "Beamhop crew";

// ---------------- Slack (Socket Mode: outbound WebSocket, no public URL) ----------------
/** Needs an app-level token (xapp-…, connections:write) and a bot token (xoxb-…, chat:write, app_mentions:read, im:history). */
export class SlackChannel implements Channel {
  name = "slack";
  private ws?: WebSocket;
  private running = false;
  private botUserId?: string;

  constructor(private appToken: string, private botToken: string, private api = process.env.SCUT_SLACK_API ?? "https://slack.com/api") {}

  private async call(method: string, token: string, body: unknown) {
    const r = await fetch(`${this.api}/${method}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    const j = (await r.json()) as any;
    if (!j.ok) throw new Error(`slack ${method}: ${j.error}`);
    return j;
  }

  async botName() {
    const j = await this.call("auth.test", this.botToken, {}).catch(() => null);
    this.botUserId = j?.user_id;
    return j?.user as string | undefined;
  }

  start(onMessage: (m: IncomingMessage) => void, onApproval: (id: string, ok: boolean, byId: string) => void) {
    this.running = true;
    const connect = async () => {
      if (!this.running) return;
      try {
        if (!this.botUserId) await this.botName();
        const { url } = await this.call("apps.connections.open", this.appToken, {});
        const ws = new WebSocket(url);
        this.ws = ws;
        ws.onmessage = (ev) => {
          const msg = JSON.parse(String(ev.data));
          if (msg.envelope_id) ws.send(JSON.stringify({ envelope_id: msg.envelope_id })); // ack within 3 s
          if (msg.type === "disconnect") return ws.close();
          if (msg.type === "events_api") {
            const e = msg.payload?.event;
            if (!e || e.bot_id || e.subtype || (this.botUserId && e.user === this.botUserId)) return;
            const isDm = e.channel_type === "im";
            if (e.type === "message" && !isDm) return; // in channels, only answer @mentions (app_mention events)
            const text = String(e.text ?? "").replace(/<@[A-Z0-9]+>\s*/g, "").trim();
            onMessage({ channel: "slack", chatId: e.channel, from: e.user, fromId: e.user, text });
          } else if (msg.type === "interactive") {
            const a = msg.payload?.actions?.[0];
            const [kind, id, verdict] = String(a?.value ?? "").split(":");
            if (kind === "ap") onApproval(id, verdict === "y", msg.payload?.user?.id);
          }
        };
        ws.onclose = () => this.running && setTimeout(connect, 2000);
        ws.onerror = () => ws.close();
      } catch {
        setTimeout(connect, 5000);
      }
    };
    connect();
  }

  async stop() {
    this.running = false;
    this.ws?.close();
  }

  async send(chatId: string, text: string) {
    await this.call("chat.postMessage", this.botToken, { channel: chatId, text: text.slice(0, 3900) });
  }

  async askApproval(chatId: string, id: string, title: string) {
    await this.call("chat.postMessage", this.botToken, {
      channel: chatId,
      text: `Approval needed: ${title}`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*Approval needed:* ${title}` } },
        {
          type: "actions",
          elements: [
            { type: "button", style: "primary", text: { type: "plain_text", text: "Approve" }, action_id: "approve", value: `ap:${id}:y` },
            { type: "button", style: "danger", text: { type: "plain_text", text: "Deny" }, action_id: "deny", value: `ap:${id}:n` },
          ],
        },
      ],
    });
  }
}

// ---------------- Discord (Gateway: outbound WebSocket) ----------------
/** Needs a bot token with the Message Content intent enabled. Answers DMs and @mentions. */
export class DiscordChannel implements Channel {
  name = "discord";
  private ws?: WebSocket;
  private running = false;
  private seq: number | null = null;
  private hb?: ReturnType<typeof setInterval>;
  private botUserId?: string;

  constructor(private token: string, private api = process.env.SCUT_DISCORD_API ?? "https://discord.com/api/v10") {}

  private async rest(method: string, path: string, body?: unknown) {
    const r = await fetch(`${this.api}${path}`, {
      method,
      headers: { authorization: `Bot ${this.token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`discord ${method} ${path}: ${r.status} ${await r.text()}`);
    const t = await r.text();
    return t ? JSON.parse(t) : {};
  }

  async botName() {
    const me = await this.rest("GET", "/users/@me").catch(() => null);
    this.botUserId = me?.id;
    return me?.username as string | undefined;
  }

  start(onMessage: (m: IncomingMessage) => void, onApproval: (id: string, ok: boolean, byId: string) => void) {
    this.running = true;
    const connect = async () => {
      if (!this.running) return;
      try {
        const { url } = await this.rest("GET", "/gateway/bot");
        const ws = new WebSocket(`${url}?v=10&encoding=json`);
        this.ws = ws;
        ws.onmessage = (ev) => {
          const p = JSON.parse(String(ev.data));
          if (p.s != null) this.seq = p.s;
          if (p.op === 10) {
            clearInterval(this.hb);
            this.hb = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ op: 1, d: this.seq })), p.d.heartbeat_interval);
            const intents = (1 << 9) | (1 << 12) | (1 << 15); // GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT
            ws.send(JSON.stringify({ op: 2, d: { token: this.token, intents, properties: { os: "linux", browser: "scut", device: "scut" } } }));
          } else if (p.op === 0 && p.t === "READY") {
            this.botUserId = p.d.user?.id;
          } else if (p.op === 0 && p.t === "MESSAGE_CREATE") {
            const d = p.d;
            if (d.author?.bot) return;
            const isDm = !d.guild_id;
            const mentioned = (d.mentions ?? []).some((u: any) => u.id === this.botUserId);
            if (!isDm && !mentioned) return;
            const text = String(d.content ?? "").replace(/<@!?\d+>\s*/g, "").trim();
            onMessage({ channel: "discord", chatId: d.channel_id, from: d.author.username, fromId: d.author.id, text });
          } else if (p.op === 0 && p.t === "INTERACTION_CREATE" && p.d.type === 3) {
            const [kind, id, verdict] = String(p.d.data?.custom_id ?? "").split(":");
            const user = p.d.member?.user?.id ?? p.d.user?.id;
            this.rest("POST", `/interactions/${p.d.id}/${p.d.token}/callback`, { type: 6 }).catch(() => {});
            if (kind === "ap") onApproval(id, verdict === "y", user);
          } else if (p.op === 7 || p.op === 9) {
            ws.close(); // reconnect / invalid session
          }
        };
        ws.onclose = () => {
          clearInterval(this.hb);
          if (this.running) setTimeout(connect, 2000);
        };
        ws.onerror = () => ws.close();
      } catch {
        setTimeout(connect, 5000);
      }
    };
    connect();
  }

  async stop() {
    this.running = false;
    clearInterval(this.hb);
    this.ws?.close();
  }

  async send(chatId: string, text: string) {
    await this.rest("POST", `/channels/${chatId}/messages`, { content: text.slice(0, 1990) });
  }

  async askApproval(chatId: string, id: string, title: string) {
    await this.rest("POST", `/channels/${chatId}/messages`, {
      content: `Approval needed: ${title}`,
      components: [
        { type: 1, components: [
          { type: 2, style: 3, label: "Approve", custom_id: `ap:${id}:y` },
          { type: 2, style: 4, label: "Deny", custom_id: `ap:${id}:n` },
        ] },
      ],
    });
  }
}
