// The last resort: the agent runs directly on this computer, without a sandbox. Only when the person chose it.
// agentd runs as a normal process of theirs (the app's own code: `scut agentd`), with its data in
// <home>/hosts/<name>/data, its port on 127.0.0.1 only, and its screen a headless browser of its own (CdpScreen):
// it never moves the person's mouse or looks at their screen. Same tools, approvals, live view, Take over and beams
// as in a sandbox; what it lacks is the wall around it, so it says "No sandbox" everywhere and asks before touching
// anything outside its workspace.
//
// It keeps running when the app closes, like a sandboxed agent: a per-user service where the computer has one
// (systemd --user on Linux, a LaunchAgent on macOS, a logon task on Windows), else a detached process that the app
// starts again after a restart (revive).
import { existsSync, openSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { CreateOpts, HostDriver, Instance } from "./index.ts";
import { ensureBrowser } from "./browser.ts";
import { freePort, portInUse, run } from "./util.ts";

export type ServiceKind = "systemd" | "launchd" | "schtasks" | "none";

export type HostRuntime = {
  /** How to start agentd: e.g. [execPath, "agentd"] (compiled app) or [bun, ".../main.ts", "agentd"]. */
  agentd: string[];
  /** How to start the computer-use MCP server, same shape. */
  mcp: string[];
  /** A bun to install harnesses with (the compiled app is one, with BUN_BE_BUN=1). */
  bun: string[];
  bunEnv?: Record<string, string>;
  /** The agent's own web UI (phone view, start page). */
  uiDir?: string;
  /** Changes when the app's code changes (a new app binary): running agents restart on it when idle. */
  version?: string;
};

type HostFile = { env: Record<string, string>; port: number; service: ServiceKind; pid?: number; version?: string };

const HARNESS_PACKAGES: Record<string, string> = {
  pi: "@earendil-works/pi-coding-agent",
  codex: "@openai/codex",
  copilot: "@github/copilot",
  opencode: "opencode-ai",
};

export class HostProcessDriver implements HostDriver {
  id: string;
  label: string;
  isolation = "none" as const;
  monthlyUsd = 0;
  private home: string;
  private rt: HostRuntime;
  /** Which per-user service manager to use; tests and SCUT_HOST_SERVICE=none pick plain processes. */
  service: ServiceKind;

  constructor(opts: { id?: string; label?: string; home: string; runtime: HostRuntime; service?: ServiceKind }) {
    this.id = opts.id ?? "host";
    this.label = opts.label ?? "This computer (no sandbox)";
    this.home = opts.home;
    this.rt = opts.runtime;
    this.service = opts.service ?? (process.env.SCUT_HOST_SERVICE as ServiceKind | undefined) ?? detectService();
  }

  private dir(name: string) { return join(this.home, "hosts", name); }
  private get harnessDir() { return join(this.home, "harness"); }
  private get browserDir() { return join(this.home, "engines"); }

  /** Browser, plus the default harness (Pi) installed for this computer. Progress counts those two parts. */
  async prepare(_image: string, onProgress?: (p: { done: number; total: number }) => void, harnesses: string[] = ["pi"]) {
    const total = 1 + harnesses.length;
    onProgress?.({ done: 0, total });
    await ensureBrowser(this.browserDir);
    let done = 1;
    onProgress?.({ done, total });
    for (const h of harnesses) {
      await this.installHarness(h);
      onProgress?.({ done: ++done, total });
    }
  }

  /** Small shims so harness CLIs that start with `#!/usr/bin/env node` work on computers without Node. */
  private async writeShims() {
    const shim = join(this.harnessDir, "shim");
    await mkdir(shim, { recursive: true });
    const env = Object.entries(this.rt.bunEnv ?? {});
    if (process.platform === "win32") {
      const body = `@echo off\r\n${env.map(([k, v]) => `set "${k}=${v}"\r\n`).join("")}"${this.rt.bun[0]}" ${this.rt.bun.slice(1).map((a) => `"${a}"`).join(" ")} %*\r\n`;
      for (const n of ["node.cmd", "bun.cmd"]) await writeFile(join(shim, n), body);
    } else {
      const body = `#!/bin/sh\n${env.map(([k, v]) => `export ${k}=${sq(v)}\n`).join("")}exec ${this.rt.bun.map(sq).join(" ")} "$@"\n`;
      for (const n of ["node", "bun"]) {
        await writeFile(join(shim, n), body);
        await chmod(join(shim, n), 0o755);
      }
    }
  }

  async installHarness(harness: string) {
    const pkg = HARNESS_PACKAGES[harness];
    if (!pkg) return; // mock and anything built in need nothing
    const bin = join(this.harnessDir, "bin");
    const marker = join(this.harnessDir, `.installed-${harness}`);
    if (existsSync(marker)) return;
    await mkdir(bin, { recursive: true });
    await this.writeShims();
    const r = run([...this.rt.bun, "add", "-g", pkg], {
      timeout: 15 * 60_000,
      env: { ...process.env, ...(this.rt.bunEnv ?? {}), BUN_INSTALL_GLOBAL_DIR: join(this.harnessDir, "lib"), BUN_INSTALL_BIN: bin },
    });
    if (r.code !== 0) throw new Error(`Couldn't install the ${harness} agent software: ${(r.err || r.out).trim().split("\n").slice(-2).join(" ").slice(0, 300)}`);
    await writeFile(marker, new Date().toISOString());
  }

  /** PATH for the agent: its harnesses first, then the computer's own, then the node/bun shims as a fallback. */
  private path() {
    return [join(this.harnessDir, "bin"), process.env.PATH ?? "", join(this.harnessDir, "shim")].filter(Boolean).join(delimiter);
  }

  private async writeLauncher(name: string, env: Record<string, string>) {
    const d = this.dir(name);
    const cmd = this.rt.agentd;
    const log = join(d, "agent.log");
    if (process.platform === "win32") {
      const lines = ["@echo off", ...Object.entries(env).map(([k, v]) => `set "${k}=${v.replace(/%/g, "%%")}"`), `cd /d "${join(d, "data")}"`, `${cmd.map((a) => `"${a}"`).join(" ")} >> "${log}" 2>&1`];
      await writeFile(join(d, "run.cmd"), lines.join("\r\n") + "\r\n");
    } else {
      const lines = ["#!/bin/sh", ...Object.entries(env).map(([k, v]) => `export ${k}=${sq(v)}`), `cd ${sq(join(d, "data"))}`, `exec ${cmd.map(sq).join(" ")} >> ${sq(log)} 2>&1`];
      await writeFile(join(d, "run.sh"), lines.join("\n") + "\n");
      await chmod(join(d, "run.sh"), 0o700); // holds the agent's env: readable by this user only
    }
  }

  private launcher(name: string) {
    return process.platform === "win32" ? join(this.dir(name), "run.cmd") : join(this.dir(name), "run.sh");
  }

  private async envFor(name: string, o: { env: Record<string, string>; port: number; browser: string }) {
    const d = this.dir(name);
    const ca = process.env.SCUT_DEV_CA;
    return {
      ...o.env,
      HOME: process.env.HOME ?? homedir(),
      ...(process.platform === "win32" ? { USERPROFILE: process.env.USERPROFILE ?? homedir(), SystemRoot: process.env.SystemRoot ?? "C:\\Windows", LOCALAPPDATA: process.env.LOCALAPPDATA ?? "" } : {}),
      PATH: this.path(),
      SCUT_DATA: join(d, "data"),
      PORT: String(o.port),
      SCUT_BIND: "127.0.0.1",
      SCUT_SCREEN: "cdp",
      SCUT_BROWSER: o.browser,
      SCUT_UNSANDBOXED: "1",
      SCUT_MCP_CMD: this.rt.mcp.join(" "),
      ...(this.rt.uiDir ? { SCUT_UI_DIR: this.rt.uiDir } : {}),
      // Not bunEnv: BUN_BE_BUN would turn the app binary into plain bun for agentd itself. Only the shims set it.
      ...(ca ? { NODE_EXTRA_CA_CERTS: ca, SSL_CERT_FILE: ca } : {}),
    };
  }

  async create(o: CreateOpts): Promise<Instance> {
    const name = `scut-${o.name}`;
    const d = this.dir(name);
    await mkdir(join(d, "data"), { recursive: true });
    const browser = await ensureBrowser(this.browserDir);
    const port = await freePort();
    const env = await this.envFor(name, { env: o.env, port, browser });
    await this.writeLauncher(name, env);
    const host: HostFile = { env: o.env, port, service: this.service, version: this.rt.version };
    await writeFile(join(d, "host.json"), JSON.stringify(host));
    await chmod(join(d, "host.json"), 0o600).catch(() => {});
    try {
      await this.start(name, host);
    } catch (e) {
      await this.destroy({ driver: this.id, instanceId: name, endpoint: "", meta: { name } });
      throw e;
    }
    return { driver: this.id, instanceId: name, endpoint: `http://127.0.0.1:${port}`, meta: { name, isolation: "none" } };
  }

  private async start(name: string, host: HostFile) {
    const d = this.dir(name);
    if (host.service !== "none") {
      const unit = serviceFiles(host.service, name, this.launcher(name));
      await mkdir(unit.dir, { recursive: true });
      await writeFile(unit.path, unit.body);
      for (const c of unit.install) {
        const r = run(c, { timeout: 30_000 });
        if (r.code !== 0 && !unit.tolerate?.(c, r)) throw new Error(`Couldn't register ${name} to start by itself: ${(r.err || r.out).trim().slice(0, 200)}`);
      }
      return;
    }
    const log = openSync(join(d, "agent.log"), "a");
    const cmd = process.platform === "win32" ? ["cmd.exe", "/d", "/c", this.launcher(name)] : ["/bin/sh", this.launcher(name)];
    // Its own process group, detached: it keeps running when the app closes.
    const p = spawn(cmd[0], cmd.slice(1), { detached: true, stdio: ["ignore", log, log], windowsHide: true });
    p.unref();
    host.pid = p.pid;
    await writeFile(join(d, "host.json"), JSON.stringify(host));
  }

  private async stop(name: string, host?: HostFile) {
    const d = this.dir(name);
    const h = host ?? (existsSync(join(d, "host.json")) ? (JSON.parse(await readFile(join(d, "host.json"), "utf8")) as HostFile) : undefined);
    if (!h) return;
    if (h.service !== "none") {
      const unit = serviceFiles(h.service, name, this.launcher(name));
      for (const c of unit.uninstall) run(c, { timeout: 30_000 });
      await rm(unit.path, { force: true });
      if (h.service === "systemd") run(["systemctl", "--user", "daemon-reload"]);
    }
    if (h.pid) killTree(h.pid);
    // Whatever is still holding the port (agentd started some other way, e.g. by the service) goes too.
    await waitPortFree(h.port, 10_000);
  }

  async revive(inst: Instance): Promise<Instance> {
    const name = inst.meta?.name ?? inst.instanceId;
    const d = this.dir(name);
    if (!existsSync(join(d, "host.json"))) return inst;
    const h = JSON.parse(await readFile(join(d, "host.json"), "utf8")) as HostFile;
    const ok = await fetch(`http://127.0.0.1:${h.port}/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
    if (ok) return { ...inst, endpoint: `http://127.0.0.1:${h.port}` };
    await this.stop(name, h);
    if (await portInUse(h.port)) h.port = await freePort();
    const browser = await ensureBrowser(this.browserDir);
    await this.writeLauncher(name, await this.envFor(name, { env: h.env, port: h.port, browser }));
    h.pid = undefined;
    await writeFile(join(d, "host.json"), JSON.stringify(h));
    await this.start(name, h);
    return { ...inst, endpoint: `http://127.0.0.1:${h.port}` };
  }

  boundHosts(): string[] {
    return ["127.0.0.1"];
  }

  /** Running on older app code than this app's (the app was updated). */
  outdated(inst: Instance): boolean {
    const f = join(this.dir(inst.meta?.name ?? inst.instanceId), "host.json");
    if (!this.rt.version || !existsSync(f)) return false;
    try { return (JSON.parse(require("node:fs").readFileSync(f, "utf8")) as HostFile).version !== this.rt.version; } catch { return false; }
  }

  /**
   * Restart on this app's code, keeping its data. There's no old copy to go back to (the app itself was replaced),
   * so if the check fails it is left started on the new code and the error is reported.
   */
  async upgrade(inst: Instance, _image: string, check: (next: Instance) => Promise<void>): Promise<Instance> {
    const name = inst.meta?.name ?? inst.instanceId;
    const d = this.dir(name);
    const h = JSON.parse(await readFile(join(d, "host.json"), "utf8")) as HostFile;
    await this.stop(name, h);
    const browser = await ensureBrowser(this.browserDir);
    await this.writeLauncher(name, await this.envFor(name, { env: h.env, port: h.port, browser }));
    h.pid = undefined;
    h.version = this.rt.version;
    await writeFile(join(d, "host.json"), JSON.stringify(h));
    await this.start(name, h);
    const next = { ...inst, endpoint: `http://127.0.0.1:${h.port}` };
    await check(next);
    return next;
  }

  async destroy(inst: Instance) {
    const name = inst.meta?.name ?? inst.instanceId;
    await this.stop(name);
    await rm(this.dir(name), { recursive: true, force: true });
  }
}

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function killTree(pid: number) {
  if (process.platform === "win32") {
    run(["taskkill", "/T", "/F", "/PID", String(pid)]);
    return;
  }
  for (const sig of ["SIGTERM", "SIGKILL"] as const) {
    try { process.kill(-pid, sig); } catch {}
    try { process.kill(pid, sig); } catch {}
    if (sig === "SIGTERM") Bun.sleepSync(500);
  }
}

async function waitPortFree(port: number, ms: number) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms && (await portInUse(port))) await Bun.sleep(200);
}

