// Live tests against real services. Skipped unless keys are present.
//   OPENROUTER_API_KEY=… TELEGRAM_BOT_TOKEN=… bun test tests/live.test.ts --timeout 600000
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

process.env.SCUT_HOME = mkdtempSync(`${tmpdir()}/scut-live-`);
process.env.SCUT_SIM_CLOUD = "1";
process.env.SCUT_LOCAL_DRIVER = "docker";
process.env.SCUT_IMAGE ??= "ghcr.io/beamhop/scut-agent:dev";
const { Scut } = await import("../apps/app/src/core.ts");
const OR = process.env.OPENROUTER_API_KEY;
const TG = process.env.TELEGRAM_BOT_TOKEN;
const MODEL = process.env.SCUT_LIVE_MODEL ?? "anthropic/claude-haiku-5.5";

let scut: InstanceType<typeof Scut>;
beforeAll(async () => {
  scut = await Scut.open();
});
afterAll(async () => {
  for (const a of [...scut.agents]) await scut.remove(a.id).catch(() => {});
});

async function chat(endpoint: string, token: string, text: string, ms = 240_000): Promise<{ reply: string; narration: string[] }> {
  const ws = new WebSocket(`${endpoint.replace(/^http/, "ws")}/ws?auth=${token}`);
  const narration: string[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout; narration: ${narration.slice(-5).join(" | ")}`)), ms);
    ws.onopen = () => ws.send(JSON.stringify({ t: "chat", text }));
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      const m = JSON.parse(ev.data);
      if (m.t === "narration") narration.push(m.text);
      if (m.t === "approval.request") ws.send(JSON.stringify({ t: "approval", id: m.id, ok: true }));
      if (m.t === "chat" && m.from === "agent") {
        clearTimeout(timer);
        ws.close();
        resolve({ reply: m.text, narration });
      }
    };
  });
}

describe.skipIf(!OR)("openrouter + pi", () => {
  test("agent browses a real page and reports what it sees, then survives a beam", async () => {
    const rec = await scut.create({
      name: "Scout",
      harness: "pi",
      template: "researcher",
      model: { provider: "scut", api: "openai-completions", baseUrl: "https://openrouter.ai/api/v1", apiKey: OR, model: MODEL },
    });
    const ep = () => scut.get(rec.id).current.endpoint;
    const r1 = await chat(ep(), scut.auth(ep()), "Open https://example.com in your browser, take a screenshot, and tell me the main heading on the page. Reply with just the heading.");
    console.log("reply 1:", r1.reply, "\nnarration:", r1.narration.join(" | "));
    // Models sometimes quote the body instead of the heading; either proves it read the real page.
    expect(r1.reply.toLowerCase()).toMatch(/example domain|documentation examples/);

    await scut.beam(rec.id, "sim-cloud", { destroySource: true });
    const r2 = await chat(ep(), scut.auth(ep()), "What heading did you report in your previous answer? Reply with just the heading.");
    console.log("reply 2 (after beam):", r2.reply);
    expect(r2.reply.toLowerCase()).toMatch(/example domain|documentation examples/); // conversation survived the beam
  });
});

describe.skipIf(!OR)("CLI harnesses on the picked brain", () => {
  for (const harness of ["opencode", "codex", "copilot"] as const) {
    test(`${harness} answers with the OpenRouter key from Beamhop (no sign-in) and can use the agent's screen`, async () => {
      const rec = await scut.create({
        name: { codex: "Codey", opencode: "Openy", copilot: "Pilot" }[harness],
        harness,
        model: { provider: "scut", api: "openai-completions", baseUrl: "https://openrouter.ai/api/v1", apiKey: OR, model: MODEL },
      });
      const ep = scut.get(rec.id).current.endpoint;
      const r = await chat(ep, scut.auth(ep), "Use your open_url tool to open https://example.com, then use screenshot, and tell me the main heading. Reply with just the heading.", 300_000);
      console.log(`${harness} reply:`, JSON.stringify(r.reply.slice(0, 300)), "\nnarration:", r.narration.slice(-6).join(" | "));
      expect(r.reply.toLowerCase()).toMatch(/example domain|documentation examples/);
      await scut.remove(rec.id);
    }, 400_000);
  }
});

describe.skipIf(!TG)("telegram", () => {
  test("bot token is valid and the channel connects only on the lease holder", async () => {
    const me = await (await fetch(`https://api.telegram.org/bot${TG}/getMe`)).json();
    expect(me.ok).toBe(true);
    console.log("bot:", me.result.username);
    const rec = await scut.create({ name: "Telly", harness: "mock", telegramToken: TG });
    const first = scut.get(rec.id).current;
    const logs1 = Bun.spawnSync(["docker", "logs", `scut-${rec.id}`]).stdout.toString() + Bun.spawnSync(["docker", "logs", `scut-${rec.id}`]).stderr.toString();
    expect(logs1).toContain("telegram connected");
    await scut.beam(rec.id, "sim-cloud");
    const name2 = (scut.get(rec.id).current as any).meta.name;
    const logs2 = Bun.spawnSync(["docker", "logs", name2]).stdout.toString();
    expect(logs2).toContain("telegram connected");
    const h = await (await fetch(`${first.endpoint}/health`)).json();
    expect(h.state).toBe("retired"); // old host stopped polling
  });
});

