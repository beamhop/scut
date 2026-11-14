// Agent view shots + axe for design review: bun scripts/shoot-agent.ts <base-url> <out-prefix> [--inject-url URL]
// `--inject-url` adds `url` to the agent's status messages (for agents whose image predates StatusMsg.url).
import puppeteer, { type Page } from "puppeteer-core";

const [base = "http://127.0.0.1:7882", out = "/tmp/agent"] = process.argv.slice(2).filter((x) => !x.startsWith("--"));
const injectUrl = process.argv.includes("--inject-url") ? process.argv[process.argv.indexOf("--inject-url") + 1] : undefined;
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : undefined;
const agents = (await (await fetch(`${base}/api/agents`)).json()) as { id: string; name: string; harness: string }[];
const atlas = agents.find((a) => a.name === "Atlas")!;
const echo = agents.find((a) => a.name === "Echo");
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Record<string, unknown> = {};

async function page(o: { w?: number; h?: number; dark?: boolean; mobile?: boolean; reduced?: boolean } = {}) {
  const p = await b.newPage();
  await p.setViewport({ width: o.w ?? 1440, height: o.h ?? 900, isMobile: o.mobile, hasTouch: o.mobile });
  await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: o.dark ? "dark" : "light" }, ...(o.reduced ? [{ name: "prefers-reduced-motion", value: "reduce" }] : [])]);
  await p.evaluateOnNewDocument((dark: boolean, url?: string) => {
    localStorage.setItem("beamhop.theme", dark ? "dark" : "light");
    if (!url) return;
    const W = window.WebSocket;
    // @ts-ignore
    window.WebSocket = class extends W {
      set onmessage(fn: any) {
        super.onmessage = (ev: MessageEvent) => {
          if (typeof ev.data === "string" && ev.data.includes('"t":"status"')) {
            const m = JSON.parse(ev.data);
            m.url ??= url;
            return fn(new MessageEvent("message", { data: JSON.stringify(m) }));
          }
          return fn(ev);
        };
      }
    };
  }, !!o.dark, injectUrl);
  p.on("pageerror", (e) => console.log("pageerror", String(e)));
  p.on("console", (m) => m.type() === "error" && !/favicon|WebSocket/.test(m.text()) && console.log("console", m.text()));
  return p;
}
async function axe(p: Page, name: string) {
  await p.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
  const v = await p.evaluate(async () => (await (window as any).axe.run(document)).violations.map((v: any) => `${v.id}: ${v.nodes.map((n: any) => n.target.join(" ") + " " + (n.failureSummary ?? "").split("\n")[1]).slice(0, 2).join(" | ")}`));
  results[name] = v.length ? v : 0;
}
const click = (p: Page, text: string, scope = "button") => p.evaluate((t, s) => { const el = [...document.querySelectorAll<HTMLElement>(s)].find((x) => x.textContent?.trim() === t || x.getAttribute("aria-label") === t); el?.click(); return !!el; }, text, scope);
const go = (name: string) => !only || only.includes(name);

