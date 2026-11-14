// Screenshots of the bench (home) for design review, plus axe.
// Usage: bun scripts/shoot-bench.ts http://127.0.0.1:7811 [outDir] [--ask "Atlas:Compare prices on https://www.bol.com"]… [--name v060-bench] [--beam Atlas:sim-cloud]
// --ask sets the agent to "Ask first" and sends it a message, so a real approval shows up in the tray.
import puppeteer from "puppeteer-core";
const args = process.argv.slice(2);
const base = args[0] ?? "http://127.0.0.1:7811";
const out = args[1] && !args[1].startsWith("--") ? args[1] : "research/shots";
const opt = (k: string) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const name = opt("--name")[0] ?? "v060-bench";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const agents: any[] = await (await fetch(`${base}/api/agents`)).json();
for (const spec of opt("--ask")) {
  const [who, text] = [spec.slice(0, spec.indexOf(":")), spec.slice(spec.indexOf(":") + 1)];
  const a = agents.find((x) => x.name === who);
  if (!a) continue;
  const ws = new WebSocket(`${a.current.endpoint.replace(/^http/, "ws")}/ws?auth=${a.token}`);
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ t: "settings", autonomy: "ask" }));
  ws.send(JSON.stringify({ t: "chat", text }));
  await sleep(400);
  ws.close();
}
if (opt("--ask").length) await sleep(2500);

const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--font-render-hinting=none"], headless: true });
async function shot(theme: "light" | "dark", width: number, file: string, act?: (p: any) => Promise<void>) {
  const p = await b.newPage();
  await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  await p.setViewport({ width, height: width < 600 ? 844 : 960, deviceScaleFactor: width < 600 ? 2 : 1, isMobile: width < 600 });
  if (args.includes("--fakefly")) {
    // Pretend Fly.io is connected (for the paid-destination confirm bar) without a real token.
    await p.setRequestInterception(true);
    p.on("request", async (r: any) => {
      if (!r.url().endsWith("/api/destinations")) return r.continue();
      const real = await (await fetch(`${base}/api/destinations`)).json();
      r.respond({ status: 200, contentType: "application/json", body: JSON.stringify([...real, { id: "fly", label: "Fly.io", isolation: "vm", monthlyUsd: 21.4 }]) });
    });
  }
  await p.goto(`${base}/`, { waitUntil: "networkidle2" });
  await p.evaluate(() => document.fonts.ready);
  await sleep(3500);
  if (act) await act(p);
  await p.evaluate(() => scrollTo(0, 0));
  await p.screenshot({ path: `${out}/${file}`, fullPage: true });
  console.log("wrote", `${out}/${file}`);
  await p.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
  const v = await p.evaluate(async () => (await (window as any).axe.run(document)).violations.map((v: any) => ({ id: v.id, n: v.nodes.length, ex: v.nodes.slice(0, 3).map((x: any) => x.target.join(" ") + " :: " + (x.failureSummary ?? "").split("\n").slice(1, 2).join(" ").slice(0, 160)) })));
  console.log(`  axe ${theme} ${width}:`, v.length ? JSON.stringify(v, null, 1) : "0 violations");
  await p.close();
}

const beam = opt("--beam")[0];
if (beam) {
  const [who, to] = beam.split(":");
  await shot("light", 1440, `${name}-${args.includes("--fakefly") ? "confirm" : "beam"}.png`, async (p) => {
    await p.evaluate((w: string) => { const u = [...document.querySelectorAll<HTMLElement>("main article[data-unit]")].find((t) => t.querySelector("h3")?.textContent?.startsWith(w))!; u.focus(); }, who);
    await p.keyboard.press("b");
    await sleep(300);
    await p.screenshot({ path: `${out}/${name}-beam-menu.png` });
    console.log("wrote", `${out}/${name}-beam-menu.png`);
    await p.evaluate((t: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((m) => m.textContent?.startsWith(t))!.click(), to);
    await sleep(1200);
    if (args.includes("--fakefly")) return;
    await p.screenshot({ path: `${out}/${name}-beam-undo.png`, fullPage: true });
    await sleep(8000); // in flight: ghost in the target dock, source dimmed
  });
} else if (args.includes("--extras")) {
  const click = (p: any, t: string) => p.evaluate((t: string) => [...document.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent?.trim() === t)!.click(), t);
  await shot("light", 1440, `${name}-crew.png`, async (p) => { await click(p, "Talk to all agents"); await sleep(2500); });
  await shot("dark", 1440, `${name}-addcloud.png`, async (p) => { await click(p, "Add a cloud"); await sleep(500); });
  await shot("light", 1440, `${name}-palette.png`, async (p) => { await p.keyboard.down("Control"); await p.keyboard.press("k"); await p.keyboard.up("Control"); await sleep(300); await p.keyboard.type("move sco"); await sleep(300); });
  await shot("light", 1440, `${name}-export.png`, async (p) => { await p.evaluate(() => dispatchEvent(new CustomEvent("beamhop:export", { detail: (document.querySelector("main article[data-unit]") as HTMLElement).dataset.unit }))); await sleep(500); });
} else {
  for (const theme of ["light", "dark"] as const) await shot(theme, 1440, `${name}-${theme}.png`);
  await shot("light", 390, `${name}-phone.png`);
}
await b.close();
