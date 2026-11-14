// Host drivers: each one only knows how to start the agent image with {BEAM_TICKET, a disk at /data}
// and give back the agent's endpoint. Everything after boot is identical on every host.

export interface CreateOpts {
  name: string; // unique, dns-safe
  image: string;
  env: Record<string, string>;
  cpus?: number;
  memoryMb?: number;
  diskGb?: number;
}

export interface Instance {
  driver: string;
  instanceId: string;
  endpoint: string; // http(s) base URL of agentd
  meta?: Record<string, string>;
}

export interface HostDriver {
  id: string;
  label: string;
  /** vm: microVM · container: Docker/Podman · sandbox: gVisor or WSL2 · none: runs directly on this computer. */
  isolation: "vm" | "container" | "sandbox" | "none";
  /** Rough cost estimate per month for 2 vCPU / 4 GB, in USD. 0 = local. */
  monthlyUsd: number;
  create(opts: CreateOpts): Promise<Instance>;
  destroy(inst: Instance): Promise<void>;
  /** Bring a stopped host back (e.g. after the computer restarted). Returns it with its current endpoint. */
  revive?(inst: Instance): Promise<Instance>;
  /** Is this host running an older build of `image` than the one on this computer? (Local hosts only.) */
  outdated?(inst: Instance, image: string): boolean;
  /**
   * Recreate the host from the current `image`, keeping its disk (/data). `check` must resolve once the new host is
   * up and holds the agent; if it throws, the old host is put back exactly as it was. Never deletes the disk.
   */
  upgrade?(inst: Instance, image: string, check: (next: Instance) => Promise<void>): Promise<Instance>;
  /**
   * Put the app's own agent code into this agent (absolute paths inside it), keeping what was there as `<path>.prev`,
   * and restart it on that code. Its /data is untouched. Local sandboxes only: their image can be older than the app.
   */
  installCode?(inst: Instance, files: Record<string, Uint8Array>): Promise<Instance>;
  /** Undo the last installCode (the `.prev` copies back) and restart. */
  restoreCode?(inst: Instance, paths: string[]): Promise<Instance>;
  /** Get the agent computer ready ahead of the first create (download it), reporting parts done/total. */
  prepare?(image: string, onProgress?: (p: { done: number; total: number }) => void): Promise<unknown>;
  /** Addresses the host's port listens on, on this computer (e.g. ["127.0.0.1"] or ["0.0.0.0"]). */
  boundHosts?(inst: Instance): string[];
}

export async function waitHealthy(endpoint: string, timeoutMs = 180_000): Promise<any> {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return await r.json();
      last = `${r.status}`;
    } catch (e: any) {
      last = e?.message ?? String(e);
    }
    await Bun.sleep(1000);
  }
  throw new Error(`agent at ${endpoint} not healthy after ${timeoutMs}ms (${last})`);
}

export { DockerDriver } from "./docker.ts";
export { SmolvmDriver } from "./smolvm.ts";
export { FlyDriver } from "./fly.ts";
export { RenderDriver } from "./render.ts";
export { RailwayDriver } from "./railway.ts";
export { GvisorDriver, GVISOR_VERSION, EngineUnavailable } from "./gvisor.ts";
export { pullImage, extractRootfs, parseRef } from "./oci.ts";
export { freePort } from "./util.ts";
export { WslDriver } from "./wsl.ts";
export { HostProcessDriver, serviceFiles, detectService, type HostRuntime, type ServiceKind } from "./host.ts";
export { ensureBrowser, installedBrowsers } from "./browser.ts";
export { chooseLocal, probeAll, localDriver, ladder, ENGINE_INFO, loadSaved, saveLocal, markBroken, ENGINE_LABEL, type Engine, type Probe, type LocalChoice } from "./local.ts";
