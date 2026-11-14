import type { CreateOpts, HostDriver, Instance } from "./index.ts";
import { backupScript, stageFiles } from "./util.ts";

/** Local container driver. Used for development and tests, and on machines without a hypervisor. */
export class DockerDriver implements HostDriver {
  id: string;
  label: string;
  isolation = "container" as const;
  monthlyUsd = 0;

  constructor(opts: { id?: string; label?: string; host?: string; bin?: "docker" | "podman" } = {}) {
    this.bin = opts.bin ?? "docker";
    this.id = opts.id ?? this.bin;
    this.label = opts.label ?? (this.bin === "podman" ? "This computer (Podman)" : "This computer (Docker)");
    this.host = opts.host ?? "127.0.0.1";
  }
  private host: string;
  /** docker, or podman (same command line). */
  readonly bin: "docker" | "podman";

  static imagePresent(image: string, bin = "docker"): boolean {
    try {
      return Bun.spawnSync([bin, "image", "inspect", image], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
    } catch {
      return false; // no docker at all
    }
  }

  /** Is there a Docker engine to talk to? (Used only where the built-in microVM engine isn't available.) */
  static available(bin = "docker"): { ok: boolean; reason?: string } {
    const name = bin === "podman" ? "Podman" : "Docker";
    try {
      const p = Bun.spawnSync([bin, "info", "--format", bin === "podman" ? "{{.Host.OS}}" : "{{.OSType}}"], { stdout: "pipe", stderr: "pipe", timeout: 10_000 });
      // Docker on Windows can be in Windows-containers mode: it answers, but can't run the (Linux) agent image.
      if (p.exitCode === 0) return p.stdout.toString().trim() === "windows" ? { ok: false, reason: `${name} is set to Windows containers; switch it to Linux containers` } : { ok: true };
      return { ok: false, reason: `${name} is installed but not running` };
    } catch {
      return { ok: false, reason: `${name} isn't installed` };
    }
  }

  /** Download the agent image, reporting layers done/total as docker prints them. */
  static async pull(image: string, onProgress?: (p: { done: number; total: number }) => void, bin = "docker"): Promise<void> {
    const p = Bun.spawn([bin, "pull", image], { stdout: "pipe", stderr: "pipe" });
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

  /** First run: download the image ahead of the first create. */
  async prepare(image: string, onProgress?: (p: { done: number; total: number }) => void) {
    const engine = DockerDriver.available(this.bin);
    if (!engine.ok) throw new Error(engine.reason);
    if (DockerDriver.imagePresent(image, this.bin)) return;
    await DockerDriver.pull(image, onProgress, this.bin);
  }

  async revive(inst: Instance): Promise<Instance> {
    const name = inst.meta?.name ?? inst.instanceId;
    const running = Bun.spawnSync([this.bin, "inspect", "-f", "{{.State.Running}}", name], { stdout: "pipe", stderr: "ignore" }).stdout.toString().trim();
    if (running === "") return inst; // gone; nothing to revive
    if (running !== "true") Bun.spawnSync([this.bin, "start", name], { stdout: "ignore", stderr: "ignore" });
    // The host port is picked at start, so it can differ from last time.
    const port = Bun.spawnSync([this.bin, "port", name, "8080/tcp"], { stdout: "pipe" }).stdout.toString().trim().split("\n")[0].split(":").pop();
    return port ? { ...inst, endpoint: `http://${this.host}:${port}` } : inst;
  }

  private runArgs(name: string, image: string, env: Record<string, string>, o: { cpus?: number; memoryMb?: number } = {}): string[] {
    const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    return [
      this.bin, "run", "-d", "--name", name,
      "-p", `${this.host}::8080`,
      "-v", `${name}-data:/data`,
      "--shm-size", "512m",
      "--restart", "unless-stopped", // come back after Docker or the computer restarts
      ...(o.cpus ? ["--cpus", String(o.cpus)] : []),
      ...(o.memoryMb ? ["-m", `${o.memoryMb}m`] : []),
      "--add-host", "host.docker.internal:host-gateway",
      // Dev only: trust an extra CA (e.g. a TLS-intercepting proxy) inside the agent.
      ...(process.env.SCUT_DEV_CA
        ? ["-v", `${process.env.SCUT_DEV_CA}:/etc/scut/extra-ca.crt:ro`, "-e", "SCUT_EXTRA_CA=/etc/scut/extra-ca.crt", "-e", "NODE_EXTRA_CA_CERTS=/etc/scut/extra-ca.crt", "-e", "SSL_CERT_FILE=/etc/scut/extra-ca.crt"]
        : []),
      ...envArgs,
      image,
    ];
  }

  private async run(name: string, args: string[]): Promise<Instance> {
    // Async: a first-time image download inside `docker run` must not freeze the app's server.
    const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (code !== 0) throw new Error(`docker run failed: ${err}`);
    const id = out.trim();
    const port = Bun.spawnSync([this.bin, "port", name, "8080/tcp"], { stdout: "pipe" }).stdout.toString().trim().split("\n")[0].split(":").pop();
    return { driver: this.id, instanceId: id, endpoint: `http://${this.host}:${port}`, meta: { name } };
  }

  async create(o: CreateOpts): Promise<Instance> {
    const engine = DockerDriver.available(this.bin);
    if (!engine.ok) throw new Error(engine.reason);
    const name = `scut-${o.name}`;
    return this.run(name, this.runArgs(name, o.image, o.env, o));
  }

  private inspect(args: string[]): string {
    try {
      const p = Bun.spawnSync([this.bin, ...args], { stdout: "pipe", stderr: "ignore", timeout: 15_000 });
      return p.exitCode === 0 ? p.stdout.toString().trim() : "";
    } catch {
      return "";
    }
  }

  outdated(inst: Instance, image: string): boolean {
    const name = inst.meta?.name ?? inst.instanceId;
    const want = this.inspect(["image", "inspect", "-f", "{{.Id}}", image]);
    const have = this.inspect(["inspect", "-f", "{{.Image}}", name]);
    return !!want && !!have && want !== have;
  }

  async upgrade(inst: Instance, image: string, check: (next: Instance) => Promise<void>): Promise<Instance> {
    const name = inst.meta?.name ?? inst.instanceId;
    if (!this.outdated(inst, image)) return inst;
    // What the container was started with, minus what its (old) image sets by itself: BEAM_TICKET, test overrides…
    const oldImage = this.inspect(["inspect", "-f", "{{.Image}}", name]);
    const parse = (j: string) => { try { return (JSON.parse(j) ?? []) as string[]; } catch { return []; } };
    const imageEnv = new Set(parse(this.inspect(["image", "inspect", "-f", "{{json .Config.Env}}", oldImage])));
    const own = /^(SCUT_EXTRA_CA|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)=/; // re-added by runArgs when still wanted
    const env = Object.fromEntries(
      parse(this.inspect(["inspect", "-f", "{{json .Config.Env}}", name]))
        .filter((e) => !imageEnv.has(e) && !own.test(e))
        .map((e) => [e.slice(0, e.indexOf("=")), e.slice(e.indexOf("=") + 1)]),
    );
    const nano = Number(this.inspect(["inspect", "-f", "{{.HostConfig.NanoCpus}}", name]) || 0);
    const mem = Number(this.inspect(["inspect", "-f", "{{.HostConfig.Memory}}", name]) || 0);
    const limits = { cpus: nano ? nano / 1e9 : undefined, memoryMb: mem ? Math.round(mem / 1048576) : undefined };
    const backup = `${name}-before-update`;
    const sh = (...a: string[]) => Bun.spawnSync([this.bin, ...a], { stdout: "ignore", stderr: "pipe", timeout: 60_000 });
    sh("rm", "-f", backup); // a leftover from an earlier attempt that never finished
    // Stop it cleanly (agentd writes as it goes; the disk is a named volume that outlives the container).
    sh("stop", "-t", "20", name);
    if (sh("rename", name, backup).exitCode !== 0) {
      sh("start", name);
      throw new Error(`couldn't set ${name} aside for the update`);
    }
    const rollback = () => {
      sh("rm", "-f", name);
      sh("rename", backup, name);
      sh("start", name);
    };
    let next: Instance;
    try {
      next = await this.run(name, this.runArgs(name, image, env, limits));
      await check(next);
    } catch (e) {
      rollback();
      throw e;
    }
    sh("rm", backup); // the old container only; its disk is the one the new container uses
    return next;
  }

  boundHosts(inst: Instance): string[] {
    const name = inst.meta?.name ?? inst.instanceId;
    return this.inspect(["port", name, "8080/tcp"]).split("\n").filter(Boolean).map((l) => l.slice(0, l.lastIndexOf(":")).replace(/^\[|\]$/g, ""));
  }

  async destroy(inst: Instance) {
    const name = inst.meta?.name ?? inst.instanceId;
    Bun.spawnSync([this.bin, "rm", "-f", name], { stdout: "ignore", stderr: "ignore" });
    Bun.spawnSync([this.bin, "volume", "rm", "-f", `${name}-data`], { stdout: "ignore", stderr: "ignore" });
  }

  async installCode(inst: Instance, files: Record<string, Uint8Array>): Promise<Instance> {
    const name = inst.meta?.name ?? inst.instanceId;
    Bun.spawnSync([this.bin, "start", name], { stdout: "ignore", stderr: "ignore" });
    const b = Bun.spawnSync([this.bin, "exec", name, "/bin/sh", "-c", backupScript(Object.keys(files))], { stdout: "pipe", stderr: "pipe" });
    if (b.exitCode !== 0) throw new Error(`Couldn't prepare the agent for its update: ${b.stderr.toString().slice(0, 200)}`);
    const st = await stageFiles(files);
    try {
      const cp = Bun.spawnSync([this.bin, "cp", `${st.dir}/.`, `${name}:/`], { stdout: "pipe", stderr: "pipe" });
      if (cp.exitCode !== 0) throw new Error(`Couldn't copy the agent's code: ${cp.stderr.toString().slice(0, 200)}`);
    } finally {
      await st.cleanup();
    }
    Bun.spawnSync([this.bin, "restart", name], { stdout: "ignore", stderr: "ignore" });
    return this.revive(inst);
  }

  async restoreCode(inst: Instance, paths: string[]): Promise<Instance> {
    const name = inst.meta?.name ?? inst.instanceId;
    Bun.spawnSync([this.bin, "start", name], { stdout: "ignore", stderr: "ignore" });
    Bun.spawnSync([this.bin, "exec", name, "/bin/sh", "-c", backupScript(paths, true)], { stdout: "ignore", stderr: "ignore" });
    Bun.spawnSync([this.bin, "restart", name], { stdout: "ignore", stderr: "ignore" });
    return this.revive(inst);
  }

}
