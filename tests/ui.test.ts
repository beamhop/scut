// UI tests in real Chrome (puppeteer-core): no console errors, key flows render and work.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

process.env.SCUT_HOME = mkdtempSync(`${tmpdir()}/scut-ui-`);
process.env.SCUT_SIM_CLOUD = "1";
process.env.SCUT_LOCAL_DRIVER = "docker";
process.env.SCUT_IMAGE ??= "ghcr.io/beamhop/scut-agent:dev";
// Mock Fly Machines API for the add-a-cloud flow: token "good" is valid.
const fly = Bun.serve({ port: 0, fetch: (req) => (req.headers.get("authorization") === "Bearer good" ? Response.json([]) : new Response("unauthorized", { status: 401 })) });
process.env.SCUT_FLY_API = `http://127.0.0.1:${fly.port}/v1`;
// Mock OpenAI-compatible endpoint for the brain check: key "good" works, anything else is rejected.
const llm = Bun.serve({ port: 0, fetch: (req) => (req.headers.get("authorization") === "Bearer good" ? Response.json({ data: [{ id: "m1" }] }) : Response.json({ error: "bad key" }, { status: 401 })) });
const { Scut } = await import("../apps/app/src/core.ts");
const { serve } = await import("../apps/app/src/server.ts");

let scut: InstanceType<typeof Scut>;
let browser: Browser;
let base = "";
let agentId = "";
const errors: string[] = [];

async function open(path: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/favicon/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  return page;
}

beforeAll(async () => {
  scut = await Scut.open();
  const server = serve(scut, 0, new URL("../packages/ui/dist", import.meta.url).pathname);
  base = `http://127.0.0.1:${server.port}`;
  browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: true });
});
afterAll(async () => {
  await browser?.close();
  fly.stop(true);
  llm.stop(true);
  for (const a of [...scut.agents]) await scut.remove(a.id).catch(() => {});
});

test("first run shows the guided setup", async () => {
  const page = await open("/");
  await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
  const text = await page.$eval('[role="dialog"]', (el) => el.textContent ?? "");
  expect(text).toContain("Welcome to Beamhop");
  expect(text).toContain("Pick a brain");
  await page.close();
});

test("the brain step checks the key before moving on", async () => {
  const page = await open("/");
  await page.waitForSelector('input[aria-label="API key"]', { timeout: 10_000 });
  const clickBtn = (t: string) => page.evaluate((t) => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === t)!.dispatchEvent(new MouseEvent("click", { bubbles: true })), t);
  // Picking local models looks for Ollama right away and explains what's missing
  await clickBtn("Local (Ollama)");
  await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes("Ollama isn't running"), { timeout: 15_000 });
  await clickBtn("OpenRouter");
  await page.evaluate(() => document.querySelector("details")!.setAttribute("open", ""));
  const setVal = async (label: string, v: string) => {
    await page.focus(`input[aria-label="${label}"]`);
    await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.type(`input[aria-label="${label}"]`, v);
  };
  await setVal("Base URL", `http://127.0.0.1:${llm.port}/v1`);
  await setVal("Model", "m1");
  await setVal("API key", "bad");
  await clickBtn("Next");
  await page.waitForSelector('[role="alert"]', { timeout: 15_000 });
  expect(await page.$eval('[role="alert"]', (e) => e.textContent)).toContain("rejected");
  expect(await page.evaluate(() => document.body.textContent!.includes("Continue anyway"))).toBe(true);
  await setVal("API key", "good");
  await setVal("Model", "zzz");
  await clickBtn("Next");
  await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes("isn't offered"), { timeout: 15_000 });
  expect(await page.$$eval("#model-options option", (o) => o.map((x) => (x as HTMLOptionElement).value))).toEqual(["m1"]);
  await setVal("Model", "m1");
  await clickBtn("Next");
  await page.waitForFunction(() => document.body.textContent!.includes("What should your agent do?"), { timeout: 15_000 });
  await page.close();
});

