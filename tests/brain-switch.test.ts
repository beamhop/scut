// Changing an agent's brain after it was made: the agent software (harness) and the model switch live, without
// recreating the agent, and the app's record follows. Runs without a sandbox (needs network once, to install Pi).
// Run: bun test tests/brain-switch.test.ts --timeout 900000
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ServerMsg } from "@scut/protocol";
import { startMockLlm } from "./mock-llm.ts";

process.env.SCUT_HOME = mkdtempSync(`${tmpdir()}/scut-brain-`);
process.env.SCUT_LOCAL_DRIVER = "host";
process.env.SCUT_HOST_SERVICE = "none";
process.env.SCUT_NO_AUTO_UPDATE = "1";
const { Scut } = await import("../apps/app/src/core.ts");
const llm = startMockLlm();
let scut: InstanceType<typeof Scut>;
let id = "";

async function connect() {
  const a = scut.get(id);
  const sock = new WebSocket(`${a.current.endpoint.replace(/^http/, "ws")}/ws?auth=${scut.auth(a.current.endpoint)}`);
  const msgs: ServerMsg[] = [];
  sock.onmessage = (e) => typeof e.data === "string" && msgs.push(JSON.parse(e.data));
  await new Promise((r) => (sock.onopen = r));
  const waitFor = async (pred: (m: any) => boolean, ms = 120_000, from = 0) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = msgs.slice(from).find(pred);
      if (m) return m as any;
      await Bun.sleep(100);
    }
    throw new Error(`timeout; last: ${JSON.stringify(msgs.slice(-3))}`);
  };
  return { sock, msgs, waitFor };
}
async function chat(text: string) {
  const c = await connect();
  await c.waitFor((m) => m.t === "hello");
  const from = c.msgs.length;
  c.sock.send(JSON.stringify({ t: "chat", text }));
  const r = await c.waitFor((m) => m.t === "chat" && m.from === "agent", 180_000, from);
  c.sock.close();
  return r.text as string;
}
/** What the Settings → Brain form does: tell the app (installs the software here), then the agent. */
async function switchBrain(harness: string, model: any) {
  await scut.setBrain(scut.get(id), { harness: harness as any, model: model === null ? null : model && { baseUrl: model.baseUrl, model: model.model } });
  const c = await connect();
  await c.waitFor((m) => m.t === "settings");
  const from = c.msgs.length;
  c.sock.send(JSON.stringify({ t: "settings", harness, ...(model !== undefined ? { model } : {}) }));
  const s = await c.waitFor((m) => m.t === "settings", 30_000, from);
  await c.waitFor((m) => m.t === "narration" && /Now thinking with/.test(m.text), 120_000, from);
  c.sock.close();
  return s;
}

beforeAll(async () => { scut = await Scut.open(); });
afterAll(async () => {
  for (const a of [...scut.agents]) await scut.remove(a.id).catch(() => {});
  llm.server.stop(true);
});

test("made with the demo brain, it answers with practice replies", async () => {
  id = (await scut.create({ name: "Switchy", harness: "mock" })).id;
  expect(await chat("hello")).toContain("mock: message #1");
}, 300_000);

test("switch to Pi with a model: same agent, now thinks with the model", async () => {
  const model = { api: "openai-completions", baseUrl: `http://host.docker.internal:${llm.port}/v1`, model: "mock-vision", apiKey: "test" };
  const s = await switchBrain("pi", model);
  expect(s.harness).toBe("pi");
  expect(s.model).toMatchObject({ model: "mock-vision", hasKey: true });
  expect(scut.get(id)).toMatchObject({ harness: "pi", model: { model: "mock-vision" } });
  expect(await chat("what is on your screen?")).toContain("MOCK_DONE");
}, 900_000);

test("back to the demo, dropping the model", async () => {
  const s = await switchBrain("mock", null);
  expect(s.harness).toBe("mock");
  expect(s.model).toBeUndefined();
  expect(scut.get(id).harness).toBe("mock");
  expect(scut.get(id).model).toBeUndefined();
  expect(await chat("again")).toContain("mock:");
}, 300_000);
