// End-to-end tests: real agent containers (Docker), real desktop, real beams.
// Run: SCUT_IMAGE=ghcr.io/beamhop/scut-agent:dev bun test tests/e2e.test.ts --timeout 600000
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ServerMsg } from "@scut/protocol";
import { startMockLlm } from "./mock-llm.ts";
import { startMockTelegram } from "./mock-telegram.ts";
import { startMockDiscord, startMockSlack } from "./mock-chat.ts";
const tg = startMockTelegram();
const slack = startMockSlack();
const discord = startMockDiscord();
process.env.SCUT_AGENT_ENV = [
  `SCUT_TELEGRAM_API=http://host.docker.internal:${tg.port}`,
  `SCUT_SLACK_API=http://host.docker.internal:${slack.server.port}/api`,
  `SCUT_DISCORD_API=http://host.docker.internal:${discord.server.port}/api/v10`,
  "SCUT_SCHEDULE_TICK_MS=1000",
].join(",");

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
// Keep memory flat: each agent runs a full Chromium. Only "Mocky" lives across tests.
afterEach(async () => {
  for (const a of [...scut.agents]) if (a.name !== "Mocky") await scut.remove(a.id).catch(() => {});
});
afterAll(async () => {
  for (const a of [...scut.agents]) await scut.remove(a.id).catch(() => {});
  llm.server.stop(true);
  tg.server.stop(true);
  slack.server.stop(true);
  discord.server.stop(true);
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

describe("approvals survive reconnects", () => {
  test("a client that connects late still sees the pending approval", async () => {
    const rec = await scut.create({ name: "Patient", harness: "mock", autonomy: "ask" });
    const c1 = await client(rec.id);
    c1.send({ t: "chat", text: "open https://example.com" });
    const req = await c1.waitFor<any>((m) => m.t === "approval.request");
    c1.close();
    const c2 = await client(rec.id);
    const again = await c2.waitFor<any>((m) => m.t === "approval.request");
    expect(again.id).toBe(req.id);
    c2.send({ t: "approval", id: req.id, ok: true });
    await c2.waitFor((m) => m.t === "chat" && (m as any).from === "agent");
    c2.close();
  });
});

describe("v0.3: auth binding, take control, schedules", () => {
  test("a token signed for one agent is rejected by another", async () => {
    const a = await scut.create({ name: "Alpha", harness: "mock" });
    const b = await scut.create({ name: "Bravo", harness: "mock" });
    const tokA = scut.auth(a.current.endpoint);
    expect((await fetch(`${a.current.endpoint}/status?auth=${tokA}`)).status).toBe(200);
    expect((await fetch(`${b.current.endpoint}/status?auth=${tokA}`)).status).toBe(401);
  });

  test("take control pauses agent actions until handed back", async () => {
    const rec = await scut.create({ name: "Pausy", harness: "mock" });
    const c = await client(rec.id);
    c.send({ t: "pause", paused: true });
    await c.waitFor((m) => m.t === "paused" && (m as any).paused === true);
    c.send({ t: "chat", text: "open https://example.com" });
    await c.waitFor((m) => m.t === "narration" && (m as any).text.startsWith("Paused"));
    await Bun.sleep(1500);
    expect(c.msgs.find((m) => m.t === "chat" && (m as any).from === "agent")).toBeUndefined();
    c.send({ t: "pause", paused: false });
    const reply = await c.waitFor<any>((m) => m.t === "chat" && m.from === "agent");
    expect(reply.text).toContain("message #1");
    c.close();
  });

  test("scheduled tasks run on their own and persist", async () => {
    const rec = await scut.create({ name: "Clock", harness: "mock" });
    const c = await client(rec.id);
    await c.waitFor((m) => m.t === "schedules");
    c.send({ t: "schedules", schedules: [{ id: "s1", prompt: "scheduled ping", kind: "every", minutes: 60, enabled: true }] });
    const ran = await c.waitFor<any>((m) => m.t === "chat" && m.from === "agent" && m.channel === "schedule", 20_000);
    expect(ran.text).toContain("scheduled ping");
    const sched = await c.waitFor<any>((m) => m.t === "schedules" && !!(m as any).schedules[0]?.lastRun);
    expect(sched.schedules[0].lastRun).toBeGreaterThan(0);
    c.close();
  });
});

describe("v0.9: rollback, frame budget, channels from settings", () => {
  test("a failed beam rolls back: the agent keeps running where it was", async () => {
    const rec = await scut.create({ name: "Sturdy", harness: "mock" });
    scut.drivers.set("broken", {
      id: "broken", label: "Broken cloud", isolation: "container", monthlyUsd: 0,
      create: async () => { throw new Error("provider said no"); },
      destroy: async () => {},
    });
    let err = "";
    const t0 = Date.now();
    try {
      await scut.beam(rec.id, "broken", { onStage: (x) => console.log("rollback stage", x, Date.now() - t0) });
    } catch (e: any) {
      err = String(e?.message);
    }
    expect(err).toContain("provider said no");
    expect(scut.get(rec.id).current.driver).toBe("local");
    expect(scut.get(rec.id).beam?.stage).toBe("failed");
    const c = await client(rec.id);
    await c.waitFor((m) => (m.t === "hello" || m.t === "state") && (m as any).state === "running");
    c.send({ t: "chat", text: "still here?" });
    const r = await c.waitFor<any>((m) => m.t === "chat" && m.from === "agent");
    expect(r.text).toContain("message #1");
    c.close();
    scut.drivers.delete("broken");
  });

  test("an idle screen costs almost no frames; low-fps viewers get fewer", async () => {
    const rec = await scut.create({ name: "Idler", harness: "mock" });
    const fast = await client(rec.id);
    const slow = new (fast.constructor as any)(rec.current.endpoint, scut.auth(rec.current.endpoint));
    await slow.open();
    slow.send({ t: "subscribe", frames: true, fps: 1 });
    await Bun.sleep(4000);
    fast.frames = 0;
    slow.frames = 0;
    await Bun.sleep(4000);
    console.log("idle frames in 4s: 8fps viewer", fast.frames, "1fps viewer", slow.frames);
    expect(fast.frames).toBeLessThanOrEqual(3); // duplicates skipped (keepalive every 5s)
    fast.send({ t: "input", kind: "type", text: "moving" }); // screen changes
    fast.close();
    slow.close();
  });

  test("connect Telegram later from settings", async () => {
    const rec = await scut.create({ name: "Latecomer", harness: "mock" });
    const c = await client(rec.id);
    await c.waitFor((m) => m.t === "settings");
    c.send({ t: "settings", channels: { telegram: { token: "LATE:TOKEN" } } });
    const s = await c.waitFor<any>((m) => m.t === "settings" && m.channels?.telegram);
    expect(s.channels.telegram).toBe(true);
    const p = await c.waitFor<any>((m) => m.t === "pairing" && !!m.telegram?.code);
    expect(p.telegram.bot).toBe("mock_bot");
    c.close();
  });
});

async function until<T>(f: () => T | undefined, ms = 30_000, what = "condition"): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = f();
    if (v) return v;
    await Bun.sleep(100);
  }
  throw new Error(`timeout waiting for ${what}`);
}

