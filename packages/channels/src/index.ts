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

export const DEFAULT_RELAYS = ["wss://nos.lol", "wss://relay.primal.net", "wss://relay.damus.io"];

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
        await Promise.any(this.pool.publish(this.relays, ev)).catch(() => {});
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
          if (rumor.kind !== 14 || rumor.pubkey === this.pub || rumor.created_at <= since) return;
          since = Math.max(since, rumor.created_at);
          if (this.cursorFile) await Bun.write(this.cursorFile, String(since));
          const text = String(rumor.content).trim();
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

  async send(to: string, text: string) {
    const wrap = nip17.wrapEvent(this.sk, { publicKey: to }, text);
    await Promise.any(this.pool.publish(this.relays, wrap));
  }

  async askApproval(to: string, id: string, title: string) {
    await this.send(to, `Approval needed: ${title}\nReply "yes ${id}" or "no ${id}".`);
  }
}
