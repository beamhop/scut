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
