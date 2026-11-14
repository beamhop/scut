import type { CreateOpts, HostDriver, Instance } from "./index.ts";

/**
 * Fly.io Machines driver: one app + volume + machine per agent, public HTTPS on <app>.fly.dev.
 * UNTESTED without a Fly API token. Endpoints per https://fly.io/docs/machines/api/.
 */
export class FlyDriver implements HostDriver {
  id = "fly";
  label = "Fly.io";
  isolation = "vm" as const;
  monthlyUsd = 21.4;
  private api = "https://api.machines.dev/v1";

  constructor(private token: string, private org = "personal", private region = "ams") {}

  private async call(method: string, path: string, body?: unknown) {
    const r = await fetch(`${this.api}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`fly ${method} ${path}: ${r.status} ${await r.text()}`);
    const t = await r.text();
    return t ? JSON.parse(t) : {};
  }

  async create(o: CreateOpts): Promise<Instance> {
    const app = `scut-${o.name}`.slice(0, 63);
    await this.call("POST", "/apps", { app_name: app, org_slug: this.org });
    // shared IPv4/IPv6 so <app>.fly.dev resolves
    await fetch("https://api.fly.io/graphql", {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        query: "mutation($input: AllocateIPAddressInput!) { allocateIpAddress(input: $input) { ipAddress { address } } }",
        variables: { input: { appId: app, type: "shared_v4" } },
      }),
    });
    const vol = await this.call("POST", `/apps/${app}/volumes`, { name: "data", region: this.region, size_gb: o.diskGb ?? 10 });
    const machine = await this.call("POST", `/apps/${app}/machines`, {
      region: this.region,
      config: {
        image: o.image,
        env: o.env,
        guest: { cpu_kind: "shared", cpus: o.cpus ?? 2, memory_mb: o.memoryMb ?? 4096 },
        mounts: [{ volume: vol.id, path: "/data" }],
        services: [{ protocol: "tcp", internal_port: 8080, ports: [{ port: 443, handlers: ["tls", "http"] }, { port: 80, handlers: ["http"] }] }],
        restart: { policy: "always" },
      },
    });
    return { driver: this.id, instanceId: machine.id, endpoint: `https://${app}.fly.dev`, meta: { app, volume: vol.id } };
  }

  async destroy(inst: Instance) {
    await this.call("DELETE", `/apps/${inst.meta!.app}?force=true`).catch(() => {});
  }
}
