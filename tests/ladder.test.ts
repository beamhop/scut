// The local ladder (best engine that works, remembered, re-checked) and the per-user service definitions used to
// keep no-sandbox agents running. Pure logic with fake probes: runs anywhere, no engines needed.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { chooseLocal, ladder, loadSaved, saveLocal, serviceFiles, type Engine, type Probe } from "@scut/drivers";

delete process.env.SCUT_LOCAL_DRIVER;
const home = () => mkdtempSync(`${tmpdir()}/scut-ladder-`);
function fake(ok: Partial<Record<Engine, boolean>>, calls: Engine[] = []) {
  const all: Engine[] = ["smolvm", "wsl", "gvisor", "docker", "podman", "host"];
  return Object.fromEntries(all.map((e) => [e, async (): Promise<Probe> => {
    calls.push(e);
    return { engine: e, available: !!ok[e], reason: ok[e] ? undefined : `${e} not here` };
  }])) as Record<Engine, () => Promise<Probe>>;
}

test("the order per platform; Intel Macs aren't supported", () => {
  expect(ladder("darwin", "arm64")).toEqual(["smolvm", "docker", "podman", "host"]);
  expect(ladder("darwin", "x64")).toEqual([]);
  expect(ladder("linux", "x64")).toEqual(["smolvm", "gvisor", "docker", "podman", "host"]);
  expect(ladder("win32", "x64")).toEqual(["wsl", "docker", "podman", "host"]);
});

test("picks the first rung that works and remembers it", async () => {
  const h = home();
  const calls: Engine[] = [];
  const c = await chooseLocal(h, { platform: "linux", arch: "x64", probes: fake({ gvisor: true, docker: true }, calls) });
  expect(c.engine).toBe("gvisor");
  expect(calls).toEqual(["smolvm", "gvisor"]); // stops at the first that works: Docker is never needed
  expect((await loadSaved(h)).engine).toBe("gvisor");
});

test("Windows: WSL first, then Docker when WSL is off", async () => {
  expect((await chooseLocal(home(), { platform: "win32", arch: "x64", probes: fake({ wsl: true, docker: true }) })).engine).toBe("wsl");
  expect((await chooseLocal(home(), { platform: "win32", arch: "x64", probes: fake({ docker: true }) })).engine).toBe("docker");
  expect((await chooseLocal(home(), { platform: "win32", arch: "x64", probes: fake({ podman: true }) })).engine).toBe("podman");
});

test("the remembered engine is checked first and kept while it works", async () => {
  const h = home();
  await saveLocal(h, { engine: "docker" });
  const calls: Engine[] = [];
  const c = await chooseLocal(h, { platform: "linux", arch: "x64", probes: fake({ gvisor: true, docker: true }, calls) });
  expect(c.engine).toBe("docker");
  expect(calls).toEqual(["docker"]);
});

test("a remembered engine that stopped working falls back down the ladder", async () => {
  const h = home();
  await saveLocal(h, { engine: "docker" });
  const c = await chooseLocal(h, { platform: "linux", arch: "x64", probes: fake({ gvisor: true }) });
  expect(c.engine).toBe("gvisor");
  expect(c.probes.find((p) => p.engine === "docker")?.available).toBe(false);
  expect((await loadSaved(h)).engine).toBe("gvisor");
});

test("nothing works: no engine, every reason listed, and no sandbox is never picked unasked", async () => {
  const h = home();
  const calls: Engine[] = [];
  const c = await chooseLocal(h, { platform: "linux", arch: "x64", probes: fake({ host: true }, calls) });
  expect(c.engine).toBeNull();
  expect(calls).not.toContain("host");
  expect(c.probes.map((p) => p.engine)).toEqual(["smolvm", "gvisor", "docker", "podman", "host"]);
  expect(c.probes.find((p) => p.engine === "host")?.reason).toContain("Not chosen");
  expect(c.hostAllowed).toBe(false);
});

