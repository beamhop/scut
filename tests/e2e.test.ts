// End-to-end tests: real agent containers (Docker), real desktop, real beams.
// Run: SCUT_IMAGE=ghcr.io/beamhop/scut-agent:dev bun test tests/e2e.test.ts --timeout 600000
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ServerMsg } from "@scut/protocol";
import { startMockLlm } from "./mock-llm.ts";
import { startMockTelegram } from "./mock-telegram.ts";
const tg = startMockTelegram();
process.env.SCUT_AGENT_ENV = `SCUT_TELEGRAM_API=http://host.docker.internal:${tg.port}`;

process.env.SCUT_HOME = mkdtempSync(`${tmpdir()}/scut-test-`);
process.env.SCUT_SIM_CLOUD = "1";
process.env.SCUT_LOCAL_DRIVER = "docker";
process.env.SCUT_IMAGE ??= "ghcr.io/beamhop/scut-agent:dev";
const { Scut } = await import("../apps/app/src/core.ts");

let scut: InstanceType<typeof Scut>;
const llm = startMockLlm();

class Client {
  ws!: WebSocket;
  msgs: ServerMsg[] = [];
  frames = 0;
  constructor(public endpoint: string, public token: string) {}
  open() {
    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(`${this.endpoint.replace(/^http/, "ws")}/ws?auth=${this.token}`);
      this.ws.binaryType = "arraybuffer";
      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({ t: "subscribe", frames: true }));
        resolve();
      };
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (ev) => {
        if (typeof ev.data === "string") this.msgs.push(JSON.parse(ev.data));
        else this.frames++;
      };
    });
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  async waitFor<T extends ServerMsg>(pred: (m: ServerMsg) => boolean, ms = 60_000): Promise<T> {
    const t0 = Date.now();
    let seen = 0;
    while (Date.now() - t0 < ms) {
      for (; seen < this.msgs.length; seen++) if (pred(this.msgs[seen])) return this.msgs[seen] as T;
      await Bun.sleep(100);
    }
    throw new Error(`timeout; last msgs: ${JSON.stringify(this.msgs.slice(-5))}`);
  }
  close() {
    this.ws?.close();
  }
}
const client = async (id: string) => {
  const a = scut.get(id);
  const c = new Client(a.current.endpoint, scut.auth(a.current.endpoint));
  await c.open();
  return c;
};

beforeAll(async () => {
  scut = await Scut.open();
});
afterAll(async () => {
  for (const a of [...scut.agents]) await scut.remove(a.id).catch(() => {});
  llm.server.stop(true);
  tg.server.stop(true);
});

describe("mock harness agent", () => {
  let id = "";
  test("create boots desktop and serves frames", async () => {
    const rec = await scut.create({ name: "Mocky", harness: "mock", autonomy: "risky" });
    id = rec.id;
    const h = await (await fetch(`${rec.current.endpoint}/health`)).json();
    expect(h.state).toBe("running");
    const c = await client(id);
    const hello = await c.waitFor((m) => m.t === "hello");
    expect((hello as any).agent.name).toBe("Mocky");
    await Bun.sleep(2500);
    expect(c.frames).toBeGreaterThan(2);
    c.close();
  });

  test("rejects unauthenticated access", async () => {
    const a = scut.get(id);
    expect((await fetch(`${a.current.endpoint}/status`)).status).toBe(401);
    const forged = scut.auth(a.current.endpoint).slice(0, -4) + "AAAA";
    expect((await fetch(`${a.current.endpoint}/status?auth=${forged}`)).status).toBe(401);
  });

  test("chat round trip uses the computer", async () => {
    const c = await client(id);
    c.send({ t: "chat", text: "hello there" });
    const reply = await c.waitFor<any>((m) => m.t === "chat" && m.from === "agent");
    expect(reply.text).toContain("message #1");
    expect(reply.text).toMatch(/screenshot \d{4,} bytes/);
    c.close();
  });

  test("human input reaches the desktop", async () => {
    const c = await client(id);
    c.send({ t: "input", kind: "click", x: 640, y: 400, button: 1 });
    c.send({ t: "input", kind: "type", text: "hi" });
    await Bun.sleep(500);
    expect(c.msgs.find((m) => m.t === "error")).toBeUndefined();
    c.close();
  });

  test("beam to simulated cloud keeps state, retires source", async () => {
    const src = scut.get(id).current;
    const stages: string[] = [];
    const t0 = Date.now();
    await scut.beam(id, "sim-cloud", { onStage: (s) => stages.push(s) });
    const secs = (Date.now() - t0) / 1000;
    console.log(`beam took ${secs.toFixed(1)}s, stages ${stages.join(" > ")}`);
    expect(stages.at(-1)).toBe("online");
    const dst = scut.get(id).current;
    expect(dst.driver).toBe("sim-cloud");
    expect((await (await fetch(`${src.endpoint}/health`)).json()).state).toBe("retired");
    const c = await client(id);
    c.send({ t: "chat", text: "after beam" });
    const reply = await c.waitFor<any>((m) => m.t === "chat" && m.from === "agent");
    expect(reply.text).toContain("message #2"); // workspace log survived the beam
    c.close();
  });

  test("retired source refuses to beam again (single active lease)", async () => {
    const old = scut.get(id).history.at(-1)!;
    const r = await fetch(`${old.endpoint}/beam/prepare`, { method: "POST", headers: { authorization: `Scut ${scut.auth(old.endpoint)}` } });
    expect(r.status).toBe(409);
  });

  test("beam back to local", async () => {
    await scut.beam(id, "local", { destroySource: true });
    const c = await client(id);
    c.send({ t: "chat", text: "home again" });
    const reply = await c.waitFor<any>((m) => m.t === "chat" && m.from === "agent");
    expect(reply.text).toContain("message #3");
    c.close();
  });
});

