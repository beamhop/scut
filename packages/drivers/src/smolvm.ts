import type { CreateOpts, HostDriver, Instance } from "./index.ts";
import { EngineUnavailable } from "./gvisor.ts";
import { loadSmolmachines } from "./engine.ts";
import { backupScript } from "./util.ts";

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
   * First run, while you pick a brain: check a microVM can start here, then get the agent computer ready.
   * "Available" only says the hypervisor API is there; on some computers (VMs without nested virtualization, CI
   * runners) no microVM can actually start, so a tiny one boots first and the ladder can move on before an agent
   * fails. Then a throwaway VM is made from the agent image itself: that is what downloads and caches it (smolvm
   * pulls inside a helper VM, and `pullImage` only fills one machine's own storage), so Create starts in seconds.
   * The download reports no progress from outside, so it shows as one step with no total.
   */
  async prepare(image: string, onProgress?: (p: { done: number; total: number }) => void) {
    const M = await SmolvmDriver.load();
    if (!M) throw new EngineUnavailable("smolvm", SmolvmDriver.loadError ?? "smolvm engine not available on this platform");
    onProgress?.({ done: 0, total: 0 });
    const boot = async (name: string, img: string, resources: Record<string, unknown>) => {
      try {
        await M.create({ name, image: img, resources, detach: true, persistent: false });
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        if (NO_VM.test(msg)) throw new EngineUnavailable("smolvm", `A microVM can't start on this computer: ${msg.slice(0, 200)}`);
        throw e;
      } finally {
        await M.delete(name).catch(() => {});
      }
    };
    const stamp = Date.now().toString(36);
    await boot(`scut-vmcheck-${stamp}`, process.env.SCUT_VMCHECK_IMAGE ?? "mirror.gcr.io/library/alpine:3.20", { cpus: 1, memoryMb: 256, network: false });
    // network: true like a real agent: smolvm keeps separate image caches for VMs with and without network.
    await boot(`scut-warm-${stamp}`, image, { cpus: 1, memoryMb: 512, network: true });
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

  /**
   * Bring a stopped agent VM back (it stops when the app quits or the computer restarts): connecting to a stopped
   * local machine boots it again from its own disk. Picks up its published port, in case it changed.
   */
  async revive(inst: Instance): Promise<Instance> {
    const M = await SmolvmDriver.load();
    if (!M) return inst;
    const name = inst.meta?.name ?? inst.instanceId;
    const known = (await M.list().catch(() => [])) as { name: string }[];
    if (!known.some((m) => m.name === name)) return inst; // gone; nothing to revive
    const m = await M.connect(name, { waitForPorts: false });
    if ((await m.state()) !== "running") await m.start({ waitUntilReady: true });
    const port = ((await m.ports().catch(() => [])) as { host?: number; guest: number }[]).find((p) => p.guest === 8080)?.host;
    return port ? { ...inst, endpoint: `http://127.0.0.1:${port}` } : inst;
  }

  private async machine(inst: Instance) {
    const M = await SmolvmDriver.load();
    if (!M) throw new EngineUnavailable("smolvm", "smolvm engine not available on this platform");
    const m = await M.connect(inst.meta?.name ?? inst.instanceId, { waitForPorts: false });
    if ((await m.state()) !== "running") await m.start({ waitUntilReady: true });
    return m;
  }

  /** A stop and start of the VM, on the code now on its disk; picks up its port. */
  private async restart(inst: Instance): Promise<Instance> {
    const m = await this.machine(inst);
    await m.sync?.().catch(() => {});
    await m.stop();
    return this.revive(inst);
  }

  async installCode(inst: Instance, files: Record<string, Uint8Array>): Promise<Instance> {
    const m = await this.machine(inst);
    const sh = await m.exec(["/bin/sh", "-c", backupScript(Object.keys(files))]);
    if (sh?.exitCode) throw new Error(`Couldn't prepare the agent for its update: ${String(sh.stderr ?? "").slice(0, 200)}`);
    for (const [p, data] of Object.entries(files)) await m.writeFile(p, data);
    return this.restart(inst);
  }

  async restoreCode(inst: Instance, paths: string[]): Promise<Instance> {
    const m = await this.machine(inst);
    await m.exec(["/bin/sh", "-c", backupScript(paths, true)]);
    return this.restart(inst);
  }

  async destroy(inst: Instance) {
    const M = await SmolvmDriver.load();
    await M?.delete(inst.instanceId).catch(() => {});
  }
}
