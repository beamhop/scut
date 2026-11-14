// Capture every main screen for design review: SCUT_HOME=... bun scripts/screens.ts <base-url> <out-dir>
import puppeteer from "puppeteer-core";
const [base = "http://127.0.0.1:7777", out = "/tmp/screens"] = process.argv.slice(2);
await Bun.$`mkdir -p ${out}`;
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
const click = (text: string) => p.evaluate((t) => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(t))?.dispatchEvent(new MouseEvent("click", { bubbles: true })), text);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
await p.goto(base); await wait(3500);
await p.screenshot({ path: `${out}/1-home.png` });
await click("New agent"); await wait(800); await p.screenshot({ path: `${out}/2-new-agent.png` });
await p.keyboard.press("Escape"); await click("Cancel"); await wait(400);
await click("Add a cloud"); await wait(800); await p.screenshot({ path: `${out}/3-add-cloud.png` });
await click("Cancel"); await wait(400);
await click("Talk to all agents"); await wait(2500); await p.screenshot({ path: `${out}/4-crew.png` });
const agents = await (await fetch(`${base}/api/agents`)).json();
if (agents[0]) {
  await p.goto(`${base}/#/agent/${agents[0].id}`); await wait(3500);
  await p.screenshot({ path: `${out}/5-agent.png` });
  await click("Settings"); await wait(1000); await p.screenshot({ path: `${out}/6-agent-settings.png` });
}
await b.close();
console.log("screens in", out);
