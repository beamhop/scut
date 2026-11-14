// Subscription sign-in for the CLI harnesses (ChatGPT through Codex, GitHub Copilot through Copilot CLI).
// Both CLIs offer a device-code login: they print a link and a one-time code, the owner opens the link on any device
// where they are already signed in and enters the code, and the CLI stores its token under the agent's own $HOME
// (/data/home, so it beams with the agent). Nothing here sees a password.
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import type { SigninState } from "@scut/protocol";

export type SubscriptionKind = "codex" | "copilot";
const NAME: Record<SubscriptionKind, string> = { codex: "ChatGPT", copilot: "GitHub Copilot" };

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const clean = (s: string) => s.replace(ANSI, "");

function env(home: string): Record<string, string> {
  return { ...(process.env as Record<string, string>), HOME: home, NO_COLOR: "1", TERM: "dumb" };
}
/** Copilot CLI keeps no status command: Beamhop notes a finished login itself (a token in the env counts too). */
const copilotMarker = (home: string) => `${home}/.copilot/.scut-signed-in`;
const COPILOT_ENV = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"];

/** Is the agent signed in to its subscription right now? */
export async function signinStatus(kind: SubscriptionKind, home: string): Promise<SigninState> {
  if (kind === "codex") {
    try {
      const p = Bun.spawn(["codex", "login", "status"], { env: env(home), stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: 20_000 });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      const text = clean(`${out}\n${err}`).trim();
      if (code === 0 && !/not logged in/i.test(text)) return { harness: kind, state: "signed-in", account: text.split("\n").find((l) => /logged in/i.test(l))?.trim() };
      return { harness: kind, state: "signed-out" };
    } catch (e: any) {
      return { harness: kind, state: "error", error: `Codex isn't installed for this agent: ${String(e?.message ?? e).slice(0, 160)}` };
    }
  }
  if (COPILOT_ENV.some((k) => process.env[k])) return { harness: kind, state: "signed-in", account: "with a token from the environment" };
  return { harness: kind, state: existsSync(copilotMarker(home)) ? "signed-in" : "signed-out" };
}

export type Signin = { cancel(): void; done: Promise<SigninState> };

/**
 * Start a device-code sign-in. `onUpdate` gets "waiting" with the link and code as soon as the CLI prints them, then
 * the result. The code expires after about 15 minutes; the CLI gives up then.
 */
export function startSignin(kind: SubscriptionKind, home: string, onUpdate: (s: SigninState) => void): Signin {
  const argv = kind === "codex" ? ["codex", "login", "--device-auth"] : ["copilot", "login", "--device-code"];
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(argv, { env: env(home), stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  } catch (e: any) {
    const s: SigninState = { harness: kind, state: "error", error: `Couldn't start the ${NAME[kind]} sign-in: ${String(e?.message ?? e).slice(0, 160)}` };
    onUpdate(s);
    return { cancel() {}, done: Promise.resolve(s) };
  }
  let text = "";
  let shown = false;
  let cancelled = false;
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const dec = new TextDecoder();
    for await (const chunk of stream) {
      text += clean(dec.decode(chunk, { stream: true }));
      if (shown) continue;
      const url = text.match(/https:\/\/\S+/)?.[0];
      const code = text.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4,6})\b/)?.[1];
      if (url && code) {
        shown = true;
        onUpdate({ harness: kind, state: "waiting", url: url.replace(/[).,]+$/, ""), code, expiresAt: Date.now() + 15 * 60_000 });
      }
    }
  };
  const done = (async (): Promise<SigninState> => {
    await Promise.all([read(proc.stdout as ReadableStream<Uint8Array>), read(proc.stderr as ReadableStream<Uint8Array>), proc.exited]);
    if (cancelled) return { harness: kind, state: "signed-out" };
    if (proc.exitCode === 0) {
      if (kind === "copilot") {
        await mkdir(`${home}/.copilot`, { recursive: true });
        await writeFile(copilotMarker(home), new Date().toISOString());
      }
      return signinStatus(kind, home);
    }
    const last = text.trim().split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 240);
    return { harness: kind, state: "error", error: /expired|timed? ?out/i.test(last) ? "The code expired. Start the sign-in again." : last || `The ${NAME[kind]} sign-in stopped.` };
  })();
  done.then(onUpdate);
  return { cancel() { cancelled = true; proc.kill(); }, done };
}

/** Sign the agent out of its subscription. */
export async function signOut(kind: SubscriptionKind, home: string): Promise<SigninState> {
  if (kind === "codex") {
    const p = Bun.spawn(["codex", "logout"], { env: env(home), stdout: "ignore", stderr: "ignore", stdin: "ignore", timeout: 20_000 });
    await p.exited;
  } else {
    const p = Bun.spawn(["copilot", "logout"], { env: env(home), stdout: "ignore", stderr: "ignore", stdin: "ignore", timeout: 20_000 });
    await p.exited.catch(() => {});
    await rm(copilotMarker(home), { force: true });
  }
  return signinStatus(kind, home);
}

/** Models the subscription offers, for the picker. Codex lists its catalog; Copilot CLI has no list (Auto picks). */
export async function subscriptionModels(kind: SubscriptionKind, home: string): Promise<{ id: string; name: string }[]> {
  if (kind !== "codex") return [];
  try {
    const p = Bun.spawn(["codex", "debug", "models"], { env: env(home), stdout: "pipe", stderr: "ignore", stdin: "ignore", timeout: 20_000 });
    const out = await new Response(p.stdout).text();
    const j = JSON.parse(out) as { models?: { slug: string; display_name?: string; visibility?: string }[] };
    return (j.models ?? []).filter((m) => m.visibility !== "hide").map((m) => ({ id: m.slug, name: m.display_name ?? m.slug }));
  } catch {
    return [];
  }
}
