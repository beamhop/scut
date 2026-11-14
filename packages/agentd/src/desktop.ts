// The agent's own computer: Xvfb + Openbox + Chromium, MJPEG frames via ffmpeg, input via xdotool.
import { SCREEN } from "@scut/protocol";
import type { Subprocess } from "bun";

const DISPLAY = process.env.SCUT_DISPLAY ?? ":99";
const env = () => ({ ...process.env, DISPLAY });

export class Desktop {
  private procs: Subprocess[] = [];
  private ffmpeg?: Subprocess;
  latest?: Uint8Array;
  frameListeners = new Set<(jpeg: Uint8Array) => void>();
  private fps = Number(process.env.SCUT_FPS ?? 8);

  constructor(private dataDir: string, private homeUrl = "about:blank") {}

  async start() {
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
        "--start-maximized",
        url,
      ],
      { env: env(), stdout: "ignore", stderr: "ignore" },
    );
    this.procs.push(p);
  }

  private startFrames() {
    const p = Bun.spawn(
      [
        "ffmpeg", "-loglevel", "error", "-f", "x11grab", "-draw_mouse", "1", "-framerate", String(this.fps),
        "-video_size", `${SCREEN.w}x${SCREEN.h}`, "-i", DISPLAY,
        "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "6", "-",
      ],
      { env: env(), stdout: "pipe", stderr: "ignore" },
    );
    this.ffmpeg = p;
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
            if (frame[0] === 0xff && frame[1] === 0xd8) this.emit(frame);
            start = i + 1;
          }
        }
        buf = buf.slice(start);
      }
    })();
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

  /** Navigate the current browser tab (like typing in the address bar); start the browser if it is gone. */
  async navigate(url: string) {
    const win = await this.xdotool("search", "--onlyvisible", "--class", "chromium").catch(() => "");
    const id = win.split("\n").filter(Boolean).at(-1);
    if (!id) {
      this.startBrowser(url);
      return;
    }
    await this.xdotool("windowactivate", "--sync", id).catch(() => {});
    await this.xdotool("key", "--clearmodifiers", "ctrl+l");
    await this.xdotool("type", "--delay", "4", "--", url);
    await this.xdotool("key", "Return");
  }

  stop() {
    this.ffmpeg?.kill();
    for (const p of this.procs.reverse()) p.kill();
    this.procs = [];
  }
}
