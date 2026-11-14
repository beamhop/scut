// gVisor host (Linux without KVM): downloads runsc, pulls the agent image without Docker, boots it rootless-capable,
// survives a "restart" (revive), upgrades with rollback, and cleans up. Needs Linux; the image comes from
// SCUT_GVISOR_IMAGE (CI/dev: a local registry with the dev image, e.g. localhost:5000/scut-agent:dev).
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { GvisorDriver, waitHealthy, parseRef } from "@scut/drivers";
import { whiteouts } from "../packages/drivers/src/oci.ts";

const IMAGE = process.env.SCUT_GVISOR_IMAGE ?? "localhost:5000/scut-agent:dev";
const HOME = process.env.SCUT_GVISOR_HOME ?? "/tmp/scut-gv-home";
const linux = process.platform === "linux";

test("image references parse like Docker's", () => {
  expect(parseRef("ghcr.io/beamhop/scut-agent:latest")).toEqual({ registry: "ghcr.io", repo: "beamhop/scut-agent", reference: "latest", insecure: false });
  expect(parseRef("alpine")).toEqual({ registry: "registry-1.docker.io", repo: "library/alpine", reference: "latest", insecure: false });
  expect(parseRef("localhost:5000/scut-agent:dev")).toEqual({ registry: "localhost:5000", repo: "scut-agent", reference: "dev", insecure: true });
  expect(parseRef("ghcr.io/a/b@sha256:abc").reference).toBe("sha256:abc");
});

test("OCI whiteouts: deleted files and opaque directories", () => {
  expect(whiteouts(["etc/", "etc/.wh.old.conf", "./var/cache/.wh..wh..opq", "usr/bin/x", ".wh.top"])).toEqual({
    remove: ["etc/old.conf", "top"],
    opaque: ["var/cache"],
    markers: ["etc/.wh.old.conf", "var/cache/.wh..wh..opq", ".wh.top"],
  });
});

test.skipIf(!linux)("layers apply in order with whiteouts", async () => {
  const { extractRootfs } = await import("../packages/drivers/src/oci.ts");
  const dir = (await import("node:fs")).mkdtempSync("/tmp/scut-layers-");
  const sh = (c: string) => expect(Bun.spawnSync(["sh", "-c", c], { cwd: dir }).exitCode).toBe(0);
  sh("mkdir -p l1/etc l1/cache && echo a > l1/etc/keep && echo b > l1/etc/gone && echo c > l1/cache/x && tar -czf l1.tgz -C l1 .");
  sh("mkdir -p l2/etc l2/cache && touch l2/etc/.wh.gone l2/cache/.wh..wh..opq && echo d > l2/cache/y && echo e > l2/etc/new && tar -czf l2.tgz -C l2 .");
  const gz = "application/vnd.oci.image.layer.v1.tar+gzip";
  await extractRootfs([{ digest: "1", mediaType: gz, size: 0, path: `${dir}/l1.tgz` }, { digest: "2", mediaType: gz, size: 0, path: `${dir}/l2.tgz` }], `${dir}/root`);
  expect(readFileSync(`${dir}/root/etc/keep`, "utf8")).toBe("a\n");
  expect(readFileSync(`${dir}/root/etc/new`, "utf8")).toBe("e\n");
  expect(existsSync(`${dir}/root/etc/gone`)).toBe(false);
  expect(existsSync(`${dir}/root/cache/x`)).toBe(false);
  expect(readFileSync(`${dir}/root/cache/y`, "utf8")).toBe("d\n");
  expect(existsSync(`${dir}/root/etc/.wh.gone`)).toBe(false);
});

const reachable = linux && (await fetch(`http://${parseRef(IMAGE).registry}/v2/`, { signal: AbortSignal.timeout(2000) }).then(() => true, () => IMAGE.startsWith("ghcr.io")));

test.skipIf(!linux)("downloads the pinned runsc and passes its self-test", async () => {
  const a = await GvisorDriver.availability(HOME, { download: true });
  console.log("gvisor availability:", JSON.stringify(a));
  expect(a.available).toBe(true);
}, 300_000);

test.skipIf(!reachable)("boots the agent image without Docker, revives it, and removes it", async () => {
  const d = new GvisorDriver({ home: HOME });
  const seen: { done: number; total: number }[] = [];
  await d.prepare(IMAGE, (p) => seen.push(p));
  expect(seen.at(-1)!.done).toBe(seen.at(-1)!.total);
  const inst = await d.create({ name: `gv${Date.now().toString(36)}`, image: IMAGE, env: {} });
  try {
    expect(inst.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const h = await waitHealthy(inst.endpoint, 120_000);
    expect(h.state).toBe("awaiting");
    // A file the agent writes to /data lives in the host folder.
    expect(existsSync(`${HOME}/hosts/${inst.meta!.name}/data/.host/key`)).toBe(true);
    const key = readFileSync(`${HOME}/hosts/${inst.meta!.name}/data/.host/key`, "utf8");
    // "Restart": the sandbox is gone, the folder is not. revive brings it back with the same host key.
    Bun.spawnSync([`${HOME}/engines/gvisor-20261109.0/runsc`, `--root=${HOME}/hosts/${inst.meta!.name}/state`, ...(process.getuid?.() === 0 ? [] : ["--rootless"]), "--network=host", "--ignore-cgroups", "kill", inst.meta!.name, "KILL"]);
    await Bun.sleep(1000);
    const back = await d.revive(inst);
    const h2 = await waitHealthy(back.endpoint, 120_000);
    expect(h2.hostPubkey).toBe(h.hostPubkey);
    expect(readFileSync(`${HOME}/hosts/${inst.meta!.name}/data/.host/key`, "utf8")).toBe(key);
    expect(d.boundHosts()).toEqual(["127.0.0.1"]);
    // A failed upgrade check rolls back to the same running agent.
    (d as any).prepared.set(IMAGE, { ...(d as any).prepared.get(IMAGE), digest: "sha256:pretend-newer" });
    expect(d.outdated(back, IMAGE)).toBe(true);
    await expect(d.upgrade(back, IMAGE, async () => { throw new Error("check failed"); })).rejects.toThrow("check failed");
    const h3 = await waitHealthy(back.endpoint, 120_000);
    expect(h3.hostPubkey).toBe(h.hostPubkey);
  } finally {
    await d.destroy(inst);
  }
  expect(existsSync(`${HOME}/hosts/${inst.meta!.name}`)).toBe(false);
}, 600_000);
