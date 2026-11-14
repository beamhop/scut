import { rm } from "node:fs/promises";
// The agent's own computer: Xvfb + Openbox + Chromium, MJPEG frames via ffmpeg, input via xdotool.
import { SCREEN } from "@scut/protocol";
import type { Subprocess } from "bun";

const DISPLAY = process.env.SCUT_DISPLAY ?? ":99";
const env = () => ({ ...process.env, DISPLAY });
const CDP_PORT = Number(process.env.SCUT_CDP_PORT ?? 9222);

/** One DevTools protocol call on a page target (short-lived socket). */
async function cdp(ws: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
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

export class Desktop {
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
    this.procs.push(Bun.spawn(["openbox"], { env: env(), stdout: "ignore", stderr: "ignore" }));
    this.startBrowser(this.homeUrl);
    this.startFrames();
    await this.waitForBrowser(20_000); // "running" means its browser can be driven
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
        `--window-size=${SCREEN.w},${SCREEN.h}`,
        // The whole screen is the page: no tab strip, no address bar, no window frame (Beamhop's bezel shows where it is).
        // Links that open a new tab still work (the new tab becomes the screen; ctrl+w goes back).
        "--kiosk",
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

  async act(a: { kind: string; x?: number; y?: number; button?: number; dy?: number; keys?: string; text?: string; url?: string }) {
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
    // Gone, or running but not answering: (re)start it on that page. There is no address bar to type into.
    if (this.browserAlive()) {
      this.browser!.kill();
      await this.browser!.exited.catch(() => {});
    }
    this.startBrowser(url);
  }

  private browserAlive() {
    return !!this.browser && this.browser.exitCode === null && !this.browser.killed;
  }

  stop() {
    this.ffmpeg?.kill();
    this.setThumbs(false);
    for (const p of this.procs.reverse()) p.kill();
    this.procs = [];
  }
}
