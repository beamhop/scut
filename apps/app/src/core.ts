// The app's core: owner identity, agent registry, host drivers, create + beam orchestration.
import {
  type AgentSpec, type BeamTicket, type Handoff, type HarnessKind, type ModelConfig, type Autonomy,
  bytesToHex, encodeTicket, generateSecretKey, getPublicKey, hexToBytes, readLease, seal, signAuth, signLease, unseal,
} from "@scut/protocol";
import { DockerDriver, FlyDriver, RailwayDriver, RenderDriver, SmolvmDriver, waitHealthy, type HostDriver, type Instance } from "@scut/drivers";
import type { Event } from "nostr-tools";
import { chmod, mkdir } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { openAgentFile, writeAgentFile } from "./agentfile.ts";

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
  model?: { baseUrl?: string; model: string };
  nostr?: boolean;
  current: Instance;
  history: Instance[];
  beam?: { to: string; from?: string; stage: BeamStage; error?: string; startedAt: number; doneAt?: number; summary?: BeamSummary; target?: Instance };
}
export type BeamSummary = { bytes: number; carried: { chat?: number; memory?: number; schedules?: number; skills?: number; channels?: number } };
export type BeamStage = "packing" | "provisioning" | "transferring" | "restoring" | "online" | "failed";

async function loadJson<T>(home: string, f: string, fallback: T): Promise<T> {
  const file = Bun.file(`${home}/${f}`);
  return (await file.exists()) ? ((await file.json()) as T) : fallback;
}
async function saveJson(home: string, f: string, v: unknown) {
  await mkdir(home, { recursive: true });
  await Bun.write(`${home}/${f}`, JSON.stringify(v, null, 2));
}

export class Scut {
  home = HOME;
  ownerSk!: Uint8Array;
  ownerPubkey!: string;
  agents: AgentRecord[] = [];
  drivers = new Map<string, HostDriver>();

  static async open(home = HOME) {
    const s = new Scut();
    s.home = home;
    await mkdir(home, { recursive: true });
    const kf = Bun.file(`${home}/owner.key`);
    if (await kf.exists()) s.ownerSk = hexToBytes((await kf.text()).trim());
    else {
      s.ownerSk = generateSecretKey();
      await Bun.write(kf, bytesToHex(s.ownerSk));
    }
    s.ownerPubkey = getPublicKey(s.ownerSk);
    s.agents = await loadJson<AgentRecord[]>(home, "agents.json", []);
    await s.loadDrivers();
    await s.recoverInterruptedBeams();
    await s.reviveLocalHosts();
    void s.cleanupRetiredHosts();
    if (process.env.SCUT_NO_AUTO_UPDATE !== "1") void s.updateOutdatedHosts();
    return s;
  }

  /** Agents whose computer is being rebuilt from a newer image right now (shown as "updating"). */
  updating = new Map<string, Promise<void>>();
  private updateRetry?: ReturnType<typeof setTimeout>;

