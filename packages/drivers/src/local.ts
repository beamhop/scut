// Where agents run on this computer. The ladder, best first:
//   1. smolvm microVM      Apple Silicon Macs, Linux with KVM
//   2. built-in sandbox    Windows: WSL2 · Linux without KVM: gVisor
//   3. Docker or Podman    only when already installed
//   4. no sandbox          last resort, only when the person chose it
// Each rung is checked for real (a test boot where that is cheap), the first that works is used and remembered,
// and the remembered one is checked again on the next start. Intel Macs aren't supported.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { HostDriver } from "./index.ts";
import { DockerDriver } from "./docker.ts";
import { SmolvmDriver } from "./smolvm.ts";
import { GvisorDriver } from "./gvisor.ts";
import { WslDriver } from "./wsl.ts";
import { HostProcessDriver, type HostRuntime } from "./host.ts";
import { installedBrowsers } from "./browser.ts";
import { run } from "./util.ts";

export type Engine = "smolvm" | "wsl" | "gvisor" | "docker" | "podman" | "host";
export type Probe = { engine: Engine; available: boolean; reason?: string; action?: "enable-wsl" };
export type LocalChoice = { engine: Engine | null; probes: Probe[]; hostAllowed: boolean; unsupported?: string };

export const ENGINE_LABEL: Record<Engine, string> = {
  smolvm: "This computer",
  wsl: "This computer",
  gvisor: "This computer",
  docker: "This computer (Docker)",
  podman: "This computer (Podman)",
  host: "This computer (no sandbox)",
};

/** What each engine is, in the words the create screen uses to offer it. */
export const ENGINE_INFO: Record<Engine, { name: string; isolation: "vm" | "container" | "sandbox" | "none"; blurb: string }> = {
  smolvm: { name: "MicroVM", isolation: "vm", blurb: "Its own tiny virtual machine with its own kernel. The strongest wall, built in." },
  wsl: { name: "WSL2 virtual machine", isolation: "vm", blurb: "A Linux virtual machine built into Windows." },
  gvisor: { name: "gVisor sandbox", isolation: "sandbox", blurb: "A user-space kernel between the agent and this computer. Built in." },
  docker: { name: "Docker container", isolation: "container", blurb: "A container in the Docker you already have. Shares this computer's kernel." },
  podman: { name: "Podman container", isolation: "container", blurb: "A container in the Podman you already have. Shares this computer's kernel." },
  host: { name: "No sandbox", isolation: "none", blurb: "A normal program on this computer with a browser of its own. Nothing walls it off." },
};

/** The rungs for this platform, in order. */
export function ladder(platform: string = process.platform, arch: string = process.arch): Engine[] {
  if (platform === "darwin") return arch === "arm64" ? ["smolvm", "docker", "podman", "host"] : [];
  if (platform === "win32") return ["wsl", "docker", "podman", "host"];
  if (platform === "linux") return ["smolvm", "gvisor", "docker", "podman", "host"];
  return ["docker", "podman", "host"];
}

export type Probes = Partial<Record<Engine, () => Promise<Probe>>>;

/** The real checks. Each is cheap; none downloads anything (gVisor's own test boot runs once it is downloaded). */
export function realProbes(home: string): Probes {
  return {
    smolvm: async () => ({ engine: "smolvm", ...(await SmolvmDriver.availability()) }),
    wsl: async () => ({ engine: "wsl", ...WslDriver.availability() }),
    gvisor: async () => {
      const a = await GvisorDriver.availability(home);
      // Not downloaded yet: the same kernel feature runsc needs (user namespaces) answers for it until then.
      if (a.available && a.reason === "not downloaded yet") {
        // Ubuntu 23.10+ lets normal users make user namespaces but strips what runsc needs from them (AppArmor).
        const apparmor = (() => { try { return require("node:fs").readFileSync("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8").trim() === "1"; } catch { return false; } })();
        const u = process.getuid?.() === 0 || (!apparmor && run(["unshare", "-Ur", "true"], { timeout: 10_000 }).code === 0);
        return u ? { engine: "gvisor", available: true } : { engine: "gvisor", available: false, reason: "This computer doesn't allow sandboxes for normal users (user namespaces are restricted)" };
      }
      return { engine: "gvisor", available: a.available, reason: a.reason };
    },
    docker: async () => {
      const a = DockerDriver.available("docker");
      return { engine: "docker", available: a.ok, reason: a.reason };
    },
    podman: async () => {
      const a = DockerDriver.available("podman");
      return { engine: "podman", available: a.ok, reason: a.reason };
    },
    host: async () => ({
      engine: "host",
      available: true,
      reason: installedBrowsers().length ? undefined : "No Chrome, Edge or Chromium here: Beamhop downloads a browser for the agent first",
    }),
  };
}

type Saved = { engine?: Engine; hostAllowed?: boolean; at?: number; broken?: Partial<Record<Engine, { at: number; reason: string }>> };
const BROKEN_FOR = 7 * 24 * 3600_000; // an engine that failed its real test is tried again after a week

/** An engine failed for real (e.g. gVisor's own test after its download): skip it from now on, for a while. */
export async function markBroken(home: string, engine: Engine, reason: string) {
  const s = await loadSaved(home);
  await saveLocal(home, { broken: { ...(s.broken ?? {}), [engine]: { at: Date.now(), reason } }, ...(s.engine === engine ? { engine: undefined } : {}) });
}
const file = (home: string) => `${home}/engine.json`;

