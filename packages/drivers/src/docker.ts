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

  static imagePresent(image: string): boolean {
    try {
      return Bun.spawnSync(["docker", "image", "inspect", image], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
    } catch {
      return false; // no docker at all
    }
  }

  /** Is there a Docker engine to talk to? (Used only where the built-in microVM engine isn't available.) */
  static available(): { ok: boolean; reason?: string } {
    try {
      const p = Bun.spawnSync(["docker", "info", "--format", "{{.ServerVersion}}"], { stdout: "pipe", stderr: "pipe", timeout: 10_000 });
      if (p.exitCode === 0) return { ok: true };
      return { ok: false, reason: "Docker is installed but not running. Start Docker Desktop (or the Docker service) and reopen Beamhop." };
    } catch {
      return { ok: false, reason: "This computer can't run agents yet: its built-in virtualization isn't available here and Docker isn't installed. Install Docker Desktop, or add a cloud and run your agents there." };
    }
  }

  /** Download the agent image, reporting layers done/total as docker prints them. */
  static async pull(image: string, onProgress?: (p: { done: number; total: number }) => void): Promise<void> {
    const p = Bun.spawn(["docker", "pull", image], { stdout: "pipe", stderr: "pipe" });
    const layers = new Map<string, string>();
    let rest = "";
    for await (const chunk of p.stdout as ReadableStream<Uint8Array>) {
      rest += new TextDecoder().decode(chunk);
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) {
        const m = line.match(/^([0-9a-f]{12}): (.+)$/);
        if (!m) continue;
        // Config blobs only ever say "Download complete"; real layers also say "Pulling fs layer", "Waiting", etc.
        const prev = layers.get(m[1]);
        let next: "done" | "blob" | "layer";
        if (prev === "done" || /Pull complete|Already exists/.test(m[2])) next = "done";
        else if (m[2] === "Download complete" && (!prev || prev === "blob")) next = "blob";
        else next = "layer";
        layers.set(m[1], next);
        const real = [...layers.values()].filter((v) => v !== "blob");
        onProgress?.({ done: real.filter((v) => v === "done").length, total: real.length });
      }
    }
    if ((await p.exited) !== 0) throw new Error(`Couldn't download the agent computer: ${(await new Response(p.stderr).text()).trim().slice(-300)}`);
  }

  async create(o: CreateOpts): Promise<Instance> {
    const engine = DockerDriver.available();
    if (!engine.ok) throw new Error(engine.reason);
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
