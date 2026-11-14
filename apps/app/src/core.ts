// The app's core: owner identity, agent registry, host drivers, create + beam orchestration.
import {
  type AgentSpec, type BeamTicket, type Handoff, type HarnessKind, type ModelConfig, type Autonomy,
  bytesToHex, encodeTicket, generateSecretKey, getPublicKey, hexToBytes, readLease, seal, signAuth, signLease, unseal,
} from "@scut/protocol";
import { DockerDriver, FlyDriver, RailwayDriver, RenderDriver, SmolvmDriver, waitHealthy, type HostDriver, type Instance } from "@scut/drivers";
import type { Event } from "nostr-tools";
import { mkdir } from "node:fs/promises";

export const HOME = process.env.SCUT_HOME ?? `${process.env.HOME}/.scut`;
export const IMAGE = process.env.SCUT_IMAGE ?? "ghcr.io/beamhop/scut-agent:latest";
/** Dev/test only: extra env for agent instances, e.g. SCUT_AGENT_ENV="SCUT_TELEGRAM_API=http://host.docker.internal:9999". */
const EXTRA_ENV: Record<string, string> = Object.fromEntries(
  (process.env.SCUT_AGENT_ENV ?? "").split(",").filter(Boolean).map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]),
);

export interface AgentRecord {
  id: string;
  name: string;
  mascot: string;
  harness: HarnessKind;
  agentPubkey: string;
  current: Instance;
  history: Instance[];
  beam?: { to: string; stage: BeamStage; error?: string; startedAt: number };
}
export type BeamStage = "packing" | "provisioning" | "transferring" | "restoring" | "online" | "failed";

async function loadJson<T>(f: string, fallback: T): Promise<T> {
  const file = Bun.file(`${HOME}/${f}`);
  return (await file.exists()) ? ((await file.json()) as T) : fallback;
}
async function saveJson(f: string, v: unknown) {
  await mkdir(HOME, { recursive: true });
  await Bun.write(`${HOME}/${f}`, JSON.stringify(v, null, 2));
}

export class Scut {
  ownerSk!: Uint8Array;
  ownerPubkey!: string;
  agents: AgentRecord[] = [];
  drivers = new Map<string, HostDriver>();

  static async open() {
    const s = new Scut();
    await mkdir(HOME, { recursive: true });
    const kf = Bun.file(`${HOME}/owner.key`);
    if (await kf.exists()) s.ownerSk = hexToBytes((await kf.text()).trim());
    else {
      s.ownerSk = generateSecretKey();
      await Bun.write(kf, bytesToHex(s.ownerSk));
    }
    s.ownerPubkey = getPublicKey(s.ownerSk);
    s.agents = await loadJson<AgentRecord[]>("agents.json", []);
    await s.loadDrivers();
    return s;
  }

  async loadDrivers() {
    const p = await loadJson<any>("providers.json", {});
    const local = (process.env.SCUT_LOCAL_DRIVER ?? (await hasKvmOrHvf() ? "smolvm" : "docker")) as string;
    this.drivers.set("local", local === "smolvm" ? Object.assign(new SmolvmDriver(), { id: "local" }) : new DockerDriver({ id: "local", label: "This computer" }));
    // A second local container host labelled as cloud, for demos and tests without provider accounts.
    if (process.env.SCUT_SIM_CLOUD) this.drivers.set("sim-cloud", new DockerDriver({ id: "sim-cloud", label: "Cloud (simulated)" }));
    if (p.fly?.token) this.drivers.set("fly", new FlyDriver(p.fly.token, p.fly.org, p.fly.region));
    if (p.render?.token) this.drivers.set("render", new RenderDriver(p.render.token, p.render.ownerId));
    if (p.railway?.token) this.drivers.set("railway", new RailwayDriver(p.railway.token, p.railway.projectId, p.railway.environmentId));
  }

  async saveProvider(id: string, cfg: Record<string, string>) {
    const p = await loadJson<any>("providers.json", {});
    p[id] = cfg;
    await saveJson("providers.json", p);
    await this.loadDrivers();
  }

  save() {
    return saveJson("agents.json", this.agents);
  }

  get(id: string) {
    const a = this.agents.find((x) => x.id === id || x.name.toLowerCase() === id.toLowerCase());
    if (!a) throw new Error(`no agent ${id}`);
    return a;
  }

  auth(endpoint: string) {
    return signAuth(this.ownerSk, new URL(endpoint).host);
  }

  private async req(endpoint: string, path: string, init: RequestInit = {}) {
    const r = await fetch(`${endpoint}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Scut ${this.auth(endpoint)}` },
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
    return r;
  }

