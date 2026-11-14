// The agent's screen when it runs directly on a computer (no sandbox): a headless Chromium of its own, driven over
// the DevTools protocol. Nothing here touches the person's real screen, mouse or keyboard. It has the same surface as
// X11Screen: the agent's tools (screenshot, click, type, key, scroll, open_url), the live view, thumbnails and
// Take over all work the same. The one difference: the screen is the browser only (no other desktop apps).
import { mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { SCREEN } from "@scut/protocol";
import type { Subprocess } from "bun";
import type { Screen, ScreenAction } from "./screen.ts";

type Listener = (method: string, params: any, sessionId?: string) => void;

/** One browser-level DevTools connection with flattened sessions (one socket for every tab). */
class Cdp {
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; method: string }>();
  private listeners = new Set<Listener>();
  closed = false;
  private constructor(private ws: WebSocket) {
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`));
        else p.resolve(m.result);
      } else for (const l of this.listeners) l(m.method, m.params, m.sessionId);
    };
    ws.onclose = () => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(new Error(`${p.method}: browser connection closed`));
      this.pending.clear();
    };
  }
  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const t = setTimeout(() => reject(new Error("DevTools connection timeout")), 10_000);
      ws.onopen = () => { clearTimeout(t); resolve(new Cdp(ws)); };
      ws.onerror = () => { clearTimeout(t); reject(new Error("DevTools connection failed")); };
    });
  }
  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 15_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error(`${method}: browser connection closed`));
    const id = ++this.id;
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: timeout`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); }, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  close() { try { this.ws.close(); } catch {} }
}

// ---------------- keys: xdotool syntax → DevTools key events ----------------

