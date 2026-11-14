import type { CreateOpts, HostDriver, Instance } from "./index.ts";

/**
 * Render driver: a Web Service from the prebuilt image with a persistent disk at /data.
 * (A Web Service, not a Background Worker, because the agent is its own relay and needs a public URL.)
 * UNTESTED without a Render API key. Endpoints per https://api-docs.render.com.
 */
export class RenderDriver implements HostDriver {
  id = "render";
  label = "Render";
  isolation = "container" as const;
  monthlyUsd = 85;
  private api = "https://api.render.com/v1";

  constructor(private token: string, private ownerId: string, private plan = "standard", private region = "frankfurt") {}

  private async call(method: string, path: string, body?: unknown) {
    const r = await fetch(`${this.api}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json", accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`render ${method} ${path}: ${r.status} ${await r.text()}`);
    const t = await r.text();
    return t ? JSON.parse(t) : {};
  }

  async create(o: CreateOpts): Promise<Instance> {
    const res = await this.call("POST", "/services", {
      type: "web_service",
      name: `scut-${o.name}`,
      ownerId: this.ownerId,
      image: { imagePath: o.image },
      envVars: [...Object.entries(o.env).map(([key, value]) => ({ key, value })), { key: "PORT", value: "8080" }],
      serviceDetails: {
        runtime: "image",
        plan: this.plan,
        region: this.region,
        healthCheckPath: "/health",
        disk: { name: "data", mountPath: "/data", sizeGB: o.diskGb ?? 10 },
      },
    });
    const svc = res.service ?? res;
    return { driver: this.id, instanceId: svc.id, endpoint: svc.serviceDetails?.url ?? `https://scut-${o.name}.onrender.com` };
  }

  async destroy(inst: Instance) {
    await this.call("DELETE", `/services/${inst.instanceId}`).catch(() => {});
  }
}