test("crew grid shows a live tile with state and location", async () => {
  const rec = await scut.create({ name: "Gridy", harness: "mock" });
  agentId = rec.id;
  const page = await open("/");
  await page.waitForFunction(() => document.body.innerText.includes("Gridy"), { timeout: 15_000 });
  await page.waitForSelector("main img", { timeout: 15_000 }); // a live frame arrived
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).toContain("THIS COMPUTER");
  expect(text).toContain("Ready");
  await page.close();
});

test("Beam to… menu works without dragging (WCAG 2.5.7)", async () => {
  const page = await open("/");
  await page.waitForFunction(() => document.body.innerText.includes("Gridy"), { timeout: 15_000 });
  await page.focus('main [tabindex="0"]');
  await page.keyboard.press("b");
  await page.waitForSelector('[role="menu"]', { timeout: 5000 });
  const items = await page.$$eval('[role="menuitem"]', (els) => els.map((e) => e.textContent));
  expect(items.join(" ")).toContain("Cloud (simulated)");
  const target = await page.$$('[role="menuitem"]:not([disabled])');
  await target[0].click();
  await page.waitForFunction(() => document.body.innerText.includes("CLOUD (SIMULATED)"), { timeout: 60_000 });
  await page.close();
  expect(scut.get(agentId).current.driver).toBe("sim-cloud");
});

test("agent view: chat round trip, settings panel, history", async () => {
  const page = await open(`/#/agent/${agentId}`);
  await page.waitForSelector('input[aria-label^="Message"]', { timeout: 15_000 });
  await page.type('input[aria-label^="Message"]', "hello from the UI test");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.body.innerText.includes("mock: message #1"), { timeout: 30_000 });
  await page.evaluate(() => [...document.querySelectorAll("header button")].find((b) => b.textContent === "Settings")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForFunction(() => document.body.textContent!.includes("Autonomy"), { timeout: 5000 });
  await page.waitForFunction(() => /Safety: (all good|\d+ things? to look at)/.test(document.body.textContent!), { timeout: 5000 });
  expect(await page.evaluate(() => document.body.textContent!.includes("end-to-end encrypted") || document.body.textContent!.includes("Safety: all good"))).toBe(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("hello from the UI test"), { timeout: 15_000 }); // history replay
  await page.screenshot({ path: `${process.env.SCUT_SHOTS ?? tmpdir()}/ui-test-agent.png` });
  await page.close();
});

test("phone link opens the agent alone on a phone-sized screen, signed in", async () => {
  const link = await (await fetch(`${base}/api/agents/${agentId}/phone`)).json();
  expect(link.url).toContain("?auth=");
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(link.url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("Gridy"), { timeout: 20_000 });
  expect(page.url()).not.toContain("auth="); // token moved out of the address bar
  await page.waitForSelector('input[aria-label^="Message"]');
  await page.type('input[aria-label^="Message"]', "from my phone");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.body.innerText.includes("mock: message #2"), { timeout: 30_000 });
  await page.screenshot({ path: `${process.env.SCUT_SHOTS ?? tmpdir()}/ui-test-phone.png` });
  await page.close();
});

test("create an agent through the UI (Demo harness)", async () => {
  const page = await open("/");
  await page.waitForFunction(() => document.body.innerText.includes("New agent"), { timeout: 10_000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "+ New agent")!.click());
  await page.waitForSelector('[role="dialog"]');
  // With no brain saved it starts at "Pick a brain" (the demo needs none: skip); with one, it goes straight to the details.
  await Bun.sleep(1000); // let the saved-brain lookup settle
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === "Skip this")?.click());
  await page.waitForSelector('[aria-label="Name"]');
  await page.type('[aria-label="Name"]', "Uiborn");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === "Demo")!.click());
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.startsWith("Create agent"))!.click());
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]') && document.body.innerText.includes("Uiborn"), { timeout: 90_000 });
  await page.close();
  expect(scut.agents.find((a) => a.name === "Uiborn")).toBeTruthy();
});

