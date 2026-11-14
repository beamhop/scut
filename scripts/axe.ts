import puppeteer from "puppeteer-core";
const base = process.argv[2];
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: true });
const agents = await (await fetch(`${base}/api/agents`)).json();
const pages: [string, (p: any) => Promise<void>][] = [
  ["home", async () => {}],
  ["new-agent", async (p) => { await p.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("New agent"))!.click()); await new Promise((r) => setTimeout(r, 800)); }],
  ["add-cloud", async (p) => { await p.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Add a cloud"))!.click()); await new Promise((r) => setTimeout(r, 800)); }],
  ["agent", async (p) => { await p.goto(`${base}/#/agent/${agents[0].id}`); await new Promise((r) => setTimeout(r, 2500)); }],
  ["settings", async (p) => { await p.goto(`${base}/#/agent/${agents[0].id}`); await new Promise((r) => setTimeout(r, 2500)); await p.evaluate(() => [...document.querySelectorAll("header button")].find((x) => x.textContent === "Settings")!.click()); await new Promise((r) => setTimeout(r, 800)); }],
];
for (const [name, go] of pages) {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto(base); await new Promise((r) => setTimeout(r, 2500));
  await go(p);
  await p.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
  const r = await p.evaluate(async () => ((r: any) => (console.log("passes", r.passes.length), r))(await (window as any).axe.run(document)).violations.map((v: any) => ({ id: v.id, impact: v.impact, n: v.nodes.length, ex: v.nodes.slice(0, 3).map((x: any) => x.target.join(" ") + " :: " + (x.failureSummary ?? "").split("\n")[1]?.slice(0, 120)) })));
  console.log("==", name, JSON.stringify(r, null, 1));
  await p.close();
}
await b.close();
