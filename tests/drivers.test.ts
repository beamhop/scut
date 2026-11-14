// Driver checks that run anywhere. Booting a microVM needs KVM / Apple Silicon and is skipped otherwise.
import { expect, test } from "bun:test";
import { SmolvmDriver } from "@scut/drivers";

test("smolvm engine loads and reports availability", async () => {
  const a = await SmolvmDriver.availability();
  console.log("smolvm availability:", JSON.stringify(a));
  expect(typeof a.available).toBe("boolean");
  if (!a.available) expect(a.reason).toBeTruthy();
});

const avail = await SmolvmDriver.availability();
test.skipIf(!avail.available)("smolvm boots the agent image and serves /health", async () => {
  const d = new SmolvmDriver();
  const inst = await d.create({ name: `t${Date.now()}`, image: process.env.SCUT_IMAGE ?? "ghcr.io/beamhop/scut-agent:latest", env: {} });
  try {
    const { waitHealthy } = await import("@scut/drivers");
    const h = await waitHealthy(inst.endpoint, 300_000);
    expect(h.state).toBe("awaiting");
  } finally {
    await d.destroy(inst);
  }
});

test("docker pull reports layer progress (used for the first-run download)", async () => {
  const { DockerDriver } = await import("../packages/drivers/src/docker.ts");
  const img = "mirror.gcr.io/library/alpine:3.20";
  Bun.spawnSync(["docker", "rmi", "-f", img], { stdout: "ignore", stderr: "ignore" });
  expect(DockerDriver.imagePresent(img)).toBe(false);
  const seen: { done: number; total: number }[] = [];
  await DockerDriver.pull(img, (p) => seen.push(p));
  expect(DockerDriver.imagePresent(img)).toBe(true);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.at(-1)!.done).toBe(seen.at(-1)!.total);
  await expect(DockerDriver.pull("mirror.gcr.io/library/does-not-exist-beamhop:0")).rejects.toThrow("Couldn't download");
}, 120_000);

test("open at login writes one per-user login item and removes it again", async () => {
  const { setAutostart, autostartEnabled } = await import("../apps/app/src/autostart.ts");
  const home = (await import("node:fs")).mkdtempSync(`${(await import("node:os")).tmpdir()}/scut-auto-`);
  process.env.XDG_CONFIG_HOME = `${home}/.config`;
  expect(await autostartEnabled(home)).toBe(false);
  await setAutostart(true, home);
  expect(await autostartEnabled(home)).toBe(true);
  const text = await Bun.file(`${home}/.config/autostart/beamhop.desktop`).text();
  expect(text).toContain("Exec=");
  expect(text).toContain("Name=Beamhop");
  await setAutostart(false, home);
  expect(await autostartEnabled(home)).toBe(false);
  delete process.env.XDG_CONFIG_HOME;
});