describe("v0.10: Slack (Socket Mode) and Discord (Gateway), mocked", () => {
  test("Slack: pair by DM, ignore unmentioned channel chatter, owner-only approvals", async () => {
    const rec = await scut.create({ name: "Slacky", harness: "mock", autonomy: "ask", slack: { appToken: "xapp-test", botToken: "xoxb-test" } });
    const c = await client(rec.id);
    const p = await c.waitFor<any>((m) => m.t === "pairing" && !!m.code && !!m.channels?.slack);
    expect(p.channels.slack.bot).toBe("mock_slack");
    await until(() => slack.connected() > 0, 15_000, "slack socket");
    slack.dm("UOWNER", `pair ${p.code}`);
    await until(() => slack.posts.find((m) => m.channel === "DUOWNER" && m.text.startsWith("Paired")), 15_000, "paired");
    slack.channelMessage("UGUEST", "open https://example.com"); // not mentioned: ignored
    slack.mention("UGUEST", "please open https://example.com");
    const ask = await until(() => slack.posts.find((m) => m.channel === "DUOWNER" && m.blocks), 15_000, "approval blocks");
    const value = ask.blocks[1].elements[0].value;
    slack.click("UGUEST", value); // guest can't approve
    await Bun.sleep(2000);
    expect(slack.posts.find((m) => m.channel === "CGEN" && m.text?.startsWith("mock:"))).toBeUndefined();
    slack.click("UOWNER", value);
    const reply = await until(() => slack.posts.find((m) => m.channel === "CGEN" && m.text?.startsWith("mock:")), 15_000, "reply");
    expect(reply.text).toContain("message #1"); // the ignored channel message never reached the agent
    c.close();
  });

  test("Discord: DMs and mentions only, owner-only button approvals", async () => {
    const rec = await scut.create({ name: "Disco", harness: "mock", autonomy: "ask", discordToken: "discord-test" });
    const c = await client(rec.id);
    const p = await c.waitFor<any>((m) => m.t === "pairing" && !!m.code && !!m.channels?.discord);
    expect(p.channels.discord.bot).toBe("mock_discord");
    await until(() => discord.connected() > 0, 15_000, "discord gateway");
    await Bun.sleep(500); // identify -> READY
    discord.dm("42", `/pair ${p.code}`);
    await until(() => discord.posts.find((m) => m.channel === "DM42" && m.body.content.startsWith("Paired")), 15_000, "paired");
    discord.guildMessage("7", "open https://example.com"); // no mention: ignored
    discord.guildMessage("7", "please open https://example.com", true);
    const ask = await until(() => discord.posts.find((m) => m.channel === "DM42" && m.body.components), 15_000, "approval buttons");
    const id = ask.body.components[0].components[0].custom_id;
    discord.click("7", id); // guest
    await Bun.sleep(2000);
    expect(discord.posts.find((m) => m.channel === "CH1")).toBeUndefined();
    discord.click("42", id); // owner
    const reply = await until(() => discord.posts.find((m) => m.channel === "CH1"), 15_000, "reply");
    expect(reply.body.content).toContain("message #1");
    expect(discord.callbacks.length).toBeGreaterThan(0); // interactions acknowledged
    c.close();
  });
});

