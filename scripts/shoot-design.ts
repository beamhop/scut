// Screenshot the #/design reference page (light half and dark half) and run axe on it.
// Usage: bun scripts/shoot-design.ts http://127.0.0.1:7801 [outDir]
import puppeteer from "puppeteer-core";
const base = process.argv[2] ?? "http://127.0.0.1:7801";
const out = process.argv[3] ?? "research/shots";
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--font-render-hinting=none"], headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await p.goto(`${base}/#/design`, { waitUntil: "networkidle0" });
await p.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 700));
const fonts = await p.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family));
console.log("fonts loaded:", [...new Set(fonts)].join(", "));
for (const theme of ["light", "dark"]) {
  const el = await p.$(`section[data-theme="${theme}"]`);
  await el!.screenshot({ path: `${out}/design-${theme}.png` });
  console.log(`wrote ${out}/design-${theme}.png`);
}
await p.screenshot({ path: `/tmp/design-full.png`, fullPage: true });
await p.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
const v = await p.evaluate(async () => (await (window as any).axe.run(document)).violations.map((v: any) => ({ id: v.id, impact: v.impact, n: v.nodes.length, ex: v.nodes.slice(0, 4).map((x: any) => x.target.join(" ") + " :: " + (x.failureSummary ?? "").split("\n").slice(1, 2).join(" ").slice(0, 160)) })));
console.log("axe violations:", JSON.stringify(v, null, 1));
await b.close();

// Interactive states → /tmp/design-state-*.png (for review only).
if (process.argv.includes("--states")) {
  const b2 = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: true });
  const q = await b2.newPage();
  await q.setViewport({ width: 1440, height: 900 });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Focus the button and press Enter, like a keyboard user (so focus restoration is exercised too).
  const click = async (theme: string, text: string, within = "") => {
    await q.evaluate((t, x, w) => { const b = [...document.querySelectorAll(`section[data-theme="${t}"] ${w} button`)].find((b) => b.textContent?.trim().startsWith(x)) as HTMLElement; b.scrollIntoView({ block: "center" }); b.focus(); }, theme, text, within);
    await q.keyboard.press("Enter");
  };
  for (const theme of ["light", "dark"]) {
    await q.goto(`${base}/#/design`, { waitUntil: "networkidle0" }); await sleep(400);
    await q.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
    await click(theme, "Take over", '[data-state="watching"]'); await sleep(300);
    const bz = await q.$(`section[data-theme="${theme}"] [data-state="driving"]`); await bz!.screenshot({ path: `/tmp/design-state-${theme}-driving.png` });
    await click(theme, "Beam to…", 'span:has(> [aria-haspopup="menu"])'); await sleep(250);
    await q.keyboard.press("ArrowDown"); await sleep(100);
    await q.screenshot({ path: `/tmp/design-state-${theme}-menu.png` });
    await q.keyboard.press("Escape");
    for (const name of ["Dialog", "Alert dialog", "Settings drawer", "Palette"]) {
      await click(theme, name); await sleep(400);
      if (name === "Palette") { await q.keyboard.type("move atl"); await sleep(150); }
      await q.screenshot({ path: `/tmp/design-state-${theme}-${name.split(" ")[0].toLowerCase()}.png` });
      const r = await q.evaluate(async () => (await (window as any).axe.run(document.querySelector('[aria-modal="true"]'))).violations.map((v: any) => v.id + ":" + v.nodes.length));
      console.log(theme, name, "focus:", await q.evaluate(() => (document.activeElement as HTMLElement)?.outerHTML.slice(0, 90)), "axe:", r);
      await q.keyboard.press("Escape"); await sleep(200);
      console.log("  restored focus to:", await q.evaluate(() => document.activeElement?.textContent?.slice(0, 30)));
    }
  }
  await b2.close();
}
