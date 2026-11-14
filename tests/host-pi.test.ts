// No sandbox, with the real software: Beamhop installs the Pi harness for this computer (no Node needed: shims
// run it on Beamhop's own bun), Pi talks to the computer-use MCP server started as `scut mcp-computer`, and a
// browser is downloaded when the computer has none. Needs network (npm, Chrome for Testing).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { startMockLlm } from "./mock-llm.ts";

process.env.SCUT_HOME = mkdtempSync(`${tmpdir()}/scut-hostpi-`);
process.env.SCUT_LOCAL_DRIVER = "host";
process.env.SCUT_HOST_SERVICE = "none";
process.env.SCUT_NO_AUTO_UPDATE = "1";
const { Scut } = await import("../apps/app/src/core.ts");
const { ensureBrowser } = await import("@scut/drivers");
const llm = startMockLlm();
let scut: InstanceType<typeof Scut>;

beforeAll(async () => {
  scut = await Scut.open();
});
afterAll(async () => {
  for (const a of [...scut.agents]) await scut.remove(a.id).catch(() => {});
  llm.server.stop(true);
});

test("first run installs Pi for this computer (the progress the create dialog shows)", async () => {
  scut.startPrefetch();
  const t0 = Date.now();
  while (scut.prefetch.state === "pulling" && Date.now() - t0 < 600_000) await Bun.sleep(500);
  expect(scut.prefetch).toMatchObject({ state: "ready", done: 2, total: 2 });
  expect(existsSync(`${process.env.SCUT_HOME}/harness/bin/pi`)).toBe(true);
  expect(existsSync(`${process.env.SCUT_HOME}/harness/shim/node`)).toBe(true);
}, 700_000);

test("Pi drives its computer through `scut mcp-computer` (sees its own screen)", async () => {
  const rec = await scut.create({
    name: "Pi Host",
    harness: "pi",
    // Agents usually reach this computer as host.docker.internal; without a sandbox that becomes 127.0.0.1.
    model: { provider: "scut", api: "openai-completions", baseUrl: `http://host.docker.internal:${llm.port}/v1`, apiKey: "test", model: "mock-vision" },
  });
  const ws = new WebSocket(`${rec.current.endpoint.replace(/^http/, "ws")}/ws?auth=${scut.auth(rec.current.endpoint)}`);
  const reply = new Promise<string>((resolve) => {
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      const m = JSON.parse(e.data);
      if (m.t === "chat" && m.from === "agent") resolve(m.text);
    };
  });
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ t: "chat", text: "what is on your screen?" }));
  const text = await reply;
  ws.close();
  expect(text).toContain("MOCK_DONE");
  expect(text).toContain("image=true");
  const names = (llm.requests[0].tools ?? []).map((t: any) => t.function.name);
  expect(names).toContain("mcp__computer__screenshot");
  expect(names).toContain("mcp__computer__open_url");
  const sys = JSON.stringify(llm.requests[0].messages?.[0] ?? "");
  expect(sys).toContain("not in a sandbox");
}, 300_000);

test("with no browser on the computer, a headless Chrome is downloaded once", async () => {
  const dir = mkdtempSync(`${tmpdir()}/scut-browser-`);
  const seen: number[] = [];
  const b = await ensureBrowser(dir, (p) => seen.push(p.done), { useInstalled: false });
  expect(b).toContain("chrome-headless-shell");
  expect(existsSync(b)).toBe(true);
  expect(seen).toEqual([0, 1]);
  const again = await ensureBrowser(dir, undefined, { useInstalled: false });
  expect(again).toBe(b);
  const v = Bun.spawnSync([b, "--version"], { stdout: "pipe" }).stdout.toString();
  expect(v).toMatch(/Chrome/);
}, 600_000);