if (go("light")) {
  const p = await page();
  await p.goto(`${base}/#/agent/${atlas.id}`); await wait(3500);
  await p.screenshot({ path: `${out}-light.png` }); await axe(p, "light");
  await p.close();
}
if (go("dark")) {
  const p = await page({ dark: true });
  await p.goto(`${base}/#/agent/${atlas.id}`); await wait(3500);
  await p.screenshot({ path: `${out}-dark.png` }); await axe(p, "dark");
  await p.close();
}
if (go("approval")) {
  for (const dark of [false, true]) {
    const p = await page({ dark });
    await p.goto(`${base}/#/agent/${atlas.id}`); await p.waitForSelector('textarea[aria-label^="Message"]'); await wait(1500);
    if (!dark) {
      await p.type('textarea[aria-label^="Message"]', "Compare e-bike prices on https://shop.example.com/checkout");
      await p.keyboard.press("Enter");
    }
    await p.waitForSelector("[data-approval]", { timeout: 30_000 }); await wait(1200);
    await p.screenshot({ path: `${out}-approval-at-screen${dark ? "-dark" : ""}.png` }); await axe(p, `approval${dark ? "-dark" : ""}`);
    if (dark) {
      // answer with the keyboard: Don't, and check where focus lands
      await p.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("[data-approval] button")].find((x) => x.textContent === "Don't")!.focus());
      await p.keyboard.press("Enter"); await wait(400);
      // a reason picker may appear (fixer 1): send without one
      await p.evaluate(() => { const b = [...document.querySelectorAll<HTMLButtonElement>("[data-approval] button")].find((x) => /^(Send|Don't|Skip|No reason)/.test(x.textContent ?? "") && x.textContent !== "Don't"); b?.click(); });
      await wait(800);
      results["focus-after-deny"] = await p.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.getAttribute("data-approval") ?? ""}`);
      await wait(1500);
      await p.screenshot({ path: `${out}-after-deny.png` });
    }
    await p.close();
  }
}
if (go("driving")) {
  const p = await page();
  await p.goto(`${base}/#/agent/${atlas.id}`); await wait(3000);
  await click(p, "Take over"); await wait(1500);
  await p.keyboard.press("Escape"); await wait(100); await p.keyboard.press("Escape"); await wait(800);
  await p.screenshot({ path: `${out}-driving.png` }); await axe(p, "driving");
  results["driving-headline"] = await p.evaluate(() => document.querySelector("main .text-h3")?.textContent);
  await click(p, "Give back to Atlas"); await wait(800);
  await p.close();
}
if (go("settings")) {
  const p = await page();
  await p.goto(`${base}/#/agent/${atlas.id}`); await wait(3000);
  await p.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("header button")].find((x) => x.textContent === "Settings")!.click()); await wait(1000);
  await p.screenshot({ path: `${out}-settings.png` }); await axe(p, "settings");
  await p.close();
}
if (go("problem") && echo) {
  for (const dark of [false]) {
    const p = await page({ dark });
    await p.goto(`${base}/#/agent/${echo.id}`); await wait(3500);
    await p.screenshot({ path: `${out}-no-brain.png` }); await axe(p, "no-brain");
    results["no-brain-shield"] = await p.evaluate(() => [...document.querySelectorAll("header button")].map((x) => x.textContent).join(" | "));
    // the bench's "Add a brain" links to #/agent/<id>?settings=brain: Settings opens at Brain with the form open
    const q = await page({ dark });
    await q.goto(`${base}/#/agent/${echo.id}?settings=brain`); await wait(3500);
    results["no-brain-settings-hash"] = await q.evaluate(() => location.hash);
    await q.screenshot({ path: `${out}-no-brain-settings.png` }); await axe(q, "no-brain-settings");
    await q.close();
    // and the fix button in the headline does the same
    await click(p, "Add a brain", "main button"); await wait(1200);
    results["fix-button-opens"] = await p.evaluate(() => !!document.querySelector('input[aria-label$="API key"]'));
    await p.close();
  }
}
if (go("phonelink")) {
  const p = await page();
  await p.goto(`${base}/#/agent/${atlas.id}`); await wait(3000);
  await click(p, "Open Atlas on your phone"); await wait(1000);
  await p.screenshot({ path: `${out}-phone-link.png` }); await axe(p, "phone-link");
  await p.close();
}
if (go("zoom")) {
  const p = await page({ w: 720, h: 450 });
  await p.goto(`${base}/#/agent/${atlas.id}`); await wait(3500);
  results["zoom-h1"] = await p.$eval("h1", (h) => `${h.textContent} scroll ${h.scrollWidth} client ${h.clientWidth}`);
  await p.screenshot({ path: `${out}-zoom200.png` }); await axe(p, "zoom200");
  await p.screenshot({ path: `${out}-zoom200-full.png`, fullPage: true });
  await p.close();
}
if (go("phone-approval")) {
  for (const [w, h, name] of [[390, 844, "phone-approval"], [720, 450, "zoom200-approval"]] as const) {
    const p = await page({ w, h, mobile: w < 400 });
    await p.goto(`${base}/#/agent/${atlas.id}`); await p.waitForSelector('textarea[aria-label^="Message"]'); await wait(1500);
    if (!(await p.$("[data-approval]"))) {
      await p.type('textarea[aria-label^="Message"]', "Compare e-bike prices on https://shop.example.com/checkout");
      await p.keyboard.press("Enter");
    }
    await p.waitForSelector("[data-approval]", { timeout: 30_000 }); await wait(1200);
    await p.screenshot({ path: `${out}-${name}.png` }); await axe(p, name);
    await p.close();
  }
}
if (go("phone")) {
  const p = await page({ w: 390, h: 844, mobile: true });
  await p.goto(`${base}/#/agent/${atlas.id}`); await wait(3500);
  await p.screenshot({ path: `${out}-phone.png` }); await axe(p, "phone");
  await p.close();
}
await b.close();
console.log(JSON.stringify(results, null, 1));
