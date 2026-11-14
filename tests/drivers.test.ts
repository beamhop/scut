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
