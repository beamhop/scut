import type { CreateOpts, HostDriver, Instance } from "./index.ts";

/**
 * Local microVM driver (Linux KVM, macOS Hypervisor.framework, Windows WHP) using the embedded smolvm runtime.
 * UNTESTED: the build machine has no KVM. CLI flags follow the smolvm README and must be verified on a laptop.
 */
export class SmolvmDriver implements HostDriver {
  id = "smolvm";
  label = "This computer (microVM)";
  isolation = "vm" as const;
  monthlyUsd = 0;

  constructor(private bin = process.env.SCUT_SMOLVM_BIN ?? "smolvm", private dataRoot = `${process.env.HOME}/.scut/vms`) {}

  async create(o: CreateOpts): Promise<Instance> {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const disk = `${this.dataRoot}/${o.name}`;
    await Bun.$`mkdir -p ${disk}`.quiet();
    const envArgs = Object.entries(o.env).flatMap(([k, v]) => ["--env", `${k}=${v}`]);
    const args = [
      this.bin, "machine", "run", "--detach", "--name", `scut-${o.name}`,
      "--image", o.image,
      "--cpus", String(o.cpus ?? 2), "--memory", `${o.memoryMb ?? 3072}`,
      "--volume", `${disk}:/data`,
      "--port", `${port}:8080`,
      "--net",
      ...envArgs,
    ];
    const p = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) throw new Error(`smolvm failed: ${p.stderr.toString()}`);
    return { driver: this.id, instanceId: `scut-${o.name}`, endpoint: `http://127.0.0.1:${port}`, meta: { disk } };
  }

  async destroy(inst: Instance) {
    Bun.spawnSync([this.bin, "machine", "rm", "--force", inst.instanceId], { stdout: "ignore", stderr: "ignore" });
  }
}