describe("nostr (real public relays)", () => {
  test("a user DMs the agent over NIP-17 and gets a private reply; approvals by DM", async () => {
    const { generateSecretKey, getPublicKey, nip17, SimplePool } = await import("nostr-tools");
    const userSk = generateSecretKey();
    const userPk = getPublicKey(userSk);
    const relays = ["wss://relay.primal.net", "wss://relay.damus.io"];
    const rec = await scut.create({ name: "Nostro", harness: "mock", autonomy: "ask", nostr: { relays, ownerPubkey: userPk } });
    await Bun.sleep(3000); // let the agent subscribe
    const pool = new SimplePool();
    const inbox: string[] = [];
    const sub = pool.subscribeMany(relays, { kinds: [1059], "#p": [userPk] }, {
      onevent: (w) => {
        try {
          const r = nip17.unwrapEvent(w, userSk);
          if (!inbox.includes(r.content)) inbox.push(r.content);
        } catch {}
      },
    });
    const send = (text: string) => Promise.any(pool.publish(relays, nip17.wrapEvent(userSk, { publicKey: rec.agentPubkey }, text)));
    const wait = async (re: RegExp, ms = 60_000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const hit = inbox.find((x) => re.test(x));
        if (hit) return hit;
        await Bun.sleep(300);
      }
      throw new Error(`no DM matching ${re}; inbox: ${JSON.stringify(inbox)}`);
    };
    await send("please open https://example.com");
    const ask = await wait(/Approval needed/);
    const id = ask.match(/yes ([0-9a-f]+)/)![1];
    await send(`yes ${id}`);
    const reply = await wait(/^mock: message #1/);
    console.log("nostr reply:", reply);
    sub.close();
    pool.close(relays);
  });
});

describe("crew room (NIP-17 group over real relays)", () => {
  test("owner talks to the crew; mentioned agent answers; Pi agent posts with crew_post", async () => {
    const { CrewRoom } = await import("../apps/app/src/crew.ts");
    const relays = ["wss://relay.primal.net", "wss://relay.damus.io"];
    const a = await scut.create({ name: "Alpha", harness: "mock", nostr: { relays } });
    const b = OR
      ? await scut.create({ name: "Bravo", harness: "pi", nostr: { relays }, model: { provider: "scut", api: "openai-completions", baseUrl: "https://openrouter.ai/api/v1", apiKey: OR, model: MODEL } })
      : null;
    await scut.syncCrew();
    const crew = new CrewRoom(scut, relays);
    await crew.start();
    await Bun.sleep(3000);
    const wait = async (pred: (l: any) => boolean, ms = 120_000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const hit = crew.lines.find(pred);
        if (hit) return hit;
        await Bun.sleep(500);
      }
      throw new Error(`crew timeout: ${JSON.stringify(crew.lines.slice(-5))}`);
    };
    await crew.post("@Alpha are you there?");
    const fromAlpha = await wait((l) => l.name === "Alpha" && l.text.includes("mock: message #1"));
    console.log("Alpha in crew:", fromAlpha.text);
    if (b) {
      await crew.post("@Bravo please use your crew_post tool to post exactly: BRAVO_REPORTING");
      const fromBravo = await wait((l) => l.name === "Bravo" && l.text.includes("BRAVO_REPORTING"));
      console.log("Bravo in crew:", fromBravo.text);
    }
  });
});

describe("crew loop guard (real relays)", () => {
  test("two agents that keep mentioning each other stop after the limit", async () => {
    const { CrewRoom } = await import("../apps/app/src/crew.ts");
    const relays = ["wss://relay.primal.net", "wss://relay.damus.io"];
    await scut.create({ name: "Ping", harness: "mock", nostr: { relays } });
    await scut.create({ name: "Pong", harness: "mock", nostr: { relays } });
    await scut.syncCrew();
    const crew = new CrewRoom(scut, relays);
    await crew.start();
    await Bun.sleep(3000);
    await crew.post("@Ping @Pong #loop");
    await Bun.sleep(60_000);
    const n1 = crew.lines.filter((l) => ["Ping", "Pong"].includes(l.name)).length;
    await Bun.sleep(20_000);
    const n2 = crew.lines.filter((l) => ["Ping", "Pong"].includes(l.name)).length;
    console.log("agent crew messages after 60s:", n1, "after 80s:", n2);
    expect(n1).toBeGreaterThan(1); // they did talk
    expect(n2).toBe(n1); // and then stopped
    expect(n2).toBeLessThanOrEqual(2 * 4 + 2);
  });
});

describe.skipIf(!OR)("assisted Telegram setup with a real model", () => {
  test("the agent opens BotFather on its screen and asks the owner to log in", async () => {
    const rec = await scut.create({
      name: "Helper",
      harness: "pi",
      model: { provider: "scut", api: "openai-completions", baseUrl: "https://openrouter.ai/api/v1", apiKey: OR, model: MODEL },
    });
    const ep = scut.get(rec.id).current.endpoint;
    const ws = new WebSocket(`${ep.replace(/^http/, "ws")}/ws?auth=${scut.auth(ep)}`);
    const seen: string[] = [];
    const approval = await new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no approval; narration: ${seen.slice(-6).join(" | ")}`)), 240_000);
      ws.onopen = () =>
        ws.send(JSON.stringify({ t: "chat", text: [
          "Please set yourself up on Telegram:",
          "1. Open https://web.telegram.org/k/#@BotFather in your browser.",
          '2. If Telegram asks me to log in, call request_approval with the title "Please log in to Telegram on my screen" and wait until I approve.',
          "3. Then continue with /newbot.",
        ].join("\n") }));
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") return;
        const m = JSON.parse(ev.data);
        if (m.t === "narration") seen.push(m.text);
        if (m.t === "approval.request") { clearTimeout(t); resolve(m); }
      };
    });
    console.log("approval asked:", approval.title, "| narration:", seen.slice(-5).join(" | "));
    expect(approval.title.toLowerCase()).toContain("log in");
    expect(approval.shot).toBeTruthy();
    ws.send(JSON.stringify({ t: "stop" })); // don't continue
    ws.close();
  });
});
