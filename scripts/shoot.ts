// Screenshot UI pages with real Chrome and report console errors.
// bun scripts/shoot.ts <url> <out.png> [width height wait-ms]
import puppeteer from "puppeteer-core";
const [url, out, w = "1440", h = "900", wait = "4000"] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-gpu"], headless: true });
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h });
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, +wait));
await page.screenshot({ path: out });
await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no console errors");