test("once allowed, no sandbox is the last rung; taking it back forgets it", async () => {
  const h = home();
  await saveLocal(h, { hostAllowed: true });
  const c = await chooseLocal(h, { platform: "win32", arch: "x64", probes: fake({ host: true }) });
  expect(c.engine).toBe("host");
  expect(c.hostAllowed).toBe(true);
  // A sandbox appears later (Docker installed): it wins again.
  expect((await chooseLocal(h, { platform: "win32", arch: "x64", probes: fake({ host: true, docker: true }) })).engine).toBe("host"); // remembered and still works
  await saveLocal(h, { hostAllowed: false, engine: undefined });
  const s = await loadSaved(h);
  expect(s.engine).toBeUndefined();
  expect((await chooseLocal(h, { platform: "win32", arch: "x64", probes: fake({ host: true, docker: true }) })).engine).toBe("docker");
});

test("Intel Mac: unsupported, said plainly", async () => {
  const c = await chooseLocal(home(), { platform: "darwin", arch: "x64", probes: fake({ docker: true, host: true }) });
  expect(c.engine).toBeNull();
  expect(c.unsupported).toContain("Apple Silicon");
});

test("SCUT_LOCAL_DRIVER forces an engine", async () => {
  process.env.SCUT_LOCAL_DRIVER = "podman";
  try {
    expect((await chooseLocal(home(), { platform: "linux", arch: "x64", probes: fake({}) })).engine).toBe("podman");
  } finally {
    delete process.env.SCUT_LOCAL_DRIVER;
  }
});

test("service definitions keep a no-sandbox agent running, per OS", () => {
  const sd = serviceFiles("systemd", "scut-atlas-1", "/h/hosts/scut-atlas-1/run.sh", "/home/me");
  expect(sd.path).toBe("/home/me/.config/systemd/user/beamhop-scut-atlas-1.service");
  expect(sd.body).toContain("ExecStart=/bin/sh /h/hosts/scut-atlas-1/run.sh");
  expect(sd.body).toContain("Restart=on-failure");
  expect(sd.body).toContain("WantedBy=default.target");
  expect(sd.install.at(-1)).toEqual(["systemctl", "--user", "enable", "--now", "beamhop-scut-atlas-1.service"]);
  expect(sd.uninstall[0]).toEqual(["systemctl", "--user", "disable", "--now", "beamhop-scut-atlas-1.service"]);

  const ld = serviceFiles("launchd", "scut-atlas-1", "/Users/me/.scut/hosts/a&b/run.sh", "/Users/me");
  expect(ld.path).toBe("/Users/me/Library/LaunchAgents/com.beamhop.scut-atlas-1.plist");
  expect(ld.body).toContain("<string>/Users/me/.scut/hosts/a&amp;b/run.sh</string>");
  expect(ld.body).toContain("<key>RunAtLoad</key><true/>");
  expect(ld.install[0].slice(0, 2)).toEqual(["launchctl", "bootstrap"]);
  expect(ld.uninstall[0][1]).toBe("bootout");

  const st = serviceFiles("schtasks", "scut-atlas-1", "C:\\Users\\me\\.scut\\hosts\\scut-atlas-1\\run.cmd", "C:\\Users\\me");
  expect(st.install[0]).toContain("ONLOGON");
  expect(st.install[0]).toContain("Beamhop\\scut-atlas-1");
  expect(st.install[0].at(-1)).toBe('cmd.exe /d /c "C:\\Users\\me\\.scut\\hosts\\scut-atlas-1\\run.cmd"');
  expect(st.uninstall.at(-1)).toEqual(["schtasks", "/Delete", "/F", "/TN", "Beamhop\\scut-atlas-1"]);
});

test("saved choices live in engine.json", async () => {
  const h = home();
  await saveLocal(h, { engine: "gvisor", hostAllowed: true });
  const j = JSON.parse(readFileSync(`${h}/engine.json`, "utf8"));
  expect(j.engine).toBe("gvisor");
  expect(j.hostAllowed).toBe(true);
  expect(typeof j.at).toBe("number");
});