test("add a cloud: wrong token shows an error, right token adds a destination", async () => {
  const page = await open("/");
  await page.waitForFunction(() => document.body.innerText.includes("Add a cloud"), { timeout: 10_000 }).catch(async (e) => {
    await page.screenshot({ path: `${tmpdir()}/debug-addcloud.png` });
    console.log("DEBUG body:", (await page.evaluate(() => document.body.innerText)).slice(0, 300));
    throw e;
  });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Add a cloud"))!.click());
  await page.waitForSelector('[aria-label="Fly.io token"]');
  await page.type('[aria-label="Fly.io token"]', "bad");
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Add a cloud"] button')].find((b) => b.textContent === "Connect")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForFunction(() => document.body.innerText.includes("rejected that token"), { timeout: 10_000 }).catch(async (e) => {
    console.log("DEBUG dialog text:", await page.$eval('[role="dialog"]', (d) => d.textContent));
    throw e;
  });
  await page.focus('[aria-label="Fly.io token"]');
  for (let i = 0; i < 5; i++) await page.keyboard.press("Backspace");
  await page.type('[aria-label="Fly.io token"]', "good");
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Add a cloud"] button')].find((b) => b.textContent === "Connect")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForFunction(() => !document.querySelector('[aria-label="Add a cloud"]') && [...document.querySelectorAll(".fixed div.font-semibold")].some((d) => d.textContent === "Fly.io"), { timeout: 10_000 }).catch(async (e) => {
    console.log("DEBUG2:", (await page.evaluate(() => document.body.innerText)).slice(-900), "\nDESTS:", await (await fetch(`${base}/api/destinations`)).text());
    throw e;
  });
  await page.close();
  expect(scut.drivers.has("fly")).toBe(true);
});

test("no console errors on any page", () => {
  expect(errors).toEqual([]);
});

