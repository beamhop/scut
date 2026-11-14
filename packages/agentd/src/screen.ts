// The agent's screen: what computer use, the live view and Take over talk to. Two implementations:
//   X11Screen (desktop.ts)   inside a sandbox: a whole Linux desktop (Xvfb, Openbox, Chromium; ffmpeg; xdotool)
//   CdpScreen (screen-cdp.ts) directly on the host: a headless Chromium driven over the DevTools protocol, so the
//                             agent never touches the person's own screen, mouse or keyboard. Same tools, same frames.

export type ScreenAction = {
  kind: string;
  x?: number;
  y?: number;
  /** 1 left, 2 middle, 3 right (X11 numbering). */
  button?: number;
  dy?: number;
  /** xdotool key syntax: "Return", "ctrl+a", "ctrl+w Tab". */
  keys?: string;
  text?: string;
  url?: string;
};

export interface Screen {
  readonly kind: "x11" | "cdp";
  start(): Promise<void>;
  /** Stop, closing the browser cleanly so its profile is complete on disk. */
  stop(): Promise<void>;
  /** Latest live frame (JPEG), for the bezel, schedule runs and approvals. */
  latest?: Uint8Array;
  frameListeners: Set<(jpeg: Uint8Array) => void>;
  /** Small, slow frames for tiles and phones (only while setThumbs(true)). */
  latestThumb?: Uint8Array;
  thumbListeners: Set<(jpeg: Uint8Array) => void>;
  setThumbs(on: boolean): void;
  screenshotPng(): Promise<Uint8Array>;
  act(a: ScreenAction): Promise<unknown>;
  navigate(url: string): Promise<void>;
  /** Open a page in a new tab on screen (falls back to navigate where there are no tabs). */
  openTab?(url: string): Promise<void>;
  currentUrl(): Promise<string | undefined>;
}

/** Pick the implementation: SCUT_SCREEN=cdp on hosts without a sandbox, X11 everywhere else. */
export async function createScreen(dataDir: string, homeUrl: string): Promise<Screen> {
  if ((process.env.SCUT_SCREEN ?? "x11") === "cdp") {
    const { CdpScreen } = await import("./screen-cdp.ts");
    return new CdpScreen(dataDir, homeUrl);
  }
  const { X11Screen } = await import("./desktop.ts");
  return new X11Screen(dataDir, homeUrl);
}
