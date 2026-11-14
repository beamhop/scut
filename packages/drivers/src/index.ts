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
  isolation: "vm" | "container";
  /** Rough cost estimate per month for 2 vCPU / 4 GB, in USD. 0 = local. */
  monthlyUsd: number;
  create(opts: CreateOpts): Promise<Instance>;
  destroy(inst: Instance): Promise<void>;
  /** Bring a stopped host back (e.g. after the computer restarted). Returns it with its current endpoint. */
  revive?(inst: Instance): Promise<Instance>;
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
