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