/** Which per-user service manager this computer has. */
export function detectService(): ServiceKind {
  if (process.platform === "darwin") return "launchd";
  if (process.platform === "win32") return "schtasks";
  const r = run(["systemctl", "--user", "is-system-running"], { timeout: 5000 });
  return /^(running|degraded|starting)/.test(r.out.trim()) ? "systemd" : "none";
}

/** The service definition for one agent, and the commands that install / remove it. Exported for tests. */
export function serviceFiles(kind: Exclude<ServiceKind, "none">, name: string, launcher: string, home = process.env.HOME ?? homedir()): {
  dir: string; path: string; body: string; install: string[][]; uninstall: string[][]; tolerate?: (c: string[], r: { code: number; err: string }) => boolean;
} {
  if (kind === "systemd") {
    const dir = join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "systemd", "user");
    const unit = `beamhop-${name}.service`;
    return {
      dir, path: join(dir, unit),
      body: `[Unit]\nDescription=Beamhop agent ${name} (no sandbox)\nAfter=network-online.target\n\n[Service]\nExecStart=/bin/sh ${launcher}\nRestart=on-failure\nRestartSec=5\nKillMode=control-group\n\n[Install]\nWantedBy=default.target\n`,
      install: [["systemctl", "--user", "daemon-reload"], ["systemctl", "--user", "enable", "--now", unit]],
      uninstall: [["systemctl", "--user", "disable", "--now", unit]],
    };
  }
  if (kind === "launchd") {
    const dir = join(home, "Library", "LaunchAgents");
    const label = `com.beamhop.${name}`;
    const uid = process.getuid?.() ?? 501;
    const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return {
      dir, path: join(dir, `${label}.plist`),
      body: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array><string>/bin/sh</string><string>${x(launcher)}</string></array>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n<key>ProcessType</key><string>Background</string>\n</dict></plist>\n`,
      install: [["launchctl", "bootstrap", `gui/${uid}`, join(dir, `${label}.plist`)]],
      uninstall: [["launchctl", "bootout", `gui/${uid}/${label}`]],
      // Already loaded (e.g. a revive): that's fine, kickstart it instead.
      tolerate: (c, r) => c[1] === "bootstrap" && /already|5: Input\/output error/i.test(r.err) && run(["launchctl", "kickstart", "-k", `gui/${uid}/${label}`]).code === 0,
    };
  }
  const task = `Beamhop\\${name}`;
  return {
    dir: join(home, ".beamhop-tasks"), path: join(home, ".beamhop-tasks", `${name}.txt`),
    body: `Logon task ${task} runs ${launcher}\r\n`,
    install: [
      ["schtasks", "/Create", "/F", "/TN", task, "/SC", "ONLOGON", "/RL", "LIMITED", "/TR", `cmd.exe /d /c "${launcher}"`],
      ["schtasks", "/Run", "/TN", task],
    ],
    uninstall: [["schtasks", "/End", "/TN", task], ["schtasks", "/Delete", "/F", "/TN", task]],
  };
}