export async function loadSaved(home: string): Promise<Saved> {
  try { return JSON.parse(await readFile(file(home), "utf8")) as Saved; } catch { return {}; }
}
export async function saveLocal(home: string, s: Saved) {
  await mkdir(home, { recursive: true });
  const next: Record<string, unknown> = { ...(await loadSaved(home)), ...s, at: Date.now() };
  for (const [k, v] of Object.entries(s)) if (v === undefined) delete next[k];
  await writeFile(file(home), JSON.stringify(next, null, 2));
}

/**
 * Pick the engine. SCUT_LOCAL_DRIVER forces one (tests, support). The remembered engine is re-checked first and
 * kept if it still works; otherwise every rung is checked in order. "host" is only picked when allowed.
 */
export async function chooseLocal(home: string, opts: { probes?: Probes; platform?: string; arch?: string } = {}): Promise<LocalChoice> {
  const saved = await loadSaved(home);
  const hostAllowed = !!saved.hostAllowed;
  const order = ladder(opts.platform, opts.arch);
  const probes = { ...realProbes(home), ...(opts.probes ?? {}) };
  if (!order.length) return { engine: null, probes: [], hostAllowed, unsupported: "Beamhop needs a Mac with Apple Silicon (M1 or newer), Windows or Linux." };
  // SCUT_LOCAL_DRIVER=none (tests, demos): act like a computer with no sandbox engine at all.
  if (process.env.SCUT_LOCAL_DRIVER === "none") {
    const none: Probes = Object.fromEntries(order.filter((e) => e !== "host").map((e) => [e, async () => ({ engine: e, available: false, reason: `${e}: not on this computer (SCUT_LOCAL_DRIVER=none)` })]));
    Object.assign(probes, none);
  }
  const forced = process.env.SCUT_LOCAL_DRIVER === "none" ? undefined : (process.env.SCUT_LOCAL_DRIVER as Engine | undefined);
  if (forced) return { engine: forced, probes: [{ engine: forced, available: true, reason: "chosen with SCUT_LOCAL_DRIVER" }], hostAllowed };
  const results: Probe[] = [];
  for (const [e, b] of Object.entries(saved.broken ?? {}) as [Engine, { at: number; reason: string }][]) {
    if (Date.now() - b.at < BROKEN_FOR) probes[e] = async () => ({ engine: e, available: false, reason: b.reason });
  }
  const check = async (e: Engine) => {
    const p = await probes[e]!().catch((err: any) => ({ engine: e, available: false, reason: String(err?.message ?? err) }));
    results.push(p);
    return p;
  };
  if (saved.engine && order.includes(saved.engine) && process.env.SCUT_LOCAL_DRIVER !== "none" && (saved.engine !== "host" || hostAllowed)) {
    if ((await check(saved.engine)).available) return { engine: saved.engine, probes: results, hostAllowed };
  }
  for (const e of order) {
    if (results.some((r) => r.engine === e)) continue;
    if (e === "host" && !hostAllowed) {
      results.push({ engine: "host", available: false, reason: "Not chosen: runs without a sandbox" });
      continue;
    }
    if ((await check(e)).available) {
      await saveLocal(home, { engine: e });
      return { engine: e, probes: results, hostAllowed };
    }
  }
  return { engine: null, probes: results, hostAllowed };
}

/**
 * Every rung of this computer's ladder, each checked, so the person can pick one per agent. Engines that failed their
 * real test lately stay listed as unavailable, with the reason. "host" is always available here: picking it is the
 * person's own choice (the create screen asks first).
 */
export async function probeAll(home: string, opts: { probes?: Probes; platform?: string; arch?: string } = {}): Promise<Probe[]> {
  const order = ladder(opts.platform, opts.arch);
  const probes = { ...realProbes(home), ...(opts.probes ?? {}) };
  const saved = await loadSaved(home);
  const forced = process.env.SCUT_LOCAL_DRIVER;
  return Promise.all(order.map(async (e): Promise<Probe> => {
    if (forced === "none" && e !== "host") return { engine: e, available: false, reason: `${e}: not on this computer (SCUT_LOCAL_DRIVER=none)` };
    if (forced && forced !== "none" && e !== "host" && e !== forced) return { engine: e, available: false, reason: `Not used: SCUT_LOCAL_DRIVER=${forced}` };
    const b = saved.broken?.[e];
    if (b && Date.now() - b.at < BROKEN_FOR) return { engine: e, available: false, reason: b.reason };
    return probes[e]!().catch((err: any) => ({ engine: e, available: false, reason: String(err?.message ?? err) }));
  }));
}

/** The driver for an engine, registered as "local". */
export function localDriver(engine: Engine, home: string, runtime: HostRuntime): HostDriver {
  const label = ENGINE_LABEL[engine];
  switch (engine) {
    case "smolvm": return Object.assign(new SmolvmDriver(), { id: "local", label });
    case "gvisor": return new GvisorDriver({ id: "local", label, home });
    case "wsl": return new WslDriver({ id: "local", label, home });
    case "docker": return new DockerDriver({ id: "local", label });
    case "podman": return new DockerDriver({ id: "local", label, bin: "podman" });
    case "host": return new HostProcessDriver({ id: "local", label, home, runtime });
  }
}