describe("big workspaces", () => {
  test("beams a 300 MB workspace (above Bun's 128 MB default body limit)", async () => {
    const rec = await scut.create({ name: "Hefty", harness: "mock" });
    const name = (rec.current as any).meta.name;
    const w = Bun.spawnSync(["docker", "exec", name, "sh", "-c", "head -c 300000000 /dev/urandom > /data/workspace/big.bin && sha256sum /data/workspace/big.bin"], { stdout: "pipe" });
    const before = w.stdout.toString().split(" ")[0];
    const t0 = Date.now();
    await scut.beam(rec.id, "sim-cloud", { destroySource: true });
    console.log(`300 MB beam took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const name2 = (scut.get(rec.id).current as any).meta.name;
    const after = Bun.spawnSync(["docker", "exec", name2, "sha256sum", "/data/workspace/big.bin"], { stdout: "pipe" }).stdout.toString().split(" ")[0];
    expect(after).toBe(before);
  });
});

describe("v0.14: memory and approval screenshots", () => {
  test("owner memories reach the agent on every prompt and survive a beam", async () => {
    const rec = await scut.create({ name: "Memento", harness: "mock" });
    const c = await client(rec.id);
    await c.waitFor((m) => m.t === "memory");
    c.send({ t: "memory", op: "add", text: "Owner prefers Dutch" });
    await c.waitFor<any>((m) => m.t === "memory" && m.items.length === 1);
    c.close();
    await scut.beam(rec.id, "sim-cloud", { destroySource: true });
    const c2 = await client(rec.id);
    const mem = await c2.waitFor<any>((m) => m.t === "memory");
    expect(mem.items[0].text).toBe("Owner prefers Dutch");
    c2.send({ t: "chat", text: "hi" });
    await c2.waitFor((m) => m.t === "chat" && (m as any).from === "agent");
    const name = (scut.get(rec.id).current as any).meta.name;
    const log = Bun.spawnSync(["docker", "exec", name, "cat", "/data/workspace/mock-log.txt"], { stdout: "pipe" }).stdout.toString();
    expect(log).toContain("Owner prefers Dutch"); // the memory preamble was part of the prompt
    c2.close();
  });

  test("the agent saves memories with the remember tool (Pi)", async () => {
    const rec = await scut.create({
      name: "Pi Memory",
      harness: "pi",
      model: { provider: "scut", api: "openai-completions", baseUrl: `http://host.docker.internal:${llm.port}/v1`, apiKey: "test", model: "mock-vision" },
    });
    const c = await client(rec.id);
    c.send({ t: "chat", text: "REMEMBER: owner's dog is called Bolt" });
    const mem = await c.waitFor<any>((m) => m.t === "memory" && m.items.some((x: any) => x.text.includes("Bolt")), 120_000);
    expect(mem.items.find((x: any) => x.text.includes("Bolt")).source).toBe("agent");
    c.close();
  });

  test("approval requests carry a screenshot of the moment", async () => {
    const rec = await scut.create({ name: "Shutter", harness: "mock", autonomy: "ask" });
    const c = await client(rec.id);
    await Bun.sleep(1500);
    c.send({ t: "chat", text: "open https://example.com" });
    const req = await c.waitFor<any>((m) => m.t === "approval.request");
    expect(req.shot?.startsWith("data:image/jpeg;base64,")).toBe(true);
    c.send({ t: "approval", id: req.id, ok: false });
    c.close();
  });
});