test("no accessibility violations on the main screens (axe-core, all rules)", async () => {
  const axePath = new URL("../node_modules/axe-core/axe.min.js", import.meta.url).pathname;
  const run = (page: Page) => page.evaluate(async () => (await (window as any).axe.run(document)).violations.map((v: any) => `${v.id}: ${v.nodes.map((n: any) => `${n.target.join(" ")} ${n.failureSummary ?? ""}`.slice(0, 300)).slice(0, 3).join(" | ")}`));
  // Screens change on their own (frames, toasts, beams finishing); a violation must still be there a moment later to count.
  const audit = async (page: Page) => {
    await page.addScriptTag({ path: axePath });
    const first = await run(page);
    if (!first.length) return first;
    console.log("axe (transient?):", first);
    await Bun.sleep(2000);
    return run(page);
  };
  const home = await open("/");
  await home.waitForFunction(() => document.body.innerText.includes("Gridy"), { timeout: 15_000 });
  await Bun.sleep(1500);
  expect(await audit(home)).toEqual([]);
  await home.close();
  const view = await open(`/#/agent/${agentId}`);
  await view.waitForSelector('input[aria-label^="Message"]', { timeout: 15_000 });
  expect(await audit(view)).toEqual([]);
  await view.evaluate(() => [...document.querySelectorAll("header button")].find((b) => b.textContent === "Settings")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await view.waitForFunction(() => document.body.textContent!.includes("Autonomy"), { timeout: 5000 });
  expect(await audit(view)).toEqual([]);
  await view.close();
});

test("the local API refuses other websites (CSRF, DNS rebinding) and can't be framed", async () => {
  const csrf = await fetch(`${base}/api/providers`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "text/plain" }, body: JSON.stringify({ id: "fly", token: "x" }) });
  expect(csrf.status).toBe(403);
  const rebound = await fetch(`${base}/api/agents`, { headers: { host: "evil.example" } });
  expect(rebound.status).toBe(403);
  const crossSite = await fetch(`${base}/api/agents`, { headers: { "sec-fetch-site": "cross-site" } });
  expect(crossSite.status).toBe(403);
  const ok = await fetch(`${base}/api/agents`, { headers: { origin: base } });
  expect(ok.status).toBe(200);
  expect(ok.headers.get("x-frame-options")).toBe("DENY");
  // and the real UI still works from its own origin (POST from the page)
  const page = await open("/");
  const r = await page.evaluate(async () => (await fetch("/api/brain/verify", { method: "POST", body: JSON.stringify({ api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1", model: "x" }) })).status);
  expect(r).toBe(200);
  await page.close();
});

test("move an agent to a file and open it again, all from the UI", async () => {
  const rec = await scut.create({ name: "Packy", harness: "mock" });
  const dir = mkdtempSync(`${tmpdir()}/scut-dl-`);
  const page = await open("/");
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir });
  await page.waitForFunction(() => document.body.innerText.includes("Packy"), { timeout: 20_000 });
  await page.evaluate(() => {
    const tile = [...document.querySelectorAll<HTMLElement>('main [tabindex="0"]')].find((t) => t.innerText.includes("Packy"))!;
    [...tile.querySelectorAll("button")].find((b) => b.textContent === "Beam to…")!.click();
  });
  await page.waitForSelector('[role="menuitem"]');
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.startsWith("A file"))!.click());
  await page.waitForSelector('[aria-label="Move Packy to a file"]');
  await page.type('[aria-label="Move Packy to a file"] input[aria-label="Passphrase"]', "packy-pass-123");
  await page.type('[aria-label="Repeat passphrase"]', "packy-pass-123");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === "Move to file")!.click());
  await page.waitForFunction(() => document.body.innerText.includes("is now in Packy.beamhop"), { timeout: 60_000 });
  const saved = `${dir}/Packy.beamhop`;
  for (let i = 0; i < 50 && !(await Bun.file(saved).exists()); i++) await Bun.sleep(200);
  expect(await Bun.file(saved).exists()).toBe(true);
  expect(scut.agents.find((a) => a.id === rec.id)).toBeUndefined();
  // open it again
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Open an agent file")!.click());
  await page.waitForSelector('input[aria-label="Agent file"]');
  const input = (await page.$('input[aria-label="Agent file"]'))!;
  await (input as any).uploadFile(saved);
  await page.type('[aria-label="Open an agent file"] input[aria-label="Passphrase"]', "nope-wrong");
  const clickOpen = () => page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === "Open")!.click());
  await clickOpen();
  await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes("Wrong passphrase"), { timeout: 30_000 });
  await page.evaluate(() => { const i = document.querySelector<HTMLInputElement>('[aria-label="Open an agent file"] input[aria-label="Passphrase"]')!; i.focus(); i.select(); });
  await page.keyboard.press("Backspace");
  await page.type('[aria-label="Open an agent file"] input[aria-label="Passphrase"]', "packy-pass-123");
  await clickOpen();
  await page.waitForFunction(() => document.body.innerText.includes("Packy is here."), { timeout: 120_000 });
  expect(scut.agents.find((a) => a.id === rec.id)).toBeTruthy();
  await page.close();
});

test("remove an agent from Settings (two steps)", async () => {
  const rec = await scut.create({ name: "Byebye", harness: "mock" });
  const page = await open(`/#/agent/${rec.id}`);
  await page.waitForSelector('input[aria-label^="Message"]', { timeout: 20_000 });
  const click = (t: string) => page.evaluate((t) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === t)!.click(), t);
  await click("Settings");
  await page.waitForFunction(() => document.body.textContent!.includes("Remove Byebye…"), { timeout: 5000 });
  await click("Remove Byebye…");
  await page.waitForSelector('[role="alertdialog"]');
  await click("Keep Byebye");
  expect(scut.agents.find((a) => a.id === rec.id)).toBeTruthy();
  await click("Remove Byebye…");
  await click("Remove for good");
  await page.waitForFunction(() => location.hash === "" && !document.body.innerText.includes("Byebye"), { timeout: 30_000 });
  expect(scut.agents.find((a) => a.id === rec.id)).toBeUndefined();
  await page.close();
});