describe("approvals", () => {
  test("autonomy=ask blocks agent actions until the owner approves", async () => {
    const rec = await scut.create({ name: "Careful", harness: "mock", autonomy: "ask" });
    const c = await client(rec.id);
    c.send({ t: "chat", text: "please open https://example.com" });
    const req = await c.waitFor<any>((m) => m.t === "approval.request");
    expect(req.title).toContain("open_url");
    c.send({ t: "approval", id: req.id, ok: true });
    const reply = await c.waitFor<any>((m) => m.t === "chat" && m.from === "agent");
    expect(reply.text).toContain("message #1");
    c.close();
  });
});

describe("pi harness", () => {
  test("pi drives the computer MCP tools through an OpenAI-compatible model", async () => {
    const rec = await scut.create({
      name: "Pi Mock",
      harness: "pi",
      model: { provider: "scut", api: "openai-completions", baseUrl: `http://host.docker.internal:${llm.port}/v1`, apiKey: "test", model: "mock-vision" },
    });
    const c = await client(rec.id);
    c.send({ t: "chat", text: "what is on your screen?" });
    const reply = await c.waitFor<any>((m) => m.t === "chat" && m.from === "agent", 120_000);
    console.log("pi reply:", reply.text, "requests:", llm.requests.length);
    expect(reply.text).toContain("MOCK_DONE");
    expect(reply.text).toContain("image=true");
    const names = (llm.requests[0].tools ?? []).map((t: any) => t.function.name);
    expect(names).toContain("mcp__computer__screenshot");
    c.close();
  });
});

describe("v0.2: history, settings, stop, budget", () => {
  test("chat history is replayed on reconnect and survives a beam", async () => {
    const rec = await scut.create({ name: "Memo", harness: "mock" });
    let c = await client(rec.id);
    c.send({ t: "chat", text: "remember me" });
    await c.waitFor((m) => m.t === "chat" && (m as any).from === "agent");
    c.close();
    await scut.beam(rec.id, "sim-cloud", { destroySource: true });
    c = await client(rec.id);
    const h = await c.waitFor<any>((m) => m.t === "history");
    expect(h.chat.map((x: any) => x.text)).toContain("remember me");
    expect(h.chat.length).toBe(2);
    c.close();
  });

  test("settings change autonomy and persist", async () => {
    const rec = await scut.create({ name: "Tuner", harness: "mock", autonomy: "auto" });
    const c = await client(rec.id);
    await c.waitFor((m) => m.t === "settings");
    c.send({ t: "settings", autonomy: "ask", dailyTokenBudget: 5000 });
    const s = await c.waitFor<any>((m) => m.t === "settings" && (m as any).autonomy === "ask");
    expect(s.dailyTokenBudget).toBe(5000);
    c.send({ t: "chat", text: "open https://example.com" });
    const req = await c.waitFor<any>((m) => m.t === "approval.request");
    c.send({ t: "stop" }); // stop denies pending approvals
    await c.waitFor((m) => m.t === "approval.resolved" && (m as any).id === req.id && (m as any).ok === false);
    c.close();
  });

  test("daily token budget blocks prompts once spent", async () => {
    const rec = await scut.create({ name: "Thrifty", harness: "mock", dailyTokenBudget: 10 });
    const c = await client(rec.id);
    c.send({ t: "chat", text: "first message uses more than ten tokens" });
    await c.waitFor((m) => m.t === "chat" && (m as any).from === "agent" && (m as any).text.includes("message #1"));
    c.send({ t: "chat", text: "second" });
    const r = await c.waitFor<any>((m) => m.t === "chat" && (m as any).from === "agent" && (m as any).text.includes("budget"));
    expect(r.text).toContain("token budget");
    c.close();
  });
});

describe("telegram pairing and owner-only approvals (mock Bot API)", () => {
  test("pair with code, chat from anyone, approvals only from the owner", async () => {
    const rec = await scut.create({ name: "Teleo", harness: "mock", autonomy: "ask", telegramToken: "TEST:TOKEN" });
    const c = await client(rec.id);
    const p = await c.waitFor<any>((m) => m.t === "pairing" && !!(m as any).telegram?.code);
    expect(p.telegram.bot).toBe("mock_bot");
    tg.message(42, "/pair 000000");
    await tg.waitSent((m) => m.chat_id === "42" && m.text.includes("doesn't match"));
    tg.message(42, `/pair ${p.telegram.code}`);
    await tg.waitSent((m) => m.chat_id === "42" && m.text.startsWith("Paired"));
    // a guest in a group asks for something risky
    tg.message(99, "please open https://example.com", -500);
    const ask = await tg.waitSent((m) => m.chat_id === "42" && !!m.reply_markup);
    const data = ask.reply_markup.inline_keyboard[0][0].callback_data as string;
    tg.callback(99, data); // guest tries to approve: ignored
    await Bun.sleep(3000);
    expect(tg.sent.find((m) => m.chat_id === "-500" && m.text.startsWith("mock:"))).toBeUndefined();
    tg.callback(42, data); // owner approves
    const reply = await tg.waitSent((m) => m.chat_id === "-500" && m.text.startsWith("mock:"));
    expect(reply.text).toContain("message #1");
    c.close();
  });
});