  /**
   * Agents created on an older image keep it until their container is recreated. Recreate every local agent whose
   * image differs from the current one, keeping its disk. Only while it is idle and not beaming; busy ones are tried
   * again a minute later. A failed update puts the old computer back as it was.
   */
  async updateOutdatedHosts(image = IMAGE): Promise<{ updated: string[]; waiting: string[]; failed: string[] }> {
    const out = { updated: [] as string[], waiting: [] as string[], failed: [] as string[] };
    for (const a of this.agents) {
      const d = this.drivers.get(a.current.driver);
      if (!d?.upgrade || !d.outdated?.(a.current, image)) continue;
      if (this.updating.has(a.id)) continue;
      if (a.beam && !["online", "failed"].includes(a.beam.stage)) { out.waiting.push(a.name); continue; }
      const h = (await fetch(`${a.current.endpoint}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json()).catch(() => null)) as { state?: string } | null;
      // Running a task, asking for approval, or mid-beam: don't pull the computer from under it. Unreachable = not working.
      if (h && h.state !== "running") { out.waiting.push(a.name); continue; }
      const job = (async () => {
        const next = await d.upgrade!(a.current, image, async (n) => { await this.waitState(n.endpoint, ["running"], 180_000); });
        a.current = next;
        this.tokenCache.clear();
        await this.save();
      })();
      this.updating.set(a.id, job.catch(() => {}));
      try {
        await job;
        out.updated.push(a.name);
      } catch (e: any) {
        console.error(`update of ${a.name} failed; kept the old computer:`, e?.message ?? e);
        out.failed.push(a.name);
      } finally {
        this.updating.delete(a.id);
      }
    }
    if (out.updated.length) await this.syncCrew();
    clearTimeout(this.updateRetry);
    if (out.waiting.length) this.updateRetry = setTimeout(() => void this.updateOutdatedHosts(image), 60_000);
    return out;
  }

  /**
   * A link that opens this agent on a phone. Cloud agents: always. Agents on this computer: only if their port listens on
   * the network (never changed silently here), using this computer's LAN address; otherwise reachable:false and why.
   */
  phoneLink(rec: AgentRecord, lan = lanIPv4()): { url: string; reachable: boolean; why?: string; local: boolean; expiresInMin: number } {
    const ep = rec.current.endpoint;
    const u = new URL(ep);
    const loopback = /^(127\.|localhost$|\[::1\]$|::1$)/.test(u.hostname);
    const link = (base: string) => `${base}/?auth=${this.freshAuth(base)}`;
    if (!loopback) return { url: link(ep), reachable: true, local: false, expiresInMin: 15 };
    const hosts = this.drivers.get(rec.current.driver)?.boundHosts?.(rec.current) ?? [];
    if (lan && hosts.some((h) => h === "0.0.0.0" || h === "::" || h === lan)) {
      return { url: link(`${u.protocol}//${lan}:${u.port}`), reachable: true, local: true, expiresInMin: 15 };
    }
    return { url: link(ep), reachable: false, why: `Your phone can't reach this computer. Beam ${rec.name} to a cloud to use it on your phone.`, local: true, expiresInMin: 15 };
  }

  /** Send one socket message to an agent (owner-signed). Resolves true once it was sent. */
  sendTo(a: AgentRecord, msg: unknown): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      try {
        const ws = new WebSocket(`${a.current.endpoint.replace(/^http/, "ws")}/ws?auth=${this.auth(a.current.endpoint)}`);
        const t = setTimeout(() => { ws.close(); resolve(false); }, 5000);
        ws.onopen = () => { ws.send(JSON.stringify(msg)); setTimeout(() => { clearTimeout(t); ws.close(); resolve(true); }, 300); };
        ws.onerror = () => { clearTimeout(t); resolve(false); };
      } catch { resolve(false); }
    });
  }

  /** Send a message to every agent that isn't mid-beam (pause all, resume all, stop all). */
  async sendAll(msg: unknown): Promise<{ sent: string[]; failed: string[] }> {
    const live = this.agents.filter((a) => !a.beam?.stage?.match(/packing|provisioning|transferring|restoring/));
    const res = await Promise.all(live.map(async (a) => [a.name, await this.sendTo(a, msg)] as const));
    return { sent: res.filter(([, ok]) => ok).map(([n]) => n), failed: res.filter(([, ok]) => !ok).map(([n]) => n) };
  }

  /**
   * If the app was closed or crashed mid-beam, the source is still holding the agent (paused, with its lease).
   * Tell it to carry on and record the beam as failed; a half-made target, if any, never got the handoff and stays inert.
   */
  async recoverInterruptedBeams() {
    const stuck = this.agents.filter((a) => a.beam && !["online", "failed"].includes(a.beam.stage));
    for (const a of stuck) {
      const t = a.beam!.target;
      // If the new host already took over (it holds the lease and runs), finish the move instead of rolling back:
      // resuming the old copy then would mean two copies of one agent.
      const arrived = t && (await fetch(`${t.endpoint}/health`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null)) as { state?: string } | null;
      if (t && arrived?.state === "running") {
        const st = (await this.req(t.endpoint, "/status").then((r) => r.json()).catch(() => null)) as { holdsLease?: boolean; lease?: Event } | null;
        if (st?.holdsLease && st.lease) {
          await this.req(a.current.endpoint, "/beam/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lease: st.lease }) }).catch(() => {});
          a.history.push(a.current);
          a.current = t;
          a.beam = { ...a.beam!, stage: "online", target: undefined, doneAt: Date.now() };
          continue;
        }
      }
      await this.req(a.current.endpoint, "/beam/abort", { method: "POST" }).catch(() => {});
      if (t) await this.drivers.get(t.driver)?.destroy(t).catch(() => {});
      a.beam = { ...a.beam!, stage: "failed", target: undefined, error: `The app closed during the move. ${a.name} stayed where it was.`, doneAt: Date.now() };
    }
    if (stuck.length) await this.save();
  }

  /** After a restart of the computer (or Docker), start local agents again and pick up their new addresses. */
  async reviveLocalHosts() {
    let changed = false;
    for (const a of this.agents) {
      const d = this.drivers.get(a.current.driver);
      if (!d?.revive || d.monthlyUsd > 0) continue; // only local hosts; clouds keep running on their own
      const ok = await fetch(`${a.current.endpoint}/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
      if (ok) continue;
      const next = await d.revive(a.current).catch(() => a.current);
      if (next.endpoint !== a.current.endpoint) { a.current = next; changed = true; }
    }
    if (changed) await this.save();
  }

  /** Remove old hosts that earlier versions left behind after beams (retired, but still a container or a billed machine). */
  async cleanupRetiredHosts() {
    let changed = false;
    for (const a of this.agents) {
      for (const h of a.history) {
        if (h.meta?.removed) continue;
        const st = (await fetch(`${h.endpoint}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json()).catch(() => null)) as { state?: string; agent?: string } | null;
        if (!st || st.state !== "retired" || st.agent !== a.id) continue; // unreachable for now, still in use, or not ours
        await this.drivers.get(h.driver)?.destroy(h).catch(() => {});
        h.meta = { ...h.meta, removed: "1" };
        changed = true;
      }
    }
    if (changed) await this.save();
  }

  /** First run: the agent computer image (~1.5 GB) downloads in the background while you pick a brain. */
  prefetch: { state: "idle" | "pulling" | "ready" | "error"; done: number; total: number; error?: string } = { state: "idle", done: 0, total: 0 };
  private prefetching?: Promise<void>;
  startPrefetch() {
    const local = this.drivers.get("local");
    if (!(local instanceof DockerDriver) || this.prefetching) return;
    const engine = DockerDriver.available();
    if (!engine.ok) { this.prefetch = { state: "error", done: 0, total: 0, error: engine.reason }; return; }
    if (DockerDriver.imagePresent(IMAGE)) { this.prefetch = { state: "ready", done: 0, total: 0 }; return; }
    this.prefetch = { state: "pulling", done: 0, total: 0 };
    this.prefetching = DockerDriver.pull(IMAGE, (p) => { this.prefetch = { state: "pulling", ...p }; })
      .then(() => { this.prefetch = { ...this.prefetch, state: "ready" }; })
      .catch((e) => { this.prefetch = { ...this.prefetch, state: "error", error: `${String(e?.message ?? e)} Check your internet connection; Beamhop tries again when you create an agent.` }; this.prefetching = undefined; });
  }

  async loadDrivers() {
    const p = await loadJson<any>(this.home, "providers.json", {});
    const local = (process.env.SCUT_LOCAL_DRIVER ?? ((await SmolvmDriver.availability()).available ? "smolvm" : "docker")) as string;
    this.drivers.set("local", local === "smolvm" ? Object.assign(new SmolvmDriver(), { id: "local" }) : new DockerDriver({ id: "local", label: "This computer" }));
    // A second local container host labelled as cloud, for demos and tests without provider accounts.
    if (process.env.SCUT_SIM_CLOUD) this.drivers.set("sim-cloud", new DockerDriver({ id: "sim-cloud", label: "Cloud (simulated)" }));
    if (p.fly?.token) this.drivers.set("fly", new FlyDriver(p.fly.token, p.fly.org, p.fly.region));
    if (p.render?.token) this.drivers.set("render", new RenderDriver(p.render.token, p.render.ownerId));
    if (p.railway?.token) this.drivers.set("railway", new RailwayDriver(p.railway.token, p.railway.projectId, p.railway.environmentId));
  }

  /** The remembered brain (model endpoint + key). Stored only on this computer, readable only by you. */
  async brain(): Promise<ModelConfig | undefined> {
    return loadJson<ModelConfig | undefined>(this.home, "brain.json", undefined);
  }
  async saveBrain(m: ModelConfig) {
    await saveJson(this.home, "brain.json", m);
    await chmod(`${this.home}/brain.json`, 0o600).catch(() => {});
  }

  /** Check a model endpoint + key before an agent depends on it. Never throws: returns a plain-language answer. */
  static async verifyModel(m: ModelConfig): Promise<{ ok: boolean; error?: string; modelFound?: boolean; models?: string[] }> {
    // host.docker.internal is how agents reach this computer; from the app itself it is just localhost.
    const base = (m.baseUrl ?? "").replace(/\/+$/, "").replace("host.docker.internal", "127.0.0.1");
    if (!base) return { ok: false, error: "Missing endpoint URL" };
    try {
      let r: Response;
      if (m.api === "anthropic-messages") {
        r = await fetch(`${base}/v1/models`, { headers: { "x-api-key": m.apiKey ?? "", "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(10_000) });
      } else if (/openrouter\.ai/.test(base)) {
        r = await fetch(`${base}/key`, { headers: { authorization: `Bearer ${m.apiKey ?? ""}` }, signal: AbortSignal.timeout(10_000) });
        if (r.ok) {
          const list = (await (await fetch(`${base}/models`, { signal: AbortSignal.timeout(10_000) })).json().catch(() => ({ data: [] }))) as { data?: { id: string }[] };
          return { ok: true, modelFound: !!list.data?.some((x) => x.id === m.model), models: list.data?.map((x) => x.id).slice(0, 500) };
        }
      } else {
        r = await fetch(`${base}/models`, { headers: m.apiKey ? { authorization: `Bearer ${m.apiKey}` } : {}, signal: AbortSignal.timeout(10_000) });
      }
      if (r.status === 401 || r.status === 403) return { ok: false, error: "That key was rejected — check it and paste it again" };
      if (!r.ok) return { ok: false, error: `The endpoint answered ${r.status}` };
      const list = (await r.json().catch(() => ({}))) as { data?: { id: string }[] };
      return { ok: true, modelFound: list.data ? list.data.some((x) => x.id === m.model) : undefined, models: list.data?.map((x) => x.id).slice(0, 500) };
    } catch (e: any) {
      if (/:11434\b/.test(base)) return { ok: false, error: "Ollama isn't running on this computer. Install it from ollama.com, start it, then try again." };
      return { ok: false, error: /timeout|abort/i.test(String(e?.name ?? e)) ? "No answer from that endpoint" : `Couldn't reach it: ${String(e?.message ?? e).slice(0, 120)}` };
    }
  }

  async saveProvider(id: string, cfg: Record<string, string>) {
    const p = await loadJson<any>(this.home, "providers.json", {});
    p[id] = cfg;
    await saveJson(this.home, "providers.json", p);
    await this.loadDrivers();
  }

  save() {
    return saveJson(this.home, "agents.json", this.agents);
  }

  get(id: string) {
    const a = this.agents.find((x) => x.id === id || x.name.toLowerCase() === id.toLowerCase());
    if (!a) throw new Error(`no agent ${id}`);
    return a;
  }

  tokenCache = new Map<string, { token: string; at: number }>();
  /** Owner token for an agent endpoint, cached for 5 minutes (tokens are valid for 15). */
  auth(endpoint: string) {
    const host = new URL(endpoint).host;
    const c = this.tokenCache.get(host);
    if (c && Date.now() - c.at < 300_000) return c.token;
    const token = signAuth(this.ownerSk, host);
    this.tokenCache.set(host, { token, at: Date.now() });
    return token;
  }

  /** A fresh token (not cached), e.g. for a phone link valid for 15 minutes. */
  freshAuth(endpoint: string) {
    return signAuth(this.ownerSk, new URL(endpoint).host);
  }

  private prices = new Map<string, { in: number; out: number }>();
  /** USD per million tokens for OpenRouter models (fetched once per hour). */
  async price(model?: { baseUrl?: string; model: string }) {
    if (!model?.baseUrl?.includes("openrouter.ai")) return undefined;
    if (!this.prices.size || Date.now() - this.pricesAt > 3_600_000) {
      try {
        const j = (await (await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(8000) })).json()) as any;
        for (const m of j.data ?? []) this.prices.set(m.id, { in: Number(m.pricing?.prompt ?? 0) * 1e6, out: Number(m.pricing?.completion ?? 0) * 1e6 });
        this.pricesAt = Date.now();
      } catch {}
    }
    return this.prices.get(model.model);
  }
  private pricesAt = 0;

  private async req(endpoint: string, path: string, init: RequestInit = {}) {
    const r = await fetch(`${endpoint}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Scut ${this.auth(endpoint)}` },
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
    return r;
  }

  async waitState(endpoint: string, want: string[], timeoutMs = 120_000) {
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
    slack?: { appToken: string; botToken: string };
    discordToken?: string;
    nostr?: boolean | { relays?: string[]; ownerPubkey?: string };
    driver?: string;
    dailyTokenBudget?: number;
  }): Promise<AgentRecord> {
    const driver = this.drivers.get(o.driver ?? "local");
    if (!driver) throw new Error(`unknown destination ${o.driver}`);
    if ((o.driver ?? "local") === "local") await this.prefetching; // don't start a second download of the same image
    // The first agent's brain (model + key) is remembered on this computer so later agents don't ask again.
    const saved = await this.brain();
    if (o.model && !o.model.apiKey && saved?.apiKey && saved.baseUrl === o.model.baseUrl) o.model = { ...o.model, apiKey: saved.apiKey };
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
      channels: {
        ...(o.telegramToken ? { telegram: { token: o.telegramToken } } : {}),
        ...(o.slack ? { slack: o.slack } : {}),
        ...(o.discordToken ? { discord: { token: o.discordToken } } : {}),
        ...(o.nostr ? { nostr: o.nostr === true ? {} : o.nostr } : {}),
      },
      createdAt: Date.now(),
      dailyTokenBudget: o.dailyTokenBudget ?? 1_000_000, // default hard cap; 0 = none
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
    const rec: AgentRecord = { id, name: o.name, mascot: spec.mascot!, harness: spec.harness, agentPubkey: spec.agentPubkey, model: o.model && { baseUrl: o.model.baseUrl, model: o.model.model }, nostr: !!o.nostr, current: inst, history: [] };
    this.agents.push(rec);
    if (o.model?.apiKey && o.model.apiKey !== saved?.apiKey) await this.saveBrain(o.model);
    await this.save();
    await this.syncCrew();
    return rec;
  }

  /** Beam an agent to another host. The source keeps a cold copy until destroyed. */
  async beam(agentId: string, to: string, opts: { destroySource?: boolean; onStage?: (s: BeamStage) => void } = {}) {
    const rec = this.get(agentId);
    await this.updating.get(rec.id); // never beam a computer that is being rebuilt
    const driver = this.drivers.get(to);
    if (!driver) throw new Error(`unknown destination ${to}`);
    const src = rec.current;
    let summary: BeamSummary | undefined;
    const startedAt = Date.now();
    const stage = async (s: BeamStage, error?: string) => {
      const end = s === "online" || s === "failed";
      rec.beam = { to, from: src.driver, stage: s, error, startedAt, doneAt: end ? Date.now() : undefined, summary: end ? summary : undefined, target: end ? undefined : target ?? undefined };
      opts.onStage?.(s);
      await this.save();
    };
    let target: Instance | null = null;
    try {
      await stage("packing");
      const prep = (await (await this.req(src.endpoint, "/beam/prepare", { method: "POST" })).json()) as {
        bundleId: string; hash: string; size: number; sealed: string; hostPubkey: string; lease: Event; carried?: BeamSummary["carried"];
      };
      summary = { bytes: prep.size, carried: prep.carried ?? {} };
      const secrets = unseal<{ bundleKey: string; agentSk: string }>(this.ownerSk, prep.hostPubkey, prep.sealed);

      await stage("provisioning");
      const beamId = `beam-${bytesToHex(crypto.getRandomValues(new Uint8Array(6)))}`;
      const ticket: BeamTicket = { beamId, mode: "beam", ownerPubkey: this.ownerPubkey, agentPubkey: rec.agentPubkey, bundleHash: prep.hash, issuedAt: Date.now() };
      const suffix = bytesToHex(crypto.getRandomValues(new Uint8Array(2)));
      target = await driver.create({ name: `${rec.id}-${suffix}`, image: IMAGE, env: { ...EXTRA_ENV, BEAM_TICKET: encodeTicket(ticket) } });
      rec.beam!.target = target; // remembered so a crash from here on can be cleaned up or completed
      await this.save();
      await waitHealthy(target.endpoint);
      const hello = (await (await fetch(`${target.endpoint}/beam/hello`)).json()) as { hostPubkey: string };

      await stage("transferring");
      const cur = readLease(prep.lease, rec.agentPubkey);
      const lease = signLease(hexToBytes(secrets.agentSk), rec.id, { holder: hello.hostPubkey, seq: (cur?.seq ?? 0) + 1 });
      const dl = await this.req(src.endpoint, `/beam/bundle/${prep.bundleId}`);
      await this.req(target.endpoint, "/beam/bundle", { method: "PUT", body: dl.body, headers: { "content-length": String(prep.size) }, duplex: "half" } as RequestInit);
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
      if (opts.destroySource) {
        await this.drivers.get(src.driver)?.destroy(src).catch(() => {});
        src.meta = { ...src.meta, removed: "1" };
        await this.save();
      }
      return rec;
    } catch (e: any) {
      await this.req(src.endpoint, "/beam/abort", { method: "POST" }).catch(() => {});
      if (target) await driver.destroy(target).catch(() => {});
      await stage("failed", String(e?.message ?? e));
      throw e;
    }
  }

  /**
   * Move an agent into a passphrase-locked file, to carry to another computer. The agent stops here for good:
   * its host retires with a lease pointing at the file, so the copy in the file is the only live one.
   */
  async exportAgent(agentId: string, passphrase: string): Promise<{ file: Uint8Array; filename: string }> {
    if (passphrase.length < 8) throw new Error("Use a passphrase of at least 8 characters");
    const rec = this.get(agentId);
    const src = rec.current;
    const prep = (await (await this.req(src.endpoint, "/beam/prepare", { method: "POST" })).json()) as {
      bundleId: string; hash: string; size: number; sealed: string; hostPubkey: string; lease: Event;
    };
    try {
      const secrets = unseal<{ bundleKey: string; agentSk: string }>(this.ownerSk, prep.hostPubkey, prep.sealed);
      const bundle = new Uint8Array(await (await this.req(src.endpoint, `/beam/bundle/${prep.bundleId}`)).arrayBuffer());
      const seq = (readLease(prep.lease, rec.agentPubkey)?.seq ?? 0) + 1;
      const file = await writeAgentFile(
        { id: rec.id, name: rec.name, mascot: rec.mascot, harness: rec.harness, agentPubkey: rec.agentPubkey, model: rec.model, nostr: rec.nostr, hash: prep.hash, size: prep.size, leaseSeq: seq, exportedAt: Date.now() },
        secrets, passphrase, bundle,
      );
      const lease = signLease(hexToBytes(secrets.agentSk), rec.id, { holder: "file", seq });
      await this.req(src.endpoint, "/beam/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lease }) });
      await this.drivers.get(src.driver)?.destroy(src).catch(() => {});
      this.agents = this.agents.filter((a) => a.id !== rec.id);
      await this.save();
      await this.syncCrew();
      return { file, filename: `${rec.name.replace(/[^\w-]+/g, "_")}.beamhop` };
    } catch (e) {
      await this.req(src.endpoint, "/beam/abort", { method: "POST" }).catch(() => {});
      throw e;
    }
  }

  /** Bring an agent in from a file made by exportAgent, on this computer or any other Beamhop. You become its owner. */
  async importAgent(fileBytes: Uint8Array, passphrase: string, driverId = "local"): Promise<AgentRecord> {
    const { header: h, bundle, secrets } = await openAgentFile(fileBytes, passphrase);
    if (this.agents.some((a) => a.id === h.id)) throw new Error(`${h.name} is already here`);
    const driver = this.drivers.get(driverId);
    if (!driver) throw new Error(`unknown destination ${driverId}`);
    if (getPublicKey(hexToBytes(secrets.agentSk)) !== h.agentPubkey) throw new Error("This agent file is damaged");
    const beamId = `beam-${bytesToHex(crypto.getRandomValues(new Uint8Array(6)))}`;
    const ticket: BeamTicket = { beamId, mode: "beam", ownerPubkey: this.ownerPubkey, agentPubkey: h.agentPubkey, bundleHash: h.hash, issuedAt: Date.now() };
    const target = await driver.create({ name: `${h.id}-${bytesToHex(crypto.getRandomValues(new Uint8Array(2)))}`, image: IMAGE, env: { ...EXTRA_ENV, BEAM_TICKET: encodeTicket(ticket) } });
    try {
      await waitHealthy(target.endpoint);
      const hello = (await (await fetch(`${target.endpoint}/beam/hello`)).json()) as { hostPubkey: string };
      const lease = signLease(hexToBytes(secrets.agentSk), h.id, { holder: hello.hostPubkey, seq: h.leaseSeq + 1 });
      await this.req(target.endpoint, "/beam/bundle", { method: "PUT", body: bundle as Uint8Array<ArrayBuffer> });
      const handoff: Handoff = { beamId, agentSk: secrets.agentSk, bundleKey: secrets.bundleKey, lease };
      await this.req(target.endpoint, "/beam/handoff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sealed: seal(this.ownerSk, hello.hostPubkey, handoff) }) });
      await this.waitState(target.endpoint, ["running"]);
    } catch (e) {
      await driver.destroy(target).catch(() => {});
      throw e;
    }
    const rec: AgentRecord = { id: h.id, name: h.name, mascot: h.mascot, harness: h.harness as HarnessKind, agentPubkey: h.agentPubkey, model: h.model, nostr: h.nostr, current: target, history: [] };
    this.agents.push(rec);
    await this.save();
    await this.syncCrew();
    return rec;
  }

  /** Everyone in the crew room: the owner (app key + optional personal npub) and every agent with Nostr. */
  crewMembers(): { pubkey: string; name: string; kind: "agent" | "owner" }[] {
    return [
      { pubkey: this.ownerPubkey, name: "Owner", kind: "owner" as const },
      ...(this.ownerNpub ? [{ pubkey: this.ownerNpub, name: "Owner", kind: "owner" as const }] : []),
      ...this.agents.filter((a) => a.nostr).map((a) => ({ pubkey: a.agentPubkey, name: a.name, kind: "agent" as const })),
    ];
  }
  ownerNpub?: string;

  /** Push the crew list to every agent (over its WSS endpoint). */
  async syncCrew() {
    const members = this.crewMembers();
    await Promise.all(this.agents.filter((a) => a.nostr && !a.beam?.stage?.match(/packing|provisioning|transferring|restoring/)).map((a) => this.sendTo(a, { t: "crew", members })));
  }

  async remove(agentId: string) {
    const rec = this.get(agentId);
    for (const inst of [rec.current, ...rec.history]) await this.drivers.get(inst.driver)?.destroy(inst).catch(() => {});
    this.agents = this.agents.filter((a) => a !== rec);
    await this.save();
    await this.syncCrew();
  }
}

export const MASCOTS = ["cyan", "magenta", "lime", "amber", "violet", "coral"];

/** This computer's address on the local network: the first non-internal IPv4, skipping container/VM bridges. */
export function lanIPv4(): string | undefined {
  const all = Object.entries(networkInterfaces()).filter(([name]) => !/^(docker|br-|veth|virbr|vmnet|vboxnet|cni|flannel|lxc)/.test(name));
  const v4 = all.flatMap(([, list]) => list ?? []).filter((i) => i.family === "IPv4" && !i.internal).map((i) => i.address);
  return v4.find((a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)) ?? v4[0];
}

