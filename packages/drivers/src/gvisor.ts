// Local sandbox for Linux computers without hardware virtualization (no KVM: most VPSes, VMs without nested
// virtualization, laptops with it switched off). gVisor's runsc runs the agent image in a user-space kernel
// (systrap platform), rootless, with nothing to install: Beamhop downloads runsc once (checked against its
// published SHA-512) and pulls the image itself (oci.ts), so neither Docker nor root is needed.
//
// Each agent gets <home>/hosts/<name>/{bundle,data,overlay,state}: /data is a real folder on this computer (it
// survives restarts and is what a beam carries); the image's root filesystem is shared and read-only, with each
// agent's writes going to its own overlay. The network is the host's, so the agent's port is on 127.0.0.1.
import { mkdir, readdir, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync, openSync } from "node:fs";
import type { CreateOpts, HostDriver, Instance } from "./index.ts";
import { extractRootfs, pruneBlobs, pullImage } from "./oci.ts";
import { freePort, portInUse, run } from "./util.ts";

export const GVISOR_VERSION = "20261109.0";
const GVISOR_SHA512: Record<string, string> = {
  x86_64: "1a6b8f74c37b4931ef473f67ec1f601690855bedc52ac709f2fac965c69677aa0426ef44598d8eee1aed72cfdb9df87a2a5f352cb3348880fc61a7732bc10f2a",
  aarch64: "411f2d6f7f98a93643725ce9933ff67a7f96f884c2317be3e2b579b976ceb54065bd1d4292a9d61de38da1940ef21b7e41070127874086b7992fb7b5e7a85897",
};
const arch = () => (process.arch === "arm64" ? "aarch64" : "x86_64");

type Prepared = { image: string; digest: string; rootfs: string; env: string[]; args: string[]; cwd: string };

export class GvisorDriver implements HostDriver {
  id: string;
  label: string;
  isolation = "sandbox" as const;
  monthlyUsd = 0;
  private home: string;
  private prepared = new Map<string, Prepared>();

  constructor(opts: { id?: string; label?: string; home: string }) {
    this.id = opts.id ?? "gvisor";
    this.label = opts.label ?? "This computer (sandbox)";
    this.home = opts.home;
  }

  private get engineDir() { return `${this.home}/engines/gvisor-${GVISOR_VERSION}`; }
  private get runsc() { return process.env.SCUT_RUNSC ?? `${this.engineDir}/runsc`; }
  private get root() { return process.getuid?.() === 0; }
  private flags(stateDir: string, overlay?: string) {
    return [
      `--root=${stateDir}`,
      ...(this.root ? [] : ["--rootless"]),
      "--network=host",
      "--ignore-cgroups",
      ...(overlay ? [`--overlay2=root:dir=${overlay}`] : []),
    ];
  }

  /** Can gVisor run here? Linux only; the real answer comes from a tiny test sandbox (`runsc do /bin/true`). */
  static async availability(home: string, opts: { download?: boolean } = {}): Promise<{ available: boolean; reason?: string }> {
    if (process.platform !== "linux") return { available: false, reason: "gVisor runs on Linux only" };
    if (process.arch !== "x64" && process.arch !== "arm64") return { available: false, reason: `gVisor isn't built for ${process.arch}` };
    const d = new GvisorDriver({ home });
    if (!existsSync(d.runsc)) {
      if (!opts.download) return { available: true, reason: "not downloaded yet" };
      try { await d.ensureRunsc(); } catch (e: any) { return { available: false, reason: String(e?.message ?? e) }; }
    }
    return d.selfTest();
  }

  selfTest(): { available: boolean; reason?: string } {
    const state = `${this.home}/engines/gvisor-test-state`;
    const r = run([this.runsc, ...this.flags(state), "--network=none", "do", "/bin/true"], { timeout: 60_000, cwd: "/" });
    rm(state, { recursive: true, force: true }).catch(() => {});
    if (r.code === 0) return { available: true };
    const why = (r.err.trim().split("\n").pop() ?? "").slice(0, 200);
    return { available: false, reason: /user namespace|EPERM|operation not permitted/i.test(r.err)
      ? `This computer doesn't allow sandboxes for normal users (user namespaces are restricted). ${why}`
      : `The sandbox engine couldn't start here: ${why}` };
  }

