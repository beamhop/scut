// When an engine passes the quick check but fails for real during setup (gVisor where AppArmor blocks it), the app
// remembers that and moves down the ladder by itself, and creating an agent uses the next engine.
// Linux; needs Docker as the next rung and the dev image (SCUT_IMAGE).
import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const fake = `${mkdtempSync(`${tmpdir()}/fake-runsc-`)}/runsc`;
// Not there yet when the app starts (so only the quick check runs); "downloaded" right after.
const putFake = () => { writeFileSync(fake, "#!/bin/sh\necho 'creating user namespace: operation not permitted' >&2\nexit 1\n"); chmodSync(fake, 0o755); };
process.env.SCUT_RUNSC = fake;
process.env.SCUT_HOME = mkdtempSync(`${tmpdir()}/scut-fallback-`);
delete process.env.SCUT_LOCAL_DRIVER;
process.env.SCUT_NO_AUTO_UPDATE = "1";
process.env.SCUT_IMAGE ??= "ghcr.io/beamhop/scut-agent:dev";
const { Scut } = await import("../apps/app/src/core.ts");
const linux = process.platform === "linux";
const docker = Bun.spawnSync(["docker", "image", "inspect", process.env.SCUT_IMAGE!], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
let scut: InstanceType<typeof Scut> | undefined;
afterAll(async () => {
  for (const a of [...(scut?.agents ?? [])]) await scut!.remove(a.id).catch(() => {});
});

test.skipIf(!linux || !docker || !!(await (await import("@scut/drivers")).SmolvmDriver.availability()).available)("gVisor fails its real test: the app moves to Docker and creates there", async () => {
  scut = await Scut.open();
  expect(scut.local.engine).toBe("gvisor"); // the quick check passed
  putFake();
  scut.startPrefetch();
  const rec = await scut.create({ name: "Falls", harness: "mock" });
  expect(scut.local.engine).toBe("docker");
  expect(rec.current.meta?.engine).toBe("docker");
  const saved = JSON.parse(readFileSync(`${process.env.SCUT_HOME}/engine.json`, "utf8"));
  expect(saved.engine).toBe("docker");
  expect(saved.broken.gvisor.reason).toContain("user namespaces");
  // Next start: gVisor isn't tried again (for a week), Docker is kept.
  const again = await Scut.open();
  expect(again.local.engine).toBe("docker");
  expect(again.local.probes.find((p) => p.engine === "gvisor")).toBeUndefined();
}, 300_000);
