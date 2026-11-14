import type { CreateOpts, HostDriver, Instance } from "./index.ts";

/** Local container driver. Used for development and tests, and on machines without a hypervisor. */
export class DockerDriver implements HostDriver {
  id: string;
  label: string;
  isolation = "container" as const;
  monthlyUsd = 0;

  constructor(opts: { id?: string; label?: string; host?: string } = {}) {
    this.id = opts.id ?? "docker";
    this.label = opts.label ?? "This computer (Docker)";
    this.host = opts.host ?? "127.0.0.1";
  }
  private host: string;

  async create(o: CreateOpts): Promise<Instance> {
    const name = `scut-${o.name}`;
    const envArgs = Object.entries(o.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const args = [
      "docker", "run", "-d", "--name", name,
      "-p", `${this.host}::8080`,
      "-v", `${name}-data:/data`,
      "--shm-size", "512m",
      ...(o.cpus ? ["--cpus", String(o.cpus)] : []),
      ...(o.memoryMb ? ["-m", `${o.memoryMb}m`] : []),
      "--add-host", "host.docker.internal:host-gateway",
      // Dev only: trust an extra CA (e.g. a TLS-intercepting proxy) inside the agent.
      ...(process.env.SCUT_DEV_CA
        ? ["-v", `${process.env.SCUT_DEV_CA}:/etc/scut/extra-ca.crt:ro`, "-e", "SCUT_EXTRA_CA=/etc/scut/extra-ca.crt", "-e", "NODE_EXTRA_CA_CERTS=/etc/scut/extra-ca.crt", "-e", "SSL_CERT_FILE=/etc/scut/extra-ca.crt"]
        : []),
      ...envArgs,
      o.image,
    ];
    const p = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) throw new Error(`docker run failed: ${p.stderr.toString()}`);
    const id = p.stdout.toString().trim();
    const port = Bun.spawnSync(["docker", "port", name, "8080/tcp"], { stdout: "pipe" }).stdout.toString().trim().split("\n")[0].split(":").pop();
    return { driver: this.id, instanceId: id, endpoint: `http://${this.host}:${port}`, meta: { name } };
  }

  async destroy(inst: Instance) {
    const name = inst.meta?.name ?? inst.instanceId;
    Bun.spawnSync(["docker", "rm", "-f", name], { stdout: "ignore", stderr: "ignore" });
    Bun.spawnSync(["docker", "volume", "rm", "-f", `${name}-data`], { stdout: "ignore", stderr: "ignore" });
  }
}
