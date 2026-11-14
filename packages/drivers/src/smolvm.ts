import type { CreateOpts, HostDriver, Instance } from "./index.ts";

/**
 * Local microVM driver using the embedded smolvm engine (smolmachines SDK: KVM on Linux,
 * Hypervisor.framework on Apple Silicon). The SDK is an optional native dependency, loaded lazily.
 * Verified here: the SDK loads under Bun and reports availability. Booting needs KVM, which the
 * build machine lacks, so create/destroy are untested end to end.
 */
export class SmolvmDriver implements HostDriver {
  id = "smolvm";
  label = "This computer (microVM)";
  isolation = "vm" as const;
  monthlyUsd = 0;

  private static sdk: any;
  static async load(): Promise<any | null> {
    if (SmolvmDriver.sdk !== undefined) return SmolvmDriver.sdk;
    try {
      SmolvmDriver.sdk = (await import("smolmachines")).Machine;
    } catch {
      SmolvmDriver.sdk = null;
    }
    return SmolvmDriver.sdk;
  }

  /** Is a local microVM possible here? Returns the engine's own reason when not. */
  static async availability(): Promise<{ available: boolean; reason?: string }> {
    const M = await SmolvmDriver.load();
    if (!M) return { available: false, reason: "smolvm engine not installed for this platform" };
    try {
      const a = M.localAvailability();
      return a.available ? { available: true } : { available: false, reason: a.reason };
    } catch (e: any) {
      return { available: false, reason: String(e?.message ?? e) };
    }
  }

  async create(o: CreateOpts): Promise<Instance> {
    const M = await SmolvmDriver.load();
    if (!M) throw new Error("smolvm engine not available on this platform");
    const port = 20000 + Math.floor(Math.random() * 20000);
    const name = `scut-${o.name}`;
    await M.create({
      name,
      image: o.image,
      env: o.env,
      ports: [{ host: port, guest: 8080 }],
      resources: { cpus: o.cpus ?? 2, memoryMb: o.memoryMb ?? 3072, network: true, storageGb: o.diskGb ?? 20 },
      detach: true, // the agent outlives the app; reconnect with Machine.connect(name)
      persistent: true,
      labels: { owner: "scut" },
    });
    return { driver: this.id, instanceId: name, endpoint: `http://127.0.0.1:${port}`, meta: { name } };
  }

  async destroy(inst: Instance) {
    const M = await SmolvmDriver.load();
    await M?.delete(inst.instanceId).catch(() => {});
  }
}
