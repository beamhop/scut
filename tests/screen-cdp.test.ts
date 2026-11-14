// The host-mode screen (headless Chromium over DevTools) does everything the agent's tools and Take over need,
// against a real browser: frames, screenshot, click, double-click, type (with Return), keys, scroll, new tabs and
// ctrl+w, navigation, thumbnails, and coming back after the browser dies.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { CdpScreen, parseCombo } from "../packages/agentd/src/screen-cdp.ts";

const PAGE = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
<input id="q" style="position:absolute;left:20px;top:20px;width:300px;height:30px">
<button id="b" style="position:absolute;left:20px;top:80px;width:120px;height:40px" onclick="document.title='clicked:'+(++window.n)">Go</button>
<div id="d" style="position:absolute;left:200px;top:80px;width:120px;height:40px;background:#ccc" ondblclick="document.title='dbl'">dbl</div>
<div id="r" style="position:absolute;left:20px;top:140px;width:120px;height:40px;background:#eee" oncontextmenu="document.title='right';return false">right</div>
<p id="t" style="position:absolute;left:20px;top:280px;margin:0;font:20px monospace;user-select:text" ondblclick="document.title='pdbl'">select these words</p>
<a id="l" href="/second" target="_blank" style="position:absolute;left:20px;top:200px">new tab</a>
<form onsubmit="document.title='submitted:'+document.getElementById('q').value;return false" style="position:absolute;left:400px;top:20px"><input id="f" style="width:200px;height:30px"></form>
<div style="height:4000px"></div>
<script>window.n=0;document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='k')document.title='ctrl-k'})</script>
</body></html>`;

let server: ReturnType<typeof Bun.serve>;
let screen: CdpScreen;
let base: string;

async function evalJs(expr: string) {
  // @ts-expect-error private access is fine in a test
  const s = screen.sessions.get(screen.active);
  // @ts-expect-error private
  const r = await screen.conn.send("Runtime.evaluate", { expression: expr, returnByValue: true }, s);
  return r.result.value;
}
async function until(fn: () => Promise<boolean>, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn().catch(() => false)) return;
    await Bun.sleep(50);
  }
  throw new Error("condition not met");
}

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch: (req) => new Response(new URL(req.url).pathname === "/second" ? "<title>second</title><body>second page</body>" : PAGE, { headers: { "content-type": "text/html" } }),
  });
  base = `http://127.0.0.1:${server.port}`;
  const dir = mkdtempSync(`${tmpdir()}/scut-cdp-`);
  screen = new CdpScreen(dir, `${base}/`);
  await screen.start();
  await until(async () => (await screen.currentUrl()) === `${base}/`);
}, 60_000);

afterAll(() => {
  screen?.stop();
  server?.stop(true);
});

