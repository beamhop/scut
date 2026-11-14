// Screenshots + axe for the Settings drawer and the Create flow.
// Usage: bun scripts/shoot-settings-create.ts <empty-home-url> <home-with-agents-url> [outDir] [agentId]
//   empty home → first run / create steps; home with agents → the agent view with Settings open (440 px drawer).
import puppeteer, { type Page } from "puppeteer-core";
const [emptyBase = "http://127.0.0.1:7833", agentsBase = "http://127.0.0.1:7834", out = "research/shots", agentArg] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox", "--font-render-hinting=none"], headless: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const axe = async (p: Page, sel = "body") => {
  await p.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
  return p.evaluate(async (s) => (await (window as any).axe.run(document.querySelector(s))).violations.map((v: any) => `${v.id}: ${v.nodes.slice(0, 3).map((n: any) => n.target.join(" ") + " " + (n.failureSummary ?? "").split("\n")[1]).join(" | ")}`), sel);
};
async function page(base: string, theme: "light" | "dark", w = 1440, h = 900, prefetch?: unknown) {
  const p = await b.newPage();
  await p.setViewport({ width: w, height: h, deviceScaleFactor: w < 500 ? 2 : 1 });
  p.on("pageerror", (e) => console.log("pageerror:", String(e)));
  await p.evaluateOnNewDocument((t) => localStorage.setItem("beamhop-theme", t), theme);
  if (prefetch) {
    await p.setRequestInterception(true);
    p.on("request", (r) => (r.url().endsWith("/api/prefetch") ? r.respond({ contentType: "application/json", body: JSON.stringify(prefetch) }) : r.continue()));
  }
  await p.goto(base, { waitUntil: "networkidle0" });
  await p.evaluate(() => document.fonts.ready);
  return p;
}
const clickBtn = (p: Page, t: string) => p.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.textContent === t)!.click(), t);
const pick = (p: Page, t: string) => p.evaluate((t) => [...document.querySelectorAll("label")].find((l) => l.textContent?.startsWith(t))!.click(), t);
const dialogShot = async (p: Page, path: string) => {
  const el = (await p.$('[role="dialog"]')) ?? (await p.$("main"));
  await el!.screenshot({ path });
  console.log("wrote", path);
};

// ---------- create ----------
for (const theme of ["light", "dark"] as const) {
  const sfx = theme === "dark" ? "-dark" : "";
  const p = await page(emptyBase, theme, 1440, 900, { state: "pulling", done: 11, total: 27 });
  await p.waitForFunction(() => document.body.textContent!.includes("What should your agent do?"), { timeout: 10_000 });
  await sleep(500);
  if (theme === "light") { await p.screenshot({ path: `${out}/v060-firstrun.png` }); console.log("wrote firstrun"); console.log("axe firstrun:", await axe(p)); }
  await p.type('textarea[aria-label="Describe the job"]', "Keep an eye on my inbox and draft replies for me to approve");
  await p.type('input[aria-label="Name"]', "Atlas");
  await dialogShot(p, `${out}/v060-create-1${sfx}.png`);
  await clickBtn(p, "Next"); await sleep(300);
  await pick(p, "OpenRouter"); await sleep(200);
  await p.type('input[aria-label="API key"]', "sk-or-v1-not-a-real-key");
  await sleep(200);
  await dialogShot(p, `${out}/v060-create-2${sfx}.png`);
  if (theme === "light") console.log("axe step 2:", await axe(p));
  await clickBtn(p, "Next");
  await p.waitForFunction(() => document.querySelector('[role="alert"]') || document.body.textContent!.includes("Ready to create"), { timeout: 15_000 });
  if (await p.$('[role="alert"]')) {
    await dialogShot(p, `/tmp/v060-create-2-error${sfx}.png`);
    await clickBtn(p, "Continue anyway");
  }
  await p.waitForFunction(() => document.body.textContent!.includes("Ready to create"), { timeout: 5000 });
  await p.type('textarea[aria-label="First task"]', "Summarise my unread email from today");
  await sleep(300);
  await dialogShot(p, `${out}/v060-create-3${sfx}.png`);
  if (theme === "light") console.log("axe step 3:", await axe(p));
  await p.close();
}
// phone
{
  const p = await page(emptyBase, "light", 390, 844);
  await p.waitForFunction(() => document.body.textContent!.includes("What should your agent do?"), { timeout: 10_000 });
  await sleep(400);
  await p.screenshot({ path: `${out}/v060-create-phone-1.png` });
  await clickBtn(p, "Next"); await sleep(300);
  await pick(p, "Use my ChatGPT"); await sleep(300);
  await p.screenshot({ path: `${out}/v060-create-phone-2.png` });
  console.log("wrote phone; axe:", await axe(p));
  await p.close();
}