  /** Download and unpack runsc once (pinned version, SHA-512 checked). */
  async ensureRunsc(): Promise<string> {
    if (existsSync(this.runsc)) return this.runsc;
    const a = arch();
    const url = `https://storage.googleapis.com/gvisor/releases/release/${GVISOR_VERSION}/${a}/gvisor.tar.bz2`;
    await mkdir(this.engineDir, { recursive: true });
    const tmp = `${this.engineDir}/gvisor.tar.bz2`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!r.ok) throw new Error(`Couldn't download the sandbox engine (${r.status})`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    const sum = new Bun.CryptoHasher("sha512").update(bytes).digest("hex");
    if (sum !== GVISOR_SHA512[a]) throw new Error("The sandbox engine download is damaged (checksum mismatch); try again");
    await Bun.write(tmp, bytes);
    const x = run(["tar", "-xjf", tmp, "-C", this.engineDir], { timeout: 120_000 });
    await rm(tmp, { force: true });
    if (x.code !== 0 || !existsSync(this.runsc)) throw new Error(`Couldn't unpack the sandbox engine: ${x.err.slice(0, 200)}`);
    return this.runsc;
  }

  /** Pull and unpack the agent image (first time only; reused while its digest is the same). */
  async prepare(image: string, onProgress?: (p: { done: number; total: number }) => void): Promise<Prepared> {
    await this.ensureRunsc();
    const img = await pullImage(image, `${this.home}/images`, onProgress);
    const rootfs = `${this.home}/images/${img.digest.replace(":", "-")}/rootfs`;
    const ready = `${rootfs}/../.ready`;
    if (!existsSync(ready)) {
      await extractRootfs(img.layers, rootfs);
      await writeFile(ready, new Date().toISOString());
    }
    const c = img.config;
    const p: Prepared = { image, digest: img.digest, rootfs, env: c.Env ?? [], args: [...(c.Entrypoint ?? []), ...(c.Cmd ?? [])], cwd: c.WorkingDir || "/" };
    this.prepared.set(image, p);
    await writeFile(`${this.home}/images/${encodeURIComponent(image)}.json`, JSON.stringify(p));
    await pruneBlobs(`${this.home}/images`, img);
    await this.pruneRootfs();
    return p;
  }

  /** Remove unpacked images (~3 GB each) that neither the current image nor any agent here uses any more. */
  private async pruneRootfs() {
    const used = new Set([...this.prepared.values()].map((p) => p.digest.replace(":", "-")));
    for (const h of await readdir(`${this.home}/hosts`).catch(() => [] as string[])) {
      const f = `${this.home}/hosts/${h}/host.json`;
      if (existsSync(f)) used.add((JSON.parse(await readFile(f, "utf8")) as { digest: string }).digest.replace(":", "-"));
    }
    for (const d of await readdir(`${this.home}/images`).catch(() => [] as string[])) {
      if (d.startsWith("sha256-") && !d.includes(".") && !used.has(d)) await rm(`${this.home}/images/${d}`, { recursive: true, force: true });
    }
  }

  /** The last prepared copy of `image` on this computer (no network). */
  private async local(image: string): Promise<Prepared | undefined> {
    if (this.prepared.has(image)) return this.prepared.get(image);
    const f = `${this.home}/images/${encodeURIComponent(image)}.json`;
    if (!existsSync(f)) return undefined;
    const p = JSON.parse(await readFile(f, "utf8")) as Prepared;
    if (!existsSync(p.rootfs)) return undefined;
    this.prepared.set(image, p);
    return p;
  }

  private dir(name: string) { return `${this.home}/hosts/${name}`; }

