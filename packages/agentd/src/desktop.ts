import { mkdir, rm, writeFile } from "node:fs/promises";
// The agent's own computer inside a sandbox: a small Linux desktop (Xvfb, Openbox windows, a tint2 dock with Browser,
// Files and Terminal, a Chromium window with tabs and an address bar), MJPEG frames via ffmpeg, input via xdotool.
// The other implementation of Screen (screen.ts) is CdpScreen, for agents running directly on the host.
import { SCREEN } from "@scut/protocol";
import type { Subprocess } from "bun";
import type { Screen, ScreenAction } from "./screen.ts";

const DISPLAY = process.env.SCUT_DISPLAY ?? ":99";
const env = () => ({ ...process.env, DISPLAY });
const CDP_PORT = Number(process.env.SCUT_CDP_PORT ?? 9222);
const HOME = () => process.env.HOME ?? "/root";
/** Height of the dock at the bottom of the screen. */
const DOCK_H = 40;

/** apt-get install, quietly; false when it couldn't (no network, no apt). */
async function installPackages(pkgs: string[]): Promise<boolean> {
  if (!Bun.which("apt-get")) return false;
  const run = async (args: string[]) => {
    const p = Bun.spawn(args, { env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" }, stdout: "ignore", stderr: "pipe" });
    return (await p.exited) === 0;
  };
  if (!(await run(["apt-get", "update", "-qq"]))) return false;
  return run(["apt-get", "install", "-y", "-qq", "--no-install-recommends", ...pkgs]);
}

/** Openbox: a calm theme, window titles, and maximized windows stop at the dock. One desktop. */
const OPENBOX_RC = `<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <theme><name>Clearlooks</name><titleLayout>NLIMC</titleLayout><keepBorder>yes</keepBorder>
    <font place="ActiveWindow"><name>DejaVu Sans</name><size>9</size><weight>bold</weight></font>
    <font place="InactiveWindow"><name>DejaVu Sans</name><size>9</size></font></theme>
  <desktops><number>1</number></desktops>
  <margins><top>0</top><bottom>0</bottom><left>0</left><right>0</right></margins>
  <placement><policy>Smart</policy><center>yes</center></placement>
  <applications><application class="*" type="normal"><maximized>true</maximized></application></applications>
</openbox_config>
`;

/** The dock: Browser, Files and Terminal launchers, the open windows, a clock. */
function tint2rc(dataDir: string) {
  return `panel_items = LTSC
panel_size = 100% ${DOCK_H}
panel_position = bottom center horizontal
panel_layer = top
strut_policy = follow_size
panel_background_id = 1
panel_padding = 8 4 8
font_shadow = 0
rounded = 0
border_width = 0
background_color = #161512 100
border_color = #000000 0
rounded = 8
border_width = 0
background_color = #2c2a25 100
border_color = #000000 0
rounded = 8
border_width = 0
background_color = #3a3730 100
border_color = #000000 0
taskbar_mode = single_desktop
taskbar_padding = 4 0 6
taskbar_background_id = 0
taskbar_active_background_id = 0
task_icon = 1
task_text = 1
task_maximum_size = 220 32
task_padding = 8 4 6
task_font = DejaVu Sans 9
task_font_color = #c9c6bf 100
task_active_font_color = #ffffff 100
task_background_id = 2
task_active_background_id = 3
launcher_padding = 4 4 6
launcher_background_id = 0
launcher_icon_size = 24
launcher_item_app = ${dataDir}/desktop/browser.desktop
launcher_item_app = ${dataDir}/desktop/files.desktop
launcher_item_app = ${dataDir}/desktop/terminal.desktop
systray_padding = 0 0 0
time1_format = %H:%M
time1_font = DejaVu Sans 10
clock_font_color = #e6e3dc 100
clock_padding = 8 0
`;
}

const ICON_BROWSER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="#3d7bd9"/><ellipse cx="24" cy="24" rx="9" ry="21" fill="none" stroke="#fff" stroke-width="2.5"/><path d="M3 24h42M7 13h34M7 35h34" stroke="#fff" stroke-width="2.5"/></svg>`;
const ICON_FILES = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M4 12a4 4 0 0 1 4-4h10l4 5h18a4 4 0 0 1 4 4v19a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#d9a33d"/><path d="M4 19h40v17a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#f0bd52"/></svg>`;
const ICON_TERMINAL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="3" y="6" width="42" height="36" rx="6" fill="#2f2d28" stroke="#5a564d" stroke-width="2"/><path d="M12 18l8 6-8 6" fill="none" stroke="#e6e3dc" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 31h12" stroke="#e6e3dc" stroke-width="3" stroke-linecap="round"/></svg>`;

/** One DevTools protocol call on a page target (short-lived socket). */
export async function cdp(ws: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
  const sock = new WebSocket(ws);
  try {
    return await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${method}: timeout`)), 5000);
      sock.onerror = () => { clearTimeout(t); reject(new Error(`${method}: socket error`)); };
      sock.onopen = () => sock.send(JSON.stringify({ id: 1, method, params }));
      sock.onmessage = (e) => {
        const m = JSON.parse(String(e.data));
        if (m.id !== 1) return;
        clearTimeout(t);
        if (m.error) reject(new Error(`${method}: ${m.error.message}`));
        else resolve(m.result);
      };
    });
  } finally {
    sock.close();
  }
}

export class X11Screen implements Screen {
  readonly kind = "x11" as const;
  private procs: Subprocess[] = [];
  private ffmpeg?: Subprocess;
  latest?: Uint8Array;
  frameListeners = new Set<(jpeg: Uint8Array) => void>();
  thumbListeners = new Set<(jpeg: Uint8Array) => void>();
  latestThumb?: Uint8Array;
  private thumbProc?: Subprocess;
  private fps = Number(process.env.SCUT_FPS ?? 8);

  constructor(private dataDir: string, private homeUrl = "about:blank") {}

  async start() {
    // After a restart of the host, the last X server's lock and socket are still there and stop a new one starting.
    const n = DISPLAY.replace(":", "");
    for (const f of [`/tmp/.X${n}-lock`, `/tmp/.X11-unix/X${n}`]) await rm(f, { force: true }).catch(() => {});
    const xvfb = Bun.spawn(["Xvfb", DISPLAY, "-screen", "0", `${SCREEN.w}x${SCREEN.h}x24`, "-nolisten", "tcp", "-ac"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    this.procs.push(xvfb);
    await this.waitForX();
    this.trustExtraCa();
    await this.writeDesktopConfig();
    this.procs.push(Bun.spawn(["openbox", "--config-file", `${HOME()}/.config/openbox/rc.xml`], { env: env(), stdout: "ignore", stderr: "ignore" }));
    void this.startDesktop();
    this.startBrowser(this.homeUrl);
    this.startFrames();
    await this.waitForBrowser(20_000); // "running" means its browser can be driven
  }

  /** Openbox (window frames, maximized windows above the dock) and the dock itself (tint2). */
  private async writeDesktopConfig() {
    const h = HOME();
    await mkdir(`${h}/.config/openbox`, { recursive: true });
    await mkdir(`${h}/.config/tint2`, { recursive: true });
    await writeFile(`${h}/.config/openbox/rc.xml`, OPENBOX_RC);
    await writeFile(`${h}/.config/tint2/tint2rc`, tint2rc(this.dataDir));
    // Dock launchers. The browser one opens a new window of the agent's own browser (same profile, same logins).
    const d = `${this.dataDir}/desktop`;
    await mkdir(d, { recursive: true });
    const bin = process.env.SCUT_BROWSER ?? "chromium";
    await writeFile(`${d}/browser.svg`, ICON_BROWSER);
    await writeFile(`${d}/terminal.svg`, ICON_TERMINAL);
    await writeFile(`${d}/files.svg`, ICON_FILES);
    await writeFile(`${d}/browser.desktop`, `[Desktop Entry]\nType=Application\nName=Browser\nIcon=${d}/browser.svg\nExec=${bin} --no-sandbox --test-type --user-data-dir=${this.dataDir}/chrome --new-window\n`);
    await writeFile(`${d}/files.desktop`, `[Desktop Entry]\nType=Application\nName=Files\nIcon=${d}/files.svg\nExec=pcmanfm ${this.dataDir}/workspace\n`);
    await writeFile(`${d}/terminal.desktop`, `[Desktop Entry]\nType=Application\nName=Terminal\nIcon=${d}/terminal.svg\nExec=xterm -fa "DejaVu Sans Mono" -fs 11 -bg "#1b1a17" -fg "#e6e3dc" -cr "#e6e3dc" -bc -geometry 110x32\nPath=${this.dataDir}/workspace\n`);
  }

  /**
   * Wallpaper and dock. Agent images from before the desktop lack tint2/xterm/pcmanfm: those are installed once here (in the
   * background, the agent works meanwhile) and kept on its disk.
   */
  private async startDesktop() {
    if (!Bun.which("tint2") || !Bun.which("xterm") || !Bun.which("xsetroot") || !Bun.which("pcmanfm")) {
      const ok = await installPackages(["tint2", "xterm", "x11-xserver-utils", "pcmanfm", "adwaita-icon-theme"]);
      if (!ok) return;
    }
    Bun.spawnSync(["xsetroot", "-solid", "#23211d"], { env: env(), stdout: "ignore", stderr: "ignore" });
    const dock = () => {
      const p = Bun.spawn(["tint2", "-c", `${HOME()}/.config/tint2/tint2rc`], { env: env(), stdout: "ignore", stderr: "ignore" });
      this.procs.push(p);
      // The dock is part of the computer: bring it back if it ever exits.
      p.exited.then(() => { if (this.procs.includes(p) && !this.stopping) setTimeout(dock, 2000); });
    };
    dock();
  }
  private stopping = false;

  /** Open a page in a new browser tab, on screen (e.g. a sign-in page the owner finishes with Take over). */
  async openTab(url: string) {
    // Through the browser's own DevTools target: the URL goes as data, never re-parsed from a query string.
    const v = (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null)) as { webSocketDebuggerUrl?: string } | null;
    const ok = v?.webSocketDebuggerUrl && (await cdp(v.webSocketDebuggerUrl, "Target.createTarget", { url }).catch(() => null));
    if (!ok) await this.navigate(url);
  }

  /** Wait until the browser answers on its debugging port (false after `ms`). */
  private async waitForBrowser(ms: number): Promise<boolean> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await this.visiblePage(3000).catch(() => undefined)) return true;
      await Bun.sleep(250);
    }
    return false;
  }

  private async waitForX() {
    for (let i = 0; i < 50; i++) {
      const p = Bun.spawnSync(["xdpyinfo"], { env: env(), stdout: "ignore", stderr: "ignore" });
      if (p.exitCode === 0) return;
      await Bun.sleep(100);
    }
    throw new Error("Xvfb did not start");
  }

  /** Trust an extra CA in Chromium's NSS store (dev setups behind a TLS-intercepting proxy). */
  private trustExtraCa() {
    const ca = process.env.SCUT_EXTRA_CA;
    if (!ca) return;
    const db = `sql:${process.env.HOME ?? "/root"}/.pki/nssdb`;
    const dir = db.slice(4);
    if (require("node:fs").existsSync(`${dir}/cert9.db`)) return; // already done (e.g. after a beam abort)
    Bun.spawnSync(["mkdir", "-p", dir]);
    Bun.spawnSync(["certutil", "-d", db, "-N", "--empty-password"], { stdin: "ignore", stderr: "ignore", timeout: 10_000 });
    // the bundle may hold several certs; import each
    const pems = require("node:fs").readFileSync(ca, "utf8").match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
    pems.forEach((pem: string, i: number) => {
      const f = `/tmp/scut-ca-${i}.pem`;
      require("node:fs").writeFileSync(f, pem);
      Bun.spawnSync(["certutil", "-d", db, "-A", "-t", "C,,", "-n", `scut-extra-${i}`, "-i", f], { stdin: "ignore", stderr: "ignore", timeout: 10_000 });
    });
  }

  startBrowser(url = "about:blank") {
    // A profile left by a host that stopped uncleanly (restart, beam) still says it's in use; Chromium would refuse it.
    for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) require("node:fs").rmSync(`${this.dataDir}/chrome/${f}`, { force: true });
    // A restart of the agent's computer isn't a crash to the person watching: no "Restore pages?" bubble.
    try {
      const fs = require("node:fs");
      const pf = `${this.dataDir}/chrome/Default/Preferences`;
      const prefs = JSON.parse(fs.readFileSync(pf, "utf8"));
      prefs.profile = { ...(prefs.profile ?? {}), exit_type: "Normal", exited_cleanly: true };
      fs.writeFileSync(pf, JSON.stringify(prefs));
    } catch {}
    const bin = process.env.SCUT_BROWSER ?? "chromium";
    const p = Bun.spawn(
      [
        bin,
        "--no-sandbox",
        "--test-type", // hides the "unsupported command-line flag" infobar caused by --no-sandbox
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        `--user-data-dir=${this.dataDir}/chrome`,
        "--window-position=0,0",
        `--window-size=${SCREEN.w},${SCREEN.h - DOCK_H}`,
        // A normal browser window on the desktop: tabs and an address bar, maximized above the dock.
        "--start-maximized",
        "--hide-crash-restore-bubble",
        // Navigation (open_url) and "where is it" go through the DevTools protocol, on this computer's loopback only.
        `--remote-debugging-port=${CDP_PORT}`,
        "--remote-debugging-address=127.0.0.1",
        url,
      ],
      { env: env(), stdout: "ignore", stderr: "ignore" },
    );
    this.procs.push(p);
    this.browser = p;
  }
  private browser?: Subprocess;

  /** The tab on screen (DevTools target), or undefined when the browser or its debugging port is not there. */
  private async visiblePage(timeoutMs = 3000): Promise<{ url: string; ws: string } | undefined> {
    const list = (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(timeoutMs) }).then((r) => r.json()).catch(() => null)) as
      | { type: string; url: string; webSocketDebuggerUrl?: string }[]
      | null;
    const pages = (list ?? []).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (pages.length <= 1) return pages[0] && { url: pages[0].url, ws: pages[0].webSocketDebuggerUrl! };
    // Several tabs (a link opened a new one): the one on screen is the visible one; the list is newest-first otherwise.
    for (const p of pages) {
      const r = await cdp(p.webSocketDebuggerUrl!, "Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true }).catch(() => null);
      if (r?.result?.value === "visible") return { url: p.url, ws: p.webSocketDebuggerUrl! };
    }
    return { url: pages[0].url, ws: pages[0].webSocketDebuggerUrl! };
  }

  /** The address of the page on screen (best effort). */
  async currentUrl(): Promise<string | undefined> {
    return (await this.visiblePage().catch(() => undefined))?.url;
  }
  private startFrames() {
    this.ffmpeg = this.mjpeg(this.fps, ["-q:v", "6"], (f) => this.emit(f));
  }

  /**
   * Small, slow frames for crew-grid tiles and phones: a second capture at 2 fps scaled to 480 px wide, about a tenth
   * of the bytes per frame. Runs only while someone is watching a tile.
   */
  setThumbs(on: boolean) {
    if (on && !this.thumbProc) {
      this.thumbProc = this.mjpeg(2, ["-vf", "scale=480:-2", "-q:v", "7"], (f) => {
        this.latestThumb = f;
        for (const l of this.thumbListeners) l(f);
      });
    } else if (!on && this.thumbProc) {
      this.thumbProc.kill();
      this.thumbProc = undefined;
    }
  }

  private mjpeg(fps: number, encode: string[], onFrame: (jpeg: Uint8Array) => void): Subprocess {
    const p = Bun.spawn(
      [
        "ffmpeg", "-loglevel", "error", "-f", "x11grab", "-draw_mouse", "1", "-framerate", String(fps),
        "-video_size", `${SCREEN.w}x${SCREEN.h}`, "-i", DISPLAY,
        ...encode, "-f", "image2pipe", "-vcodec", "mjpeg", "-",
      ],
      { env: env(), stdout: "pipe", stderr: "ignore" },
    );
    (async () => {
      let buf = new Uint8Array(0);
      for await (const chunk of p.stdout as ReadableStream<Uint8Array>) {
        const next = new Uint8Array(buf.length + chunk.length);
        next.set(buf);
        next.set(chunk, buf.length);
        buf = next;
        // split on JPEG EOI (FFD9) after an SOI (FFD8)
        let start = 0;
        for (let i = 1; i < buf.length; i++) {
          if (buf[i - 1] === 0xff && buf[i] === 0xd9) {
            const frame = buf.slice(start, i + 1);
            if (frame[0] === 0xff && frame[1] === 0xd8) onFrame(frame);
            start = i + 1;
          }
        }
        buf = buf.slice(start);
      }
    })();
    return p;
  }

  private emit(frame: Uint8Array) {
    this.latest = frame;
    for (const l of this.frameListeners) l(frame);
  }

  async screenshotPng(): Promise<Uint8Array> {
    const p = Bun.spawn(
      ["ffmpeg", "-loglevel", "error", "-f", "x11grab", "-video_size", `${SCREEN.w}x${SCREEN.h}`, "-i", DISPLAY, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
      { env: env(), stdout: "pipe", stderr: "ignore" },
    );
    return new Uint8Array(await new Response(p.stdout).arrayBuffer());
  }

  async xdotool(...args: string[]) {
    const p = Bun.spawn(["xdotool", ...args], { env: env(), stdout: "pipe", stderr: "pipe" });
    const code = await p.exited;
    if (code !== 0) throw new Error(`xdotool ${args.join(" ")}: ${await new Response(p.stderr).text()}`);
    return (await new Response(p.stdout).text()).trim();
  }

  async act(a: ScreenAction) {
    const b = String(a.button ?? 1);
    const move = a.x !== undefined && a.y !== undefined ? ["mousemove", String(Math.round(a.x)), String(Math.round(a.y))] : [];
    switch (a.kind) {
      case "move": return this.xdotool(...move);
      case "click": return this.xdotool(...move, "click", b);
      case "dblclick": return this.xdotool(...move, "click", "--repeat", "2", b);
      case "down": return this.xdotool(...move, "mousedown", b);
      case "up": return this.xdotool(...move, "mouseup", b);
      case "scroll": {
        const n = Math.max(1, Math.round(Math.abs(a.dy ?? 1) / 100) || 1);
        return this.xdotool(...move, "click", "--repeat", String(n), (a.dy ?? 1) > 0 ? "5" : "4");
      }
      case "key": return this.xdotool("key", "--clearmodifiers", ...(a.keys ?? "").split(" ").filter(Boolean));
      case "type": return this.xdotool("type", "--delay", "8", "--", a.text ?? "");
      case "open_url": return this.navigate(a.url ?? "about:blank");
      default: throw new Error(`unknown action ${a.kind}`);
    }
  }

  /** Navigate the tab on screen; start the browser if it is gone (e.g. its last tab was closed). */
  async navigate(url: string) {
    // A busy computer or a browser that is still starting can take a while to answer: keep asking for a bit.
    const t0 = Date.now();
    do {
      const page = await this.visiblePage().catch(() => undefined);
      if (page && (await cdp(page.ws, "Page.navigate", { url }).catch(() => null))) return;
      if (!this.browserAlive()) break;
      await Bun.sleep(500);
    } while (Date.now() - t0 < 15_000);
    // Gone, or running but not answering: (re)start it on that page.
    if (this.browserAlive()) {
      this.browser!.kill();
      await this.browser!.exited.catch(() => {});
    }
    this.startBrowser(url);
  }

  private browserAlive() {
    return !!this.browser && this.browser.exitCode === null && !this.browser.killed;
  }

  /** Close the browser first and wait for it, so its profile (cookies, logins) is on disk before a beam packs it. */
  async stop() {
    this.stopping = true;
    this.ffmpeg?.kill();
    this.setThumbs(false);
    if (this.browser && this.browserAlive()) {
      this.browser.kill("SIGTERM");
      await Promise.race([this.browser.exited, Bun.sleep(5000)]);
    }
    for (const p of this.procs.reverse()) p.kill();
    this.procs = [];
  }
}