test("xdotool key syntax parses into DevTools key events", () => {
  expect(parseCombo("Return")).toEqual({ modifiers: 0, key: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" } });
  expect(parseCombo("ctrl+a")).toMatchObject({ modifiers: 2, key: { key: "a", code: "KeyA", keyCode: 65 } });
  expect(parseCombo("ctrl+shift+t")).toMatchObject({ modifiers: 10, key: { key: "T", code: "KeyT" } });
  expect(parseCombo("alt+Left")).toMatchObject({ modifiers: 1, key: { key: "ArrowLeft" } });
  expect(parseCombo("Page_Down").key?.key).toBe("PageDown");
  expect(parseCombo("F5").key?.key).toBe("F5");
  expect(parseCombo("shift").key?.key).toBe("Shift");
  expect(() => parseCombo("NoSuchKey")).toThrow("unknown key");
});

test("live frames and a PNG screenshot of the 1280x800 screen", async () => {
  await until(async () => !!screen.latest);
  expect(screen.latest![0]).toBe(0xff); // JPEG
  expect(screen.latest![1]).toBe(0xd8);
  const png = await screen.screenshotPng();
  expect([...png.slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
  const view = new DataView(png.buffer, png.byteOffset);
  expect([view.getUint32(16), view.getUint32(20)]).toEqual([1280, 800]);
  let got = 0;
  const l = () => got++;
  screen.frameListeners.add(l);
  await screen.act({ kind: "click", x: 30, y: 35 });
  await screen.act({ kind: "type", text: "frames" });
  await until(async () => got > 0);
  screen.frameListeners.delete(l);
});

test("click, double-click and right-click land where asked", async () => {
  await screen.act({ kind: "click", x: 80, y: 100 });
  await until(async () => (await evalJs("document.title")) === "clicked:1");
  await screen.act({ kind: "dblclick", x: 260, y: 100 });
  await until(async () => (await evalJs("document.title")) === "dbl");
  await screen.act({ kind: "click", x: 80, y: 160, button: 3 });
  await until(async () => (await evalJs("document.title")) === "right");
});

test("Take over's press, drag and release select text; presses counted 1, 2 double-click", async () => {
  // From the start of "select" to the end of "these" (12px per character in 20px monospace).
  await screen.act({ kind: "down", x: 21, y: 290, button: 1, count: 1 });
  for (const x of [60, 120, 160]) await screen.act({ kind: "move", x, y: 290 });
  await screen.act({ kind: "up", x: 160, y: 290, button: 1 });
  await until(async () => (await evalJs("String(getSelection())")) === "select these");
  await screen.act({ kind: "down", x: 200, y: 290, button: 1, count: 1 });
  await screen.act({ kind: "up", x: 200, y: 290, button: 1 });
  await screen.act({ kind: "down", x: 200, y: 290, button: 1, count: 2 });
  await screen.act({ kind: "up", x: 200, y: 290, button: 1 });
  await until(async () => (await evalJs("document.title")) === "pdbl");
});

test("typing, select-all, Return and modifier keys", async () => {
  await screen.act({ kind: "click", x: 150, y: 35 });
  await screen.act({ kind: "key", keys: "ctrl+a" });
  await screen.act({ kind: "key", keys: "BackSpace" });
  await screen.act({ kind: "type", text: "hello world" });
  await until(async () => (await evalJs("document.getElementById('q').value")) === "hello world");
  await screen.act({ kind: "key", keys: "ctrl+a" });
  await screen.act({ kind: "type", text: "replaced" });
  await until(async () => (await evalJs("document.getElementById('q').value")) === "replaced");
  await screen.act({ kind: "key", keys: "BackSpace BackSpace" });
  await until(async () => (await evalJs("document.getElementById('q').value")) === "replac");
  await screen.act({ kind: "click", x: 500, y: 35 });
  await screen.act({ kind: "type", text: "sent\n" });
  await until(async () => (await evalJs("document.title")) === "submitted:replac");
  await screen.act({ kind: "key", keys: "ctrl+k" });
  await until(async () => (await evalJs("document.title")) === "ctrl-k");
});

test("scroll moves the page", async () => {
  expect(await evalJs("scrollY")).toBe(0);
  await screen.act({ kind: "scroll", x: 600, y: 400, dy: 500 });
  await until(async () => (await evalJs("scrollY")) > 0);
  await screen.act({ kind: "scroll", x: 600, y: 400, dy: -5000 });
  await until(async () => (await evalJs("scrollY")) === 0);
});

test("a link that opens a new tab becomes the screen; ctrl+w goes back", async () => {
  await screen.act({ kind: "click", x: 40, y: 208 });
  await until(async () => (await screen.currentUrl()) === `${base}/second`);
  expect(await evalJs("document.body.innerText")).toBe("second page");
  await screen.act({ kind: "key", keys: "ctrl+w" });
  await until(async () => (await screen.currentUrl()) === `${base}/`);
});

test("open_url navigates, alt+Left goes back", async () => {
  await screen.act({ kind: "open_url", url: `${base}/second` });
  await until(async () => (await screen.currentUrl()) === `${base}/second`);
  await screen.act({ kind: "key", keys: "alt+Left" });
  await until(async () => (await screen.currentUrl()) === `${base}/`);
});

test("thumbnails are small and only while asked for", async () => {
  screen.setThumbs(true);
  await until(async () => !!screen.latestThumb, 5000);
  expect(screen.latestThumb!.length).toBeLessThan(screen.latest!.length * 2);
  screen.setThumbs(false);
  const before = screen.latestThumb;
  await Bun.sleep(1200);
  expect(screen.latestThumb).toBe(before);
});

test("the browser comes back by itself after it dies", async () => {
  // @ts-expect-error private
  screen.proc.kill(9);
  // @ts-expect-error private
  await screen.proc.exited;
  await screen.act({ kind: "open_url", url: `${base}/second` });
  await until(async () => (await screen.currentUrl()) === `${base}/second`);
  const png = await screen.screenshotPng();
  expect(png.length).toBeGreaterThan(1000);
}, 60_000);
