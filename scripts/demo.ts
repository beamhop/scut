// Spin up a demo crew for screenshots: SCUT_HOME=/tmp/scut-demo bun scripts/demo.ts
import { Scut } from "../apps/app/src/core.ts";
const s = await Scut.open();
for (const a of [...s.agents]) await s.remove(a.id).catch(() => {});
const or = process.env.OPENROUTER_API_KEY;
const model = or ? { provider: "scut", api: "openai-completions" as const, baseUrl: "https://openrouter.ai/api/v1", apiKey: or, model: "anthropic/claude-haiku-5.5" } : undefined;
const say = (id: string, text: string, approve = true) =>
  new Promise<string>((resolve) => {
    const a = s.get(id);
    const ws = new WebSocket(`${a.current.endpoint.replace("http", "ws")}/ws?auth=${s.auth(a.current.endpoint)}`);
    ws.onopen = () => ws.send(JSON.stringify({ t: "chat", text }));
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      const m = JSON.parse(e.data);
      if (m.t === "approval.request" && approve) ws.send(JSON.stringify({ t: "approval", id: m.id, ok: true }));
      if (m.t === "approval.request" && !approve) { ws.close(); resolve("waiting"); }
      if (m.t === "chat" && m.from === "agent") { ws.close(); resolve(m.text); }
    };
    setTimeout(() => resolve("timeout"), 180_000);
  });
const scout = await s.create({ name: "Scout", harness: model ? "pi" : "mock", template: "researcher", model, nostr: true });
const nova = await s.create({ name: "Nova", harness: "mock", nostr: true });
const atlas = await s.create({ name: "Atlas", harness: "mock", driver: process.env.SCUT_SIM_CLOUD ? "sim-cloud" : "local", autonomy: "ask" });
console.log(await say(scout.id, "Open https://en.wikipedia.org/wiki/Teleportation and tell me in one sentence what it is about."));
console.log(await say(nova.id, "open https://news.ycombinator.com"));
console.log(await say(atlas.id, "open https://example.com", false));
console.log("demo ready", s.agents.map((a) => `${a.name}=${a.id}`).join(" "));