  private async writeBundle(name: string, img: Prepared, env: Record<string, string>, port: number, cdp: number) {
    const d = this.dir(name);
    await mkdir(`${d}/bundle`, { recursive: true });
    await mkdir(`${d}/data`, { recursive: true });
    await mkdir(`${d}/overlay`, { recursive: true });
    // Agents reach this computer (e.g. a local Ollama) as host.docker.internal, as they do in Docker.
    await writeFile(`${d}/hosts`, "127.0.0.1 localhost host.docker.internal\n::1 localhost\n");
    const ca = process.env.SCUT_DEV_CA;
    const merged = new Map<string, string>();
    for (const e of img.env) merged.set(e.slice(0, e.indexOf("=")), e.slice(e.indexOf("=") + 1));
    for (const [k, v] of Object.entries(env)) merged.set(k, v);
    merged.set("PORT", String(port));
    merged.set("SCUT_CDP_PORT", String(cdp));
    if (!merged.has("HOME")) merged.set("HOME", "/root");
    if (ca) for (const k of ["SCUT_EXTRA_CA", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"]) merged.set(k, "/etc/scut/extra-ca.crt");
    const spec = {
      ociVersion: "1.0.2",
      process: { terminal: false, user: { uid: 0, gid: 0 }, args: img.args, env: [...merged].map(([k, v]) => `${k}=${v}`), cwd: img.cwd },
      root: { path: img.rootfs, readonly: false },
      hostname: name.slice(0, 63),
      mounts: [
        { destination: "/proc", type: "proc", source: "proc" },
        { destination: "/dev", type: "tmpfs", source: "tmpfs", options: ["nosuid", "strictatime", "mode=755"] },
        { destination: "/sys", type: "sysfs", source: "sysfs", options: ["nosuid", "noexec", "nodev", "ro"] },
        { destination: "/dev/shm", type: "tmpfs", source: "shm", options: ["nosuid", "noexec", "nodev", "size=536870912"] },
        { destination: "/tmp", type: "tmpfs", source: "tmpfs", options: ["nosuid", "nodev"] },
        { destination: "/data", type: "bind", source: `${d}/data`, options: ["rbind", "rw"] },
        { destination: "/etc/hosts", type: "bind", source: `${d}/hosts`, options: ["rbind", "ro"] },
        ...(ca ? [{ destination: "/etc/scut/extra-ca.crt", type: "bind", source: ca, options: ["rbind", "ro"] }] : []),
      ],
      linux: { namespaces: [{ type: "pid" }, { type: "ipc" }, { type: "uts" }, { type: "mount" }] },
    };
    await writeFile(`${d}/bundle/config.json`, JSON.stringify(spec, null, 2));
    await writeFile(`${d}/host.json`, JSON.stringify({ image: img.image, digest: img.digest, env, port, cdp }));
  }

  private state(name: string): string {
    const r = run([this.runsc, ...this.flags(`${this.dir(name)}/state`), "state", name]);
    if (r.code !== 0) return "";
    try { return (JSON.parse(r.out) as { status: string }).status; } catch { return ""; }
  }

  private async start(name: string) {
    const d = this.dir(name);
    await mkdir(`${d}/state`, { recursive: true });
    // Output goes to a file: `run --detach` leaves the sandbox holding its stdio, and a pipe would never close.
    const log = openSync(`${d}/runsc.log`, "a");
    const p = Bun.spawn([this.runsc, ...this.flags(`${d}/state`, `${d}/overlay`), "run", "--detach", "--bundle", `${d}/bundle`, name], {
      stdin: "ignore", stdout: log, stderr: log,
    });
    const code = await p.exited;
    if (code !== 0) {
      const tail = (await readFile(`${d}/runsc.log`, "utf8").catch(() => "")).trim().split("\n").slice(-3).join(" ");
      throw new Error(`The sandbox didn't start: ${tail.slice(0, 300)}`);
    }
  }

  private stopSandbox(name: string) {
    const flags = this.flags(`${this.dir(name)}/state`);
    run([this.runsc, ...flags, "kill", name, "KILL"], { timeout: 15_000 });
    run([this.runsc, ...flags, "delete", "-force", name], { timeout: 30_000 });
  }

  async create(o: CreateOpts): Promise<Instance> {
    const img = (await this.local(o.image)) ?? (await this.prepare(o.image));
    const name = `scut-${o.name}`;
    const port = await freePort();
    const cdp = await freePort();
    await this.writeBundle(name, img, o.env, port, cdp);
    try {
      await this.start(name);
    } catch (e) {
      await this.destroy({ driver: this.id, instanceId: name, endpoint: "", meta: { name } });
      throw e;
    }
    return { driver: this.id, instanceId: name, endpoint: `http://127.0.0.1:${port}`, meta: { name, digest: img.digest } };
  }

  /** After a restart of the computer the sandbox is gone but its folder is not: start it again. */
  async revive(inst: Instance): Promise<Instance> {
    const name = inst.meta?.name ?? inst.instanceId;
    const d = this.dir(name);
    if (!existsSync(`${d}/host.json`)) return inst;
    if (this.state(name) === "running") return inst;
    this.stopSandbox(name);
    const h = JSON.parse(await readFile(`${d}/host.json`, "utf8")) as { image: string; digest: string; env: Record<string, string>; port: number; cdp: number };
    const img = await this.local(h.image);
    if (!img) return inst;
    const port = (await portInUse(h.port)) ? await freePort() : h.port;
    const cdp = (await portInUse(h.cdp)) ? await freePort() : h.cdp;
    // Same root filesystem it was made from when that is still here, so a revive is never an upgrade.
    const same = h.digest === img.digest ? img : { ...img, rootfs: `${this.home}/images/${h.digest.replace(":", "-")}/rootfs`, digest: h.digest };
    await this.writeBundle(name, existsSync(same.rootfs) ? same : img, h.env, port, cdp);
    await this.start(name);
    return { ...inst, endpoint: `http://127.0.0.1:${port}` };
  }

  outdated(inst: Instance, image: string): boolean {
    const p = this.prepared.get(image);
    return !!p && !!inst.meta?.digest && inst.meta.digest !== p.digest;
  }

  async upgrade(inst: Instance, image: string, check: (next: Instance) => Promise<void>): Promise<Instance> {
    if (!this.outdated(inst, image)) return inst;
    const name = inst.meta?.name ?? inst.instanceId;
    const d = this.dir(name);
    const h = JSON.parse(await readFile(`${d}/host.json`, "utf8")) as { image: string; digest: string; env: Record<string, string>; port: number; cdp: number };
    const img = this.prepared.get(image)!;
    const oldBundle = await readFile(`${d}/bundle/config.json`, "utf8");
    const oldHost = await readFile(`${d}/host.json`, "utf8");
    // agentd writes as it goes; stop it, keep /data, start the new image on the same folder.
    this.stopSandbox(name);
    await rm(`${d}/overlay`, { recursive: true, force: true });
    await this.writeBundle(name, img, h.env, h.port, h.cdp);
    const next = { ...inst, meta: { ...inst.meta, name, digest: img.digest } };
    try {
      await this.start(name);
      await check(next);
      return next;
    } catch (e) {
      this.stopSandbox(name);
      await writeFile(`${d}/bundle/config.json`, oldBundle);
      await writeFile(`${d}/host.json`, oldHost);
      await this.start(name).catch(() => {});
      throw e;
    }
  }

  boundHosts(): string[] {
    return ["127.0.0.1"];
  }

  async destroy(inst: Instance) {
    const name = inst.meta?.name ?? inst.instanceId;
    this.stopSandbox(name);
    this.unmountUnder(this.dir(name));
    await rm(this.dir(name), { recursive: true, force: true });
  }

  /** Run as root, runsc leaves a namespace handle mounted in its state folder; let go of it before deleting. */
  private unmountUnder(dir: string) {
    if (!this.root) return;
    const mounts = existsSync("/proc/mounts") ? require("node:fs").readFileSync("/proc/mounts", "utf8") as string : "";
    for (const line of mounts.split("\n")) {
      const at = line.split(" ")[1];
      if (at && at.startsWith(`${dir}/`)) run(["umount", "-l", at]);
    }
  }
}