  private async waitState(endpoint: string, want: string[], timeoutMs = 120_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const h = await waitHealthy(endpoint, 30_000);
      if (want.includes(h.state)) return h;
      await Bun.sleep(500);
    }
    throw new Error(`timeout waiting for ${want.join("/")} at ${endpoint}`);
  }

  async create(o: {
    name: string;
    harness?: HarnessKind;
    template?: AgentSpec["template"];
    persona?: string;
    model?: ModelConfig;
    autonomy?: Autonomy;
    telegramToken?: string;
    driver?: string;
    dailyTokenBudget?: number;
  }): Promise<AgentRecord> {
    const driver = this.drivers.get(o.driver ?? "local");
    if (!driver) throw new Error(`unknown destination ${o.driver}`);
    const agentSk = generateSecretKey();
    const id = `${o.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${bytesToHex(crypto.getRandomValues(new Uint8Array(3)))}`;
    const spec: AgentSpec = {
      id,
      name: o.name,
      harness: o.harness ?? "pi",
      model: o.model,
      template: o.template ?? "assistant",
      persona: o.persona,
      mascot: MASCOTS[this.agents.length % MASCOTS.length],
      autonomy: o.autonomy ?? "risky",
      ownerPubkey: this.ownerPubkey,
      agentPubkey: getPublicKey(agentSk),
      channels: o.telegramToken ? { telegram: { token: o.telegramToken } } : {},
      createdAt: Date.now(),
      dailyTokenBudget: o.dailyTokenBudget,
    };
    const ticket: BeamTicket = { beamId: `create-${id}`, mode: "create", ownerPubkey: this.ownerPubkey, agentPubkey: spec.agentPubkey, issuedAt: Date.now() };
    const inst = await driver.create({ name: id, image: IMAGE, env: { ...EXTRA_ENV, BEAM_TICKET: encodeTicket(ticket) } });
    try {
      const hello = await (async () => {
        await waitHealthy(inst.endpoint);
        return (await (await fetch(`${inst.endpoint}/beam/hello`)).json()) as { hostPubkey: string };
      })();
      const lease = signLease(agentSk, id, { holder: hello.hostPubkey, seq: 1 });
      const handoff: Handoff = { beamId: ticket.beamId, agentSk: bytesToHex(agentSk), spec, lease };
      await this.req(inst.endpoint, "/beam/handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sealed: seal(this.ownerSk, hello.hostPubkey, handoff) }),
      });
      await this.waitState(inst.endpoint, ["running"]);
    } catch (e) {
      await driver.destroy(inst).catch(() => {});
      throw e;
    }
    const rec: AgentRecord = { id, name: o.name, mascot: spec.mascot!, harness: spec.harness, agentPubkey: spec.agentPubkey, current: inst, history: [] };
    this.agents.push(rec);
    await this.save();
    return rec;
  }

  /** Beam an agent to another host. The source keeps a cold copy until destroyed. */
  async beam(agentId: string, to: string, opts: { destroySource?: boolean; onStage?: (s: BeamStage) => void } = {}) {
    const rec = this.get(agentId);
    const driver = this.drivers.get(to);
    if (!driver) throw new Error(`unknown destination ${to}`);
    const src = rec.current;
    const stage = async (s: BeamStage, error?: string) => {
      rec.beam = { to, stage: s, error, startedAt: rec.beam?.startedAt ?? Date.now() };
      opts.onStage?.(s);
      await this.save();
    };
    let target: Instance | null = null;
    try {
      await stage("packing");
      const prep = (await (await this.req(src.endpoint, "/beam/prepare", { method: "POST" })).json()) as {
        bundleId: string; hash: string; size: number; sealed: string; hostPubkey: string; lease: Event;
      };
      const secrets = unseal<{ bundleKey: string; agentSk: string }>(this.ownerSk, prep.hostPubkey, prep.sealed);
      const cipher = new Uint8Array(await (await this.req(src.endpoint, `/beam/bundle/${prep.bundleId}`)).arrayBuffer());

      await stage("provisioning");
      const beamId = `beam-${bytesToHex(crypto.getRandomValues(new Uint8Array(6)))}`;
      const ticket: BeamTicket = { beamId, mode: "beam", ownerPubkey: this.ownerPubkey, agentPubkey: rec.agentPubkey, bundleHash: prep.hash, issuedAt: Date.now() };
      const suffix = bytesToHex(crypto.getRandomValues(new Uint8Array(2)));
      target = await driver.create({ name: `${rec.id}-${suffix}`, image: IMAGE, env: { ...EXTRA_ENV, BEAM_TICKET: encodeTicket(ticket) } });
      await waitHealthy(target.endpoint);
      const hello = (await (await fetch(`${target.endpoint}/beam/hello`)).json()) as { hostPubkey: string };

      await stage("transferring");
      const cur = readLease(prep.lease, rec.agentPubkey);
      const lease = signLease(hexToBytes(secrets.agentSk), rec.id, { holder: hello.hostPubkey, seq: (cur?.seq ?? 0) + 1 });
      await this.req(target.endpoint, "/beam/bundle", { method: "PUT", body: cipher });
      const handoff: Handoff = { beamId, agentSk: secrets.agentSk, bundleKey: secrets.bundleKey, lease };

      await stage("restoring");
      await this.req(target.endpoint, "/beam/handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sealed: seal(this.ownerSk, hello.hostPubkey, handoff) }),
      });
      await this.waitState(target.endpoint, ["running"]);
      await this.req(src.endpoint, "/beam/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lease }) });

      rec.history.push(src);
      rec.current = target;
      await stage("online");
      if (opts.destroySource) await this.drivers.get(src.driver)?.destroy(src).catch(() => {});
      return rec;
    } catch (e: any) {
      await this.req(src.endpoint, "/beam/abort", { method: "POST" }).catch(() => {});
      if (target) await driver.destroy(target).catch(() => {});
      await stage("failed", String(e?.message ?? e));
      throw e;
    }
  }

  async remove(agentId: string) {
    const rec = this.get(agentId);
    for (const inst of [rec.current, ...rec.history]) await this.drivers.get(inst.driver)?.destroy(inst).catch(() => {});
    this.agents = this.agents.filter((a) => a !== rec);
    await this.save();
  }
}

export const MASCOTS = ["cyan", "magenta", "lime", "amber", "violet", "coral"];

async function hasKvmOrHvf() {
  if (process.platform === "darwin") return true;
  if (process.platform === "win32") return true;
  return Bun.file("/dev/kvm").exists();
}
