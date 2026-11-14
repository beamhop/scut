// The browser for agents that run directly on a computer: Chrome, Edge or Chromium if one is installed (used with
// a profile of the agent's own, never the person's), otherwise a headless Chrome for Testing downloaded once.
import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { run } from "./util.ts";

export function installedBrowsers(): string[] {
  const env = process.env;
  const c =
    process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", `${env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`]
      : process.platform === "win32"
        ? [`${env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`, `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`, `${env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`, `${env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`]
        : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/microsoft-edge", "/snap/bin/chromium"];
  return c.filter((p) => existsSync(p));
}

const CFT = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";
const cftPlatform = () =>
  process.platform === "darwin" ? "mac-arm64"
  : process.platform === "win32" ? "win64"
  : process.arch === "arm64" ? "linux-arm64" : "linux64";

/** A headless Chrome downloaded earlier into `dir` (newest version), if any. */
export async function downloadedBrowser(dir: string): Promise<string | undefined> {
  const exe = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  const versions = (await readdir(dir).catch(() => [] as string[])).filter((v) => v.startsWith("chrome-headless-shell-")).sort().reverse();
  for (const v of versions) {
    const p = `${dir}/${v}/chrome-headless-shell-${cftPlatform()}/${exe}`;
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** SCUT_BROWSER, an installed browser, an earlier download, or download one now (Chrome for Testing, headless). */
export async function ensureBrowser(dir: string, onProgress?: (p: { done: number; total: number }) => void, opts: { useInstalled?: boolean } = {}): Promise<string> {
  if (process.env.SCUT_HOST_BROWSER) return process.env.SCUT_HOST_BROWSER;
  const have = (opts.useInstalled === false ? undefined : installedBrowsers()[0]) ?? (await downloadedBrowser(dir));
  if (have) return have;
  const j = (await (await fetch(CFT, { signal: AbortSignal.timeout(30_000) })).json()) as any;
  const stable = j.channels.Stable;
  const dl = (stable.downloads["chrome-headless-shell"] as { platform: string; url: string }[]).find((d) => d.platform === cftPlatform());
  if (!dl) throw new Error(`No browser download for ${cftPlatform()}`);
  const dest = `${dir}/chrome-headless-shell-${stable.version}`;
  await mkdir(dest, { recursive: true });
  onProgress?.({ done: 0, total: 1 });
  const r = await fetch(dl.url, { signal: AbortSignal.timeout(15 * 60_000) });
  if (!r.ok) throw new Error(`Couldn't download a browser for the agent (${r.status})`);
  const zip = `${dest}/download.zip`;
  await Bun.write(zip, r);
  // unzip on macOS/Linux; Windows 10+ ships bsdtar, which reads zip files.
  const x = process.platform === "win32" ? run(["tar", "-xf", zip, "-C", dest], { timeout: 300_000 }) : run(["unzip", "-q", "-o", zip, "-d", dest], { timeout: 300_000 });
  await rm(zip, { force: true });
  const got = await downloadedBrowser(dir);
  if (x.code !== 0 || !got) throw new Error(`Couldn't unpack the agent's browser: ${x.err.slice(0, 200)}`);
  onProgress?.({ done: 1, total: 1 });
  return got;
}
