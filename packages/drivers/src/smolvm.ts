import type { CreateOpts, HostDriver, Instance } from "./index.ts";
import { EngineUnavailable } from "./gvisor.ts";
import { loadSmolmachines } from "./engine.ts";

/** libkrun/hypervisor errors that mean "no VM can start on this computer", not "this one agent failed". */
const NO_VM = /krun_start_enter|VmCreate|start vm|Hypervisor|HV_|KVM|kvm|EINVAL/;

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
  private static loadError?: string;
  static async load(): Promise<any | null> {
    if (SmolvmDriver.sdk !== undefined) return SmolvmDriver.sdk;
    try {
      SmolvmDriver.sdk = (await loadSmolmachines()).Machine;
    } catch (e: any) {
      SmolvmDriver.sdk = null;
      SmolvmDriver.loadError = String(e?.message ?? e);
    }
    return SmolvmDriver.sdk;
  }

  /** Is a local microVM possible here? Returns the engine's own reason when not. */
  static async availability(): Promise<{ available: boolean; reason?: string }> {
    const M = await SmolvmDriver.load();
    if (!M) return { available: false, reason: SmolvmDriver.loadError ?? "smolvm engine not available on this platform" };
    try {
      const a = M.localAvailability();
      return a.available ? { available: true } : { available: false, reason: a.reason };
    } catch (e: any) {
      return { available: false, reason: String(e?.message ?? e) };
    }
  }

  /**
   * "Available" only says the hypervisor API is there; on some computers (VMs without nested virtualization, CI
   * runners) no microVM can actually start. Boot a tiny one first, so the ladder can move on before an agent fails.
   */
  async prepare(_image: string, onProgress?: (p: { done: number; total: number }) => void) {
    const M = await SmolvmDriver.load();
    if (!M) throw new EngineUnavailable("smolvm", "smolvm engine not installed for this platform");
    onProgress?.({ done: 0, total: 1 });
    const name = `scut-vmcheck-${Date.now().toString(36)}`;
    try {
      await M.create({ name, image: process.env.SCUT_VMCHECK_IMAGE ?? "mirror.gcr.io/library/alpine:3.20", resources: { cpus: 1, memoryMb: 256, network: false }, detach: true, persistent: false });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (NO_VM.test(msg)) throw new EngineUnavailable("smolvm", `A microVM can't start on this computer: ${msg.slice(0, 200)}`);
      throw e;
    } finally {
      await M.delete(name).catch(() => {});
    }
    onProgress?.({ done: 1, total: 1 });
  }

  async create(o: CreateOpts): Promise<Instance> {
    const M = await SmolvmDriver.load();
    if (!M) throw new EngineUnavailable("smolvm", "smolvm engine not available on this platform");
    const port = 20000 + Math.floor(Math.random() * 20000);
    const name = `scut-${o.name}`;
    try {
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
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (NO_VM.test(msg)) throw new EngineUnavailable("smolvm", `A microVM can't start on this computer: ${msg.slice(0, 200)}`);
      throw e;
    }
    return { driver: this.id, instanceId: name, endpoint: `http://127.0.0.1:${port}`, meta: { name } };
  }

  async destroy(inst: Instance) {
    const M = await SmolvmDriver.load();
    await M?.delete(inst.instanceId).catch(() => {});
  }
}
