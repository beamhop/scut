// Local sandbox for Windows: each agent is its own WSL2 distro (a lightweight VM-backed Linux built into
// Windows 10/11), made from the agent image without Docker. The image is pulled once (oci.ts) and assembled into
// one root filesystem inside a temporary "build" distro (layers are piped in over stdin, whiteouts applied), then
// exported once; every agent is a `wsl --import` of that file. If WSL is switched off, turning it on is one admin
// prompt and a restart (enableWsl).
//
// All WSL2 distros share one network, so each agent gets its own port, DevTools port and X display. Ports bound
// inside are reachable on this computer's 127.0.0.1 (WSL's localhost forwarding).
import { existsSync, openSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { CreateOpts, HostDriver, Instance } from "./index.ts";
import { pruneBlobs, pullImage, type PulledImage } from "./oci.ts";
import { freePort, portInUse } from "./util.ts";
import { EngineUnavailable } from "./gvisor.ts";

const exe = () => process.env.SCUT_WSL_EXE ?? "wsl.exe";

/** wsl.exe prints UTF-16LE when not attached to a console. */
export function decodeWsl(b: Uint8Array): string {
  const looks16 = b.length > 1 && b.slice(0, 200).some((x, i) => i % 2 === 1 && x === 0);
  return (looks16 ? new TextDecoder("utf-16le").decode(b) : new TextDecoder().decode(b)).replace(/\0/g, "").replace(/\r/g, "");
}

export function wsl(args: string[], opts: { stdin?: string; timeout?: number } = {}): { code: number; out: string; err: string } {
  try {
    const p = Bun.spawnSync([exe(), ...args], {
      stdout: "pipe", stderr: "pipe", timeout: opts.timeout ?? 120_000,
      stdin: opts.stdin ? Bun.file(opts.stdin) : "ignore",
      env: { ...process.env, WSL_UTF8: "1" },
    });
    return { code: p.exitCode ?? 1, out: decodeWsl(p.stdout), err: decodeWsl(p.stderr) };
  } catch (e: any) {
    return { code: 127, out: "", err: String(e?.message ?? e) };
  }
}

/**
 * Apply one image layer (a tar.gz arriving on stdin) to the running distro's root, OCI whiteouts included.
 * /run, /dev, /proc, /sys and /tmp are left out: in a running distro WSL owns them (and /run/shm is /dev/shm).
 * Kept to POSIX sh + find + tar + cp, all in the base image. Exported for tests.
 */
export const APPLY_LAYER = `set -e
L=/tmp/.beamhop-layer
rm -rf "$L"; mkdir -p "$L"
tar -xzf - -C "$L" --same-owner --numeric-owner --anchored --exclude=run --exclude=./run --exclude=dev --exclude=./dev --exclude=proc --exclude=./proc --exclude=sys --exclude=./sys --exclude=tmp --exclude=./tmp
cd "$L"
find . -name '.wh..wh..opq' | while IFS= read -r f; do d=\${f%/.wh..wh..opq}; d=\${d#./}; [ -n "$d" ] && find "/$d" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true; rm -f "$f"; done
find . -name '.wh.*' | while IFS= read -r f; do b=\${f##*/}; dir=\${f%/*}; dir=\${dir#.}; rm -rf "$dir/\${b#.wh.}"; rm -f "$f"; done
cp -a --remove-destination "$L"/. /
cd /; rm -rf "$L"
`;

const START = `gw=$(awk '$2=="00000000"{print $3; exit}' /proc/net/route 2>/dev/null)
if [ -n "$gw" ]; then ip=$(bun -e "const h=process.argv[1];console.log([6,4,2,0].map(i=>parseInt(h.slice(i,i+2),16)).join('.'))" "$gw" 2>/dev/null || true); fi
grep -v ' host.docker.internal$' /etc/hosts > /tmp/.hosts 2>/dev/null || true
echo "\${ip:-127.0.0.1} host.docker.internal" >> /tmp/.hosts; cat /tmp/.hosts > /etc/hosts
mkdir -p /data
exec "$@"`;

type HostFile = { distro: string; env: Record<string, string>; port: number; cdp: number; display: number; digest: string; pid?: number };

export class WslDriver implements HostDriver {
  id: string;
  label: string;
  isolation = "sandbox" as const;
  monthlyUsd = 0;
  private home: string;
  private image?: { image: string; digest: string; tar: string; config: PulledImage["config"] };

  constructor(opts: { id?: string; label?: string; home: string }) {
    this.id = opts.id ?? "wsl";
    this.label = opts.label ?? "This computer (WSL)";
    this.home = opts.home;
  }

  /** Is WSL2 there and on? (No test boot needed: `--status` answers only when the WSL service works.) */
  static availability(): { available: boolean; reason?: string; action?: "enable-wsl" } {
    if (process.platform !== "win32" && !process.env.SCUT_WSL_EXE) return { available: false, reason: "WSL is for Windows" };
    const r = wsl(["--status"], { timeout: 30_000 });
    if (r.code === 127) return { available: false, reason: "WSL isn't installed. Turning it on takes one admin prompt and a restart.", action: "enable-wsl" };
    const text = `${r.out}\n${r.err}`;
    if (r.code !== 0) {
      if (/not installed|isn't installed|not enabled|Virtual Machine Platform|HCS_E_HYPERV_NOT_INSTALLED|0x80370102|0x8004032d/i.test(text))
        return { available: false, reason: "WSL isn't turned on. Turning it on takes one admin prompt and a restart.", action: "enable-wsl" };
      return { available: false, reason: `WSL isn't working: ${text.trim().split("\n")[0]?.slice(0, 160)}` };
    }
    if (/Default Version:\s*1\b/i.test(text)) return { available: true, reason: "WSL 1 is the default; Beamhop asks for WSL 2 per agent" };
    return { available: true };
  }

  /** Turn WSL on: one UAC prompt (PowerShell, elevated). Windows asks to restart afterwards. */
  static enableWsl(): { started: boolean; error?: string } {
    if (process.platform !== "win32") return { started: false, error: "Only on Windows" };
    try {
      const p = spawn("powershell.exe", ["-NoProfile", "-Command", "Start-Process wsl.exe -ArgumentList '--install','--no-distribution' -Verb RunAs"], { detached: true, stdio: "ignore", windowsHide: true });
      p.unref();
      return { started: true };
    } catch (e: any) {
      return { started: false, error: String(e?.message ?? e) };
    }
  }

  private distros(): string[] {
    return wsl(["--list", "--quiet"]).out.split("\n").map((s) => s.trim()).filter(Boolean);
  }

  private get imagesDir() { return join(this.home, "images"); }
  private dir(name: string) { return join(this.home, "wsl", name); }

  /** Pull the image and build the one root filesystem file every agent is imported from (first time only). */
  async prepare(image: string, onProgress?: (p: { done: number; total: number }) => void) {
    const img = await pullImage(image, this.imagesDir, onProgress);
    const tar = join(this.imagesDir, `${img.digest.replace(":", "-")}.wsl.tar`);
    if (!existsSync(tar)) {
      const build = `beamhop-build-${img.digest.slice(7, 19)}`;
      const bdir = join(this.home, "wsl", build);
      if (this.distros().includes(build)) wsl(["--unregister", build]);
      await rm(bdir, { recursive: true, force: true });
      await mkdir(bdir, { recursive: true });
      // The first layer is the base system: import it as is (decompressed), then pipe the others in.
      // Outside the folder WSL imports into (it holds that folder open), and fully closed before WSL reads it.
      const base = join(this.imagesDir, `base-${img.digest.slice(7, 19)}.tar`);
      await gunzipTo(img.layers[0].path, base);
      const imp = wsl(["--import", build, bdir, base, "--version", "2"], { timeout: 15 * 60_000 });
      await rm(base, { force: true });
      if (imp.code !== 0) {
        const text = (imp.err || imp.out).trim().replace(/\s+/g, " ").slice(0, 300);
        // The first import is also the first time WSL starts its VM: when that can't happen here (no virtualization,
        // e.g. a VM without nesting), WSL isn't an option on this computer. Anything else is an ordinary error.
        if (/HCS_E_HYPERV_NOT_INSTALLED|0x80370102|0x80370114|0x8004032d|Virtual Machine Platform|virtuali[sz]ation|WSL_E_VM_MODE|WSL2 is not supported|HCS_E_SERVICE_NOT_AVAILABLE/i.test(text))
          throw new EngineUnavailable("wsl", `WSL can't run Linux here: ${text}`);
        throw new Error(`Couldn't set up the agent computer in WSL: ${text}`);
      }
      try {
        for (const l of img.layers.slice(1)) {
          const r = wsl(["-d", build, "-u", "root", "--exec", "/bin/sh", "-c", APPLY_LAYER], { stdin: l.path, timeout: 30 * 60_000 });
          if (r.code !== 0) throw new Error(`Couldn't apply a layer of the agent computer: ${(r.err || r.out).trim().slice(-300)}`);
        }
        const tmp = `${tar}.part`;
        const ex = wsl(["--export", build, tmp], { timeout: 30 * 60_000 });
        if (ex.code !== 0) throw new Error(`Couldn't save the agent computer: ${(ex.err || ex.out).trim().slice(0, 300)}`);
        await rename(tmp, tar);
      } finally {
        wsl(["--unregister", build]);
        await rm(bdir, { recursive: true, force: true });
      }
    }
    this.image = { image, digest: img.digest, tar, config: img.config };
    await writeFile(join(this.imagesDir, `${encodeURIComponent(image)}.wsl.json`), JSON.stringify(this.image));
    // Agents are imported copies: older root filesystem files and blobs aren't needed by anything.
    await pruneBlobs(this.imagesDir, img);
    for (const f of await readdir(this.imagesDir).catch(() => [] as string[])) {
      if (f.endsWith(".wsl.tar") && join(this.imagesDir, f) !== tar) await rm(join(this.imagesDir, f), { force: true });
    }
    return this.image;
  }

  private async local(image: string) {
    if (this.image?.image === image && existsSync(this.image.tar)) return this.image;
    const f = join(this.imagesDir, `${encodeURIComponent(image)}.wsl.json`);
    if (!existsSync(f)) return undefined;
    const p = JSON.parse(await readFile(f, "utf8"));
    if (!existsSync(p.tar)) return undefined;
    return (this.image = p);
  }

  /** The command line that starts agentd in its distro. Exported shape for tests. */
  startArgs(h: HostFile, imgEnv: string[], args: string[]): string[] {
    const env = new Map<string, string>();
    for (const e of imgEnv) env.set(e.slice(0, e.indexOf("=")), e.slice(e.indexOf("=") + 1));
    for (const [k, v] of Object.entries(h.env)) env.set(k, v);
    env.set("PORT", String(h.port));
    env.set("SCUT_CDP_PORT", String(h.cdp));
    env.set("SCUT_DISPLAY", `:${h.display}`);
    env.set("SCUT_DATA", "/data");
    if (!env.has("HOME")) env.set("HOME", "/root");
    return ["-d", h.distro, "-u", "root", "--cd", "/", "--exec", "/usr/bin/env", "-i", ...[...env].map(([k, v]) => `${k}=${v}`), "/bin/sh", "-c", START, "sh", ...args];
  }

  private async start(name: string, h: HostFile) {
    const cfgFile = join(this.dir(name), "image.json");
    const cfg = JSON.parse(await readFile(cfgFile, "utf8")) as { env: string[]; args: string[] };
    const log = openSync(join(this.dir(name), "agent.log"), "a");
    // wsl.exe stays attached while agentd runs, which also keeps the distro (and WSL's VM) up. Detached: it
    // keeps running when the app closes.
    const p = spawn(exe(), this.startArgs(h, cfg.env, cfg.args), { detached: true, stdio: ["ignore", log, log], windowsHide: true, env: { ...process.env, WSL_UTF8: "1" } });
    p.unref();
    h.pid = p.pid;
    await writeFile(join(this.dir(name), "host.json"), JSON.stringify(h));
  }

  async create(o: CreateOpts): Promise<Instance> {
    const img = (await this.local(o.image)) ?? (await this.prepare(o.image));
    const name = `scut-${o.name}`;
    const distro = `beamhop-${o.name}`.slice(0, 60);
    const d = this.dir(name);
    await mkdir(d, { recursive: true });
    if (this.distros().includes(distro)) wsl(["--unregister", distro]);
    const imp = wsl(["--import", distro, join(d, "disk"), img.tar, "--version", "2"], { timeout: 15 * 60_000 });
    if (imp.code !== 0) {
      await rm(d, { recursive: true, force: true });
      throw new Error(`Couldn't make ${o.name}'s computer in WSL: ${(imp.err || imp.out).trim().slice(0, 300)}`);
    }
    await writeFile(join(d, "image.json"), JSON.stringify({ env: img.config.Env ?? [], args: [...(img.config.Entrypoint ?? []), ...(img.config.Cmd ?? [])] }));
    const h: HostFile = { distro, env: o.env, port: await freePort(), cdp: await freePort(), display: 100 + Math.floor(Math.random() * 800), digest: img.digest };
    try {
      await this.start(name, h);
    } catch (e) {
      await this.destroy({ driver: this.id, instanceId: name, endpoint: "", meta: { name } });
      throw e;
    }
    return { driver: this.id, instanceId: name, endpoint: `http://127.0.0.1:${h.port}`, meta: { name, distro, digest: img.digest } };
  }

  async revive(inst: Instance): Promise<Instance> {
    const name = inst.meta?.name ?? inst.instanceId;
    const f = join(this.dir(name), "host.json");
    if (!existsSync(f)) return inst;
    const h = JSON.parse(await readFile(f, "utf8")) as HostFile;
    const up = await fetch(`http://127.0.0.1:${h.port}/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
    if (up) return inst;
    wsl(["--terminate", h.distro]);
    if (await portInUse(h.port)) h.port = await freePort();
    if (await portInUse(h.cdp)) h.cdp = await freePort();
    await this.start(name, h);
    return { ...inst, endpoint: `http://127.0.0.1:${h.port}` };
  }

  boundHosts(): string[] {
    return ["127.0.0.1"];
  }

  async destroy(inst: Instance) {
    const name = inst.meta?.name ?? inst.instanceId;
    const f = join(this.dir(name), "host.json");
    const h = existsSync(f) ? (JSON.parse(await readFile(f, "utf8")) as HostFile) : undefined;
    const distro = h?.distro ?? inst.meta?.distro;
    if (distro) {
      wsl(["--terminate", distro]);
      wsl(["--unregister", distro]);
    }
    if (h?.pid) try { process.kill(h.pid); } catch {}
    await rm(this.dir(name), { recursive: true, force: true });
  }
}

async function gunzipTo(src: string, dest: string) {
  // node streams: the file handle is closed (not just flushed) when this resolves, which Windows needs.
  const { createReadStream, createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");
  const { createGunzip } = await import("node:zlib");
  await pipeline(createReadStream(src), createGunzip(), createWriteStream(dest));
}
