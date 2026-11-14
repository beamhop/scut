// Subscription sign-in for Codex (ChatGPT): an agent that isn't signed in says so (no CLI connection retries), shows
// a device-code link and code when asked, can cancel, and offers Codex's models. Runs without a sandbox; installs
// Codex once (network). Never completes a sign-in (that needs a person's account).
// Run: bun test tests/signin.test.ts --timeout 900000
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ServerMsg } from "@scut/protocol";

process.env.SCUT_HOME = mkdtempSync(`${tmpdir()}/scut-signin-`);
process.env.SCUT_LOCAL_DRIVER = "host";
process.env.SCUT_HOST_SERVICE = "none";
process.env.SCUT_NO_AUTO_UPDATE = "1";
const { Scut } = await import("../apps/app/src/core.ts");
let scut: InstanceType<typeof Scut>;
let c: Awaited<ReturnType<typeof connect>>;

async function connect(id: string) {
  const a = scut.get(id);
  const sock = new WebSocket(`${a.current.endpoint.replace(/^http/, "ws")}/ws?auth=${scut.auth(a.current.endpoint)}`);
  const msgs: ServerMsg[] = [];
  sock.onmessage = (e) => typeof e.data === "string" && msgs.push(JSON.parse(e.data));
  await new Promise((r) => (sock.onopen = r));
  const waitFor = async (pred: (m: any) => boolean, ms = 60_000, from = 0) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = msgs.slice(from).find(pred);
      if (m) return m as any;
      await Bun.sleep(100);
    }
    throw new Error(`timeout; last: ${JSON.stringify(msgs.slice(-3))}`);
  };
  return { sock, msgs, waitFor, send: (m: unknown) => sock.send(JSON.stringify(m)) };
}

beforeAll(async () => { scut = await Scut.open(); });
afterAll(async () => {
  c?.sock.close();
  for (const a of [...scut.agents]) await scut.remove(a.id).catch(() => {});
});

test("a ChatGPT agent that isn't signed in says so, plainly", async () => {
  const rec = await scut.create({ name: "Signy", harness: "codex" });
  c = await connect(rec.id);
  const s = await c.waitFor((m) => m.t === "signin" && m.state === "signed-out");
  expect(s.harness).toBe("codex");
  const st = await c.waitFor((m) => m.t === "status" && m.problem?.fix === "signin");
  expect(st.problem.text).toContain("isn't signed in to ChatGPT");
  const from = c.msgs.length;
  c.send({ t: "chat", text: "hi" });
  const reply = await c.waitFor((m) => m.t === "chat" && m.from === "agent", 60_000, from);
  expect(reply.text).toContain("isn't signed in to ChatGPT");
}, 900_000);

test("Codex's models are offered, and the one picked is kept", async () => {
  const s = await c.waitFor((m) => m.t === "settings" && m.subModels?.length > 0);
  const pick = s.subModels[0].id;
  const from = c.msgs.length;
  c.send({ t: "settings", subModel: pick });
  expect((await c.waitFor((m) => m.t === "settings", 10_000, from)).subModel).toBe(pick);
});

test("sign in shows a link and a one-time code; cancel goes back to signed out", async () => {
  let from = c.msgs.length;
  c.send({ t: "signin", op: "start" });
  const w = await c.waitFor((m) => m.t === "signin" && m.state === "waiting", 60_000, from);
  expect(w.url).toMatch(/^https:\/\/auth\.openai\.com\//);
  expect(w.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4,6}$/);
  from = c.msgs.length;
  c.send({ t: "signin", op: "cancel" });
  await c.waitFor((m) => m.t === "signin" && m.state === "signed-out", 30_000, from);
}, 120_000);