type KeyDef = { key: string; code: string; keyCode: number; text?: string };
const NAMED: Record<string, KeyDef> = {
  return: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  kp_enter: { key: "Enter", code: "NumpadEnter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  insert: { key: "Insert", code: "Insert", keyCode: 45 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  page_up: { key: "PageUp", code: "PageUp", keyCode: 33 },
  prior: { key: "PageUp", code: "PageUp", keyCode: 33 },
  page_down: { key: "PageDown", code: "PageDown", keyCode: 34 },
  next: { key: "PageDown", code: "PageDown", keyCode: 34 },
  minus: { key: "-", code: "Minus", keyCode: 189, text: "-" },
  plus: { key: "+", code: "Equal", keyCode: 187, text: "+" },
  equal: { key: "=", code: "Equal", keyCode: 187, text: "=" },
  period: { key: ".", code: "Period", keyCode: 190, text: "." },
  comma: { key: ",", code: "Comma", keyCode: 188, text: "," },
  slash: { key: "/", code: "Slash", keyCode: 191, text: "/" },
};
for (let i = 1; i <= 12; i++) NAMED[`f${i}`] = { key: `F${i}`, code: `F${i}`, keyCode: 111 + i };

const MOD_BITS: Record<string, number> = {
  alt: 1, alt_l: 1, alt_r: 1, option: 1,
  ctrl: 2, control: 2, control_l: 2, control_r: 2,
  super: 4, super_l: 4, super_r: 4, meta: 4, cmd: 4, command: 4,
  shift: 8, shift_l: 8, shift_r: 8,
};
const MOD_KEY: Record<number, KeyDef> = {
  1: { key: "Alt", code: "AltLeft", keyCode: 18 },
  2: { key: "Control", code: "ControlLeft", keyCode: 17 },
  4: { key: "Meta", code: "MetaLeft", keyCode: 91 },
  8: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
};

/** "ctrl+shift+t" → modifiers bitmask + the main key. Exported for tests. */
export function parseCombo(combo: string): { modifiers: number; key?: KeyDef } {
  const parts = combo.split("+").filter(Boolean);
  let modifiers = 0;
  let key: KeyDef | undefined;
  parts.forEach((raw, i) => {
    const lower = raw.toLowerCase();
    if (i < parts.length - 1 || (MOD_BITS[lower] && parts.length > 1)) {
      if (MOD_BITS[lower]) { modifiers |= MOD_BITS[lower]; return; }
    }
    if (parts.length === 1 && MOD_BITS[lower]) { modifiers |= MOD_BITS[lower]; key = MOD_KEY[MOD_BITS[lower]]; return; }
    if (NAMED[lower]) { key = NAMED[lower]; return; }
    if ([...raw].length === 1) {
      const c = raw;
      const upper = c.toUpperCase();
      const isLetter = /[a-z]/i.test(c);
      const isDigit = /[0-9]/.test(c);
      key = {
        key: c,
        code: isLetter ? `Key${upper}` : isDigit ? `Digit${c}` : "",
        keyCode: isLetter || isDigit ? upper.charCodeAt(0) : c.charCodeAt(0),
        text: c,
      };
      return;
    }
    throw new Error(`unknown key ${raw}`);
  });
  if (key && modifiers & 8 && key.text && /^[a-z]$/.test(key.text)) key = { ...key, key: key.text.toUpperCase(), text: key.text.toUpperCase() };
  return { modifiers, key };
}

const MAC_COMMANDS: Record<string, string> = { a: "selectAll", c: "copy", v: "paste", x: "cut", z: "undo", y: "redo" };

// ---------------- the screen ----------------

export class CdpScreen implements Screen {
  readonly kind = "cdp" as const;
  latest?: Uint8Array;
  latestThumb?: Uint8Array;
  frameListeners = new Set<(jpeg: Uint8Array) => void>();
  thumbListeners = new Set<(jpeg: Uint8Array) => void>();
  private proc?: Subprocess;
  private conn?: Cdp;
  /** Page targets, oldest first. The last one is on screen (a new tab becomes the screen, like the kiosk browser). */
  private pages: { targetId: string; url: string }[] = [];
  private sessions = new Map<string, string>(); // targetId → sessionId
  private active?: string;
  private mouse = { x: 0, y: 0 };
  private held?: { button: string; buttons: number; count: number };
  private thumbTimer?: ReturnType<typeof setInterval>;
  private fps = Number(process.env.SCUT_FPS ?? 8);
  private lastFrameAt = 0;
  private stopped = false;
  private switching: Promise<void> = Promise.resolve();

  constructor(private dataDir: string, private homeUrl = "about:blank") {}

  private get profile() { return `${this.dataDir}/chrome`; }

  async start() {
    this.stopped = false;
    await this.launch();
    await this.navigate(this.homeUrl);
  }

  /** Chrome, Edge or Chromium on this computer (or the one Beamhop downloaded): SCUT_BROWSER wins. */
  static findBrowser(): string | undefined {
    if (process.env.SCUT_BROWSER && process.env.SCUT_BROWSER !== "chromium") return process.env.SCUT_BROWSER;
    const c =
      process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
        : process.platform === "win32"
          ? [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`, `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`]
          : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/microsoft-edge", "/usr/bin/chromium"]; // not snaps: see drivers/browser.ts
    return c.find((p) => existsSync(p)) ?? (process.env.SCUT_BROWSER === "chromium" ? "chromium" : undefined);
  }

  private async launch() {
    const bin = CdpScreen.findBrowser();
    if (!bin) throw new Error("No Chrome, Edge or Chromium on this computer for the agent's screen");
    await mkdir(this.profile, { recursive: true });
    // A profile left by a host that stopped uncleanly (restart, beam) still says it's in use; Chromium would refuse it.
    for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie", "DevToolsActivePort"]) await rm(`${this.profile}/${f}`, { force: true }).catch(() => {});
    const port = process.env.SCUT_CDP_PORT ?? "0"; // 0: Chromium picks a free port and writes it to DevToolsActivePort
    const root = process.platform === "linux" && process.getuid?.() === 0;
    this.proc = Bun.spawn(
      [
        bin,
        "--headless=new",
        `--user-data-dir=${this.profile}`,
        `--remote-debugging-port=${port}`,
        "--remote-debugging-address=127.0.0.1",
        `--window-size=${SCREEN.w},${SCREEN.h}`,
        "--force-device-scale-factor=1",
        "--no-first-run",
        "--no-default-browser-check",
        // Cookies and saved passwords are encrypted with a fixed key instead of this computer's keychain, so the
        // profile still opens after the agent beams to another host (and back).
        "--password-store=basic",
        "--use-mock-keychain",
        "--disable-features=Translate,MediaRouter,OptimizationHints",
        ...(process.platform === "linux" ? ["--disable-dev-shm-usage"] : []),
        ...(root ? ["--no-sandbox", "--test-type"] : []),
        "about:blank",
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    const t0 = Date.now();
    let ws: string | undefined;
    while (Date.now() - t0 < 30_000) {
      if (this.proc.exitCode !== null) throw new Error(`The agent's browser exited (${this.proc.exitCode})`);
      const f = await readFile(`${this.profile}/DevToolsActivePort`, "utf8").catch(() => "");
      const [p, path] = f.split("\n");
      if (p && path) {
        ws = `ws://127.0.0.1:${p.trim()}${path.trim()}`;
        break;
      }
      await Bun.sleep(100);
    }
    if (!ws) throw new Error("The agent's browser did not start");
    this.conn = await Cdp.connect(ws);
    this.pages = [];
    this.sessions.clear();
    this.active = undefined;
    this.conn.on((method, params, sessionId) => this.onEvent(method, params, sessionId));
    await this.conn.send("Target.setDiscoverTargets", { discover: true });
    const { targetInfos } = await this.conn.send<{ targetInfos: { targetId: string; type: string; url: string }[] }>("Target.getTargets");
    for (const t of targetInfos) if (t.type === "page" && !this.pages.some((p) => p.targetId === t.targetId)) this.pages.push({ targetId: t.targetId, url: t.url });
    if (this.pages.length) await this.activate(this.pages.at(-1)!.targetId);
  }

  private onEvent(method: string, params: any, sessionId?: string) {
    if (method === "Target.targetCreated" && params.targetInfo.type === "page") {
      const t = params.targetInfo;
      if (this.pages.some((p) => p.targetId === t.targetId)) return;
      this.pages.push({ targetId: t.targetId, url: t.url });
      // A link that opened a new tab: the new tab becomes the screen.
      if (this.active) this.queueActivate(t.targetId);
    } else if (method === "Target.targetInfoChanged") {
      const p = this.pages.find((x) => x.targetId === params.targetInfo.targetId);
      if (p) p.url = params.targetInfo.url;
    } else if (method === "Target.targetDestroyed" || method === "Target.detachedFromTarget") {
      const id = params.targetId;
      if (!id) return;
      this.pages = this.pages.filter((p) => p.targetId !== id);
      this.sessions.delete(id);
      if (this.active === id) {
        this.active = undefined;
        const prev = this.pages.at(-1);
        if (prev) this.queueActivate(prev.targetId);
      }
    } else if (method === "Page.screencastFrame") {
      const s = sessionId;
      // Pace the live view at SCUT_FPS: the next frame comes after this one is acknowledged.
      const wait = Math.max(0, 1000 / this.fps - (Date.now() - this.lastFrameAt));
      this.lastFrameAt = Date.now() + wait;
      const ack = () => this.conn?.send("Page.screencastFrameAck", { sessionId: params.sessionId }, s).catch(() => {});
      if (s && this.sessions.get(this.active ?? "") === s) this.emit(Buffer.from(params.data, "base64"));
      if (wait) setTimeout(ack, wait);
      else ack();
    }
  }

  private queueActivate(targetId: string) {
    this.switching = this.switching.then(() => this.activate(targetId)).catch(() => {});
  }

  private async session(targetId: string): Promise<string> {
    const known = this.sessions.get(targetId);
    if (known) return known;
    const { sessionId } = await this.conn!.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    this.sessions.set(targetId, sessionId);
    await this.conn!.send("Page.enable", {}, sessionId);
    await this.conn!.send("Emulation.setDeviceMetricsOverride", { width: SCREEN.w, height: SCREEN.h, deviceScaleFactor: 1, mobile: false }, sessionId);
    // Headless pages are "hidden" by default; the agent's screen is the page it looks at, so it is the focused one.
    await this.conn!.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId).catch(() => {});
    return sessionId;
  }

  private async activate(targetId: string) {
    if (!this.conn || this.conn.closed || !this.pages.some((p) => p.targetId === targetId)) return;
    const old = this.active && this.sessions.get(this.active);
    if (old && this.active !== targetId) await this.conn.send("Page.stopScreencast", {}, old).catch(() => {});
    const s = await this.session(targetId);
    this.active = targetId;
    await this.conn.send("Target.activateTarget", { targetId }).catch(() => {});
    await this.conn.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: SCREEN.w, maxHeight: SCREEN.h, everyNthFrame: 1 }, s);
    // The screencast only sends a frame when something changes; have one right away.
    const shot = await this.conn.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 70 }, s).catch(() => null);
    if (shot) this.emit(Buffer.from(shot.data, "base64"));
  }

  private emit(frame: Uint8Array) {
    this.latest = frame;
    for (const l of this.frameListeners) l(frame);
  }

  private alive() {
    return !!this.proc && this.proc.exitCode === null && !this.proc.killed && !!this.conn && !this.conn.closed;
  }

  /** The on-screen page's session, starting the browser again (or opening a tab) if it is gone. */
  private async current(): Promise<string> {
    await this.switching;
    if (!this.alive()) {
      if (this.stopped) throw new Error("screen stopped");
      this.proc?.kill();
      await this.launch();
    }
    if (!this.active || !this.pages.some((p) => p.targetId === this.active)) {
      const { targetId } = await this.conn!.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
      if (!this.pages.some((p) => p.targetId === targetId)) this.pages.push({ targetId, url: "about:blank" });
      await this.switching;
      await this.activate(targetId);
    }
    return this.sessions.get(this.active!)!;
  }

  setThumbs(on: boolean) {
    if (on && !this.thumbTimer) {
      // Small, slow frames for tiles and phones: 2 fps at 480 px wide.
      const scale = 480 / SCREEN.w;
      this.thumbTimer = setInterval(async () => {
        const s = this.active && this.sessions.get(this.active);
        if (!s || !this.alive()) return;
        const timer = this.thumbTimer;
        const r = await this.conn!.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 60, clip: { x: 0, y: 0, width: SCREEN.w, height: SCREEN.h, scale } }, s).catch(() => null);
        if (!r || this.thumbTimer !== timer) return; // switched off while this one was being taken
        const f = Buffer.from(r.data, "base64");
        this.latestThumb = f;
        for (const l of this.thumbListeners) l(f);
      }, 500);
    } else if (!on && this.thumbTimer) {
      clearInterval(this.thumbTimer);
      this.thumbTimer = undefined;
    }
  }

  async screenshotPng(): Promise<Uint8Array> {
    const s = await this.current();
    const r = await this.conn!.send<{ data: string }>("Page.captureScreenshot", { format: "png" }, s);
    return Buffer.from(r.data, "base64");
  }

  private async mouse_(type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
    const s = await this.current();
    this.mouse = { x, y };
    await this.conn!.send("Input.dispatchMouseEvent", { type, x, y, ...extra }, s);
  }

  private async key(combo: string) {
    const { modifiers, key } = parseCombo(combo);
    if (!key) return;
    const s = await this.current();
    const lower = combo.toLowerCase();
    // Browser-level shortcuts that a headless browser has no window for: do what the kiosk browser would.
    if (lower === "ctrl+w" || lower === "ctrl+f4" || lower === "super+w" || lower === "cmd+w") {
      const id = this.active!;
      if (this.pages.length <= 1) return this.navigate("about:blank");
      await this.conn!.send("Target.closeTarget", { targetId: id });
      for (let i = 0; i < 50 && this.pages.some((p) => p.targetId === id); i++) await Bun.sleep(20);
      return;
    }
    if (lower === "alt+left") return void (await this.conn!.send("Runtime.evaluate", { expression: "history.back()" }, s));
    if (lower === "alt+right") return void (await this.conn!.send("Runtime.evaluate", { expression: "history.forward()" }, s));
    if (lower === "f5" || lower === "ctrl+r") return void (await this.conn!.send("Page.reload", {}, s));
    const bits = [2, 1, 4, 8].filter((b) => modifiers & b && MOD_KEY[b].key !== key.key);
    const mods = bits.map((b) => MOD_KEY[b]);
    let held = 0;
    for (const b of bits) {
      held |= b;
      const m = MOD_KEY[b];
      await this.conn!.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: m.key, code: m.code, windowsVirtualKeyCode: m.keyCode, modifiers: held }, s);
    }
    const printable = !!key.text && !(modifiers & (1 | 2 | 4));
    const commands = process.platform === "darwin" && modifiers & (2 | 4) && MAC_COMMANDS[key.key.toLowerCase()] ? [MAC_COMMANDS[key.key.toLowerCase()]] : undefined;
    await this.conn!.send("Input.dispatchKeyEvent", {
      type: printable ? "keyDown" : "rawKeyDown", key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, modifiers,
      ...(printable ? { text: key.text, unmodifiedText: key.text } : {}), ...(commands ? { commands } : {}),
    }, s);
    await this.conn!.send("Input.dispatchKeyEvent", { type: "keyUp", key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, modifiers }, s);
    for (const m of mods.reverse()) await this.conn!.send("Input.dispatchKeyEvent", { type: "keyUp", key: m.key, code: m.code, windowsVirtualKeyCode: m.keyCode, modifiers: 0 }, s);
  }

  async act(a: ScreenAction) {
    const has = a.x !== undefined && a.y !== undefined;
    const x = has ? Math.round(a.x!) : this.mouse.x;
    const y = has ? Math.round(a.y!) : this.mouse.y;
    const button = a.button === 3 ? "right" : a.button === 2 ? "middle" : "left";
    const buttons = button === "left" ? 1 : button === "right" ? 2 : 4;
    switch (a.kind) {
      // While a button is held, moves carry it, so a drag selects text or moves things.
      case "move": return this.mouse_("mouseMoved", x, y, this.held ? { button: this.held.button, buttons: this.held.buttons } : {});
      case "click":
      case "dblclick": {
        const n = a.kind === "dblclick" ? 2 : 1;
        await this.mouse_("mouseMoved", x, y);
        for (let i = 1; i <= n; i++) {
          await this.mouse_("mousePressed", x, y, { button, buttons, clickCount: i });
          await this.mouse_("mouseReleased", x, y, { button, buttons: 0, clickCount: i });
        }
        return;
      }
      case "down": {
        this.held = { button, buttons, count: Math.max(1, Math.min(3, a.count ?? 1)) };
        return this.mouse_("mousePressed", x, y, { button, buttons, clickCount: this.held.count });
      }
      case "up": {
        const count = this.held?.count ?? 1;
        this.held = undefined;
        return this.mouse_("mouseReleased", x, y, { button, buttons: 0, clickCount: count });
      }
      case "scroll": return this.mouse_("mouseWheel", x, y, { deltaX: 0, deltaY: a.dy ?? 100 });
      case "key": {
        for (const combo of (a.keys ?? "").split(" ").filter(Boolean)) await this.key(combo);
        return;
      }
      case "type": {
        const s = await this.current();
        // Like xdotool type: a newline presses Return.
        const parts = (a.text ?? "").split("\n");
        for (let i = 0; i < parts.length; i++) {
          if (parts[i]) await this.conn!.send("Input.insertText", { text: parts[i] }, s);
          if (i < parts.length - 1) await this.key("Return");
        }
        return;
      }
      case "open_url": return this.navigate(a.url ?? "about:blank");
      default: throw new Error(`unknown action ${a.kind}`);
    }
  }

  async navigate(url: string) {
    const s = await this.current();
    await this.conn!.send("Page.navigate", { url }, s);
    const p = this.pages.find((x) => x.targetId === this.active);
    if (p) p.url = url;
  }

  async currentUrl(): Promise<string | undefined> {
    if (!this.alive() || !this.active) return undefined;
    const s = this.sessions.get(this.active);
    const r = !s ? null : (await this.conn!.send<{ result: { value?: string } }>("Runtime.evaluate", { expression: "location.href", returnByValue: true }, s, 3000).catch(() => null));
    return r?.result?.value ?? this.pages.find((p) => p.targetId === this.active)?.url;
  }

  /** Close the browser cleanly (Browser.close writes cookies and logins to disk), then make sure it is gone. */
  async stop() {
    this.stopped = true;
    this.setThumbs(false);
    if (this.alive()) await this.conn!.send("Browser.close", {}, undefined, 3000).catch(() => {});
    this.conn?.close();
    if (this.proc && this.proc.exitCode === null) {
      await Promise.race([this.proc.exited, Bun.sleep(5000)]);
      this.proc.kill("SIGKILL");
    }
  }
}