// ---------- settings ----------
const agents = await (await fetch(`${agentsBase}/api/agents`)).json();
const ag = agents.find((a: any) => a.id === agentArg) ?? agents.find((a: any) => a.price) ?? agents[0];
if (process.env.SEED) {
  // Give the drawer something to show: a job, memories, a routine (+ a run), a chat app that needs attention.
  const t = await (await fetch(`${agentsBase}/api/agents/${ag.id}/token`)).json();
  const ws = new WebSocket(`${t.endpoint.replace(/^http/, "ws")}/ws?auth=${t.token}`);
  await new Promise((r) => (ws.onopen = r));
  const send = (m: unknown) => ws.send(JSON.stringify(m));
  send({ t: "settings", persona: "Keep an eye on my inbox and draft replies for me to approve. Summarise newsletters once a day." });
  for (const text of ["Prefers replies in Dutch", "Works at the Almere office on Tuesdays", "Partner's birthday is 12 March"]) send({ t: "memory", op: "add", text });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  send({ t: "schedules", schedules: [
    { id: "hn", prompt: "Send me the top 3 Hacker News stories", kind: "daily", minuteOfDay: 8 * 60, enabled: true, createdAt: Date.now(), tz },
    { id: "inbox", prompt: "Check my inbox for anything urgent", kind: "every", minutes: 120, enabled: true, createdAt: Date.now() },
  ] });
  send({ t: "run_schedule", id: "inbox" });
  send({ t: "settings", channels: { telegram: { token: "123456:not-a-real-token" } } });
  await sleep(6000);
  ws.close();
}
for (const theme of ["light", "dark"] as const) {
  const p = await page(`${agentsBase}/#/agent/${ag.id}`, theme, 1440, 1000);
  await sleep(2500);
  await p.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("header button")].find((b) => b.textContent === "Settings" || b.getAttribute("aria-label") === "Settings")!.click());
  await p.waitForFunction(() => document.body.textContent!.includes("Autonomy"), { timeout: 8000 });
  await sleep(600);
  const dlg = await p.$('[role="dialog"]');
  // the whole drawer body, unscrolled: grow the drawer to its content height for the shot
  await p.evaluate(() => {
    const d = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const body = d.querySelector<HTMLElement>(".overflow-y-auto")!;
    const h = body.scrollHeight + 140;
    let el: HTMLElement | null = d;
    while (el && el !== document.body) { el.style.height = `${h}px`; el.style.maxHeight = "none"; el.style.overflow = "visible"; el = el.parentElement; }
    body.style.overflow = "visible";
  });
  const h = await p.evaluate(() => document.querySelector<HTMLElement>('[role="dialog"]')!.scrollHeight);
  await p.setViewport({ width: 1440, height: Math.max(1000, h + 120) });
  await sleep(400);
  await dlg!.screenshot({ path: `${out}/v060-settings-${theme}.png` });
  console.log("wrote settings", theme);
  if (theme === "light") console.log("axe settings:", await axe(p));
  await p.close();
}
// phone settings
{
  const p = await page(`${agentsBase}/#/agent/${ag.id}`, "light", 390, 844);
  await sleep(2500);
  const opened = await p.evaluate(() => { const b = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Settings" || b.getAttribute("aria-label") === "Settings"); b?.click(); return !!b; });
  if (opened) {
    await p.waitForFunction(() => document.body.textContent!.includes("Autonomy"), { timeout: 8000 }).catch(() => {});
    await sleep(600);
    await p.screenshot({ path: `${out}/v060-settings-phone.png` });
    console.log("wrote settings phone; axe:", await axe(p));
  }
  await p.close();
}
await b.close();
