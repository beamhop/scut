import type { CreateOpts, HostDriver, Instance } from "./index.ts";

/**
 * Railway driver: a service from the prebuilt image, a volume at /data and a generated public domain.
 * UNTESTED without a Railway token. GraphQL API per https://docs.railway.com/reference/public-api.
 */
export class RailwayDriver implements HostDriver {
  id = "railway";
  label = "Railway";
  isolation = "container" as const;
  monthlyUsd = 80;
  private api = "https://backboard.railway.com/graphql/v2";

  constructor(private token: string, private projectId: string, private environmentId: string) {}

  private async gql(query: string, variables: Record<string, unknown>) {
    const r = await fetch(this.api, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const j = (await r.json()) as { data?: any; errors?: { message: string }[] };
    if (j.errors?.length) throw new Error(`railway: ${j.errors.map((e) => e.message).join("; ")}`);
    return j.data;
  }

  async create(o: CreateOpts): Promise<Instance> {
    const { serviceCreate } = await this.gql(
      "mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }",
      { input: { projectId: this.projectId, name: `scut-${o.name}`, source: { image: o.image }, variables: { ...o.env, PORT: "8080" } } },
    );
    const serviceId = serviceCreate.id;
    await this.gql("mutation($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }", {
      input: { projectId: this.projectId, environmentId: this.environmentId, serviceId, mountPath: "/data" },
    });
    const { serviceDomainCreate } = await this.gql(
      "mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }",
      { input: { serviceId, environmentId: this.environmentId, targetPort: 8080 } },
    );
    await this.gql("mutation($id: String!, $env: String!) { serviceInstanceDeployV2(serviceId: $id, environmentId: $env) }", {
      id: serviceId,
      env: this.environmentId,
    });
    return { driver: this.id, instanceId: serviceId, endpoint: `https://${serviceDomainCreate.domain}` };
  }

  async destroy(inst: Instance) {
    await this.gql("mutation($id: String!) { serviceDelete(id: $id) }", { id: inst.instanceId }).catch(() => {});
  }
}
