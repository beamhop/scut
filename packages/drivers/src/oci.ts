// A small OCI registry client: pull the agent image without Docker, for the hosts that have no Docker (gVisor on
// Linux, WSL2 on Windows). Anonymous pulls from ghcr.io / Docker Hub style registries, layers cached by digest and
// checked against it, and a root filesystem assembled with the OCI whiteout rules.
import { mkdir, rename, rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type ImageRef = { registry: string; repo: string; reference: string; insecure: boolean };
export type ImageConfig = { Env?: string[]; Entrypoint?: string[] | null; Cmd?: string[] | null; WorkingDir?: string };
export type Layer = { digest: string; mediaType: string; size: number; path: string };
export type PulledImage = { ref: ImageRef; digest: string; config: ImageConfig; layers: Layer[]; configDigest: string };

const MANIFEST_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

export function parseRef(image: string): ImageRef {
  let rest = image;
  let registry = "registry-1.docker.io";
  const first = rest.split("/")[0];
  if (rest.includes("/") && (first.includes(".") || first.includes(":") || first === "localhost")) {
    registry = first === "docker.io" ? "registry-1.docker.io" : first;
    rest = rest.slice(first.length + 1);
  }
  let reference = "latest";
  const at = rest.indexOf("@");
  if (at >= 0) {
    reference = rest.slice(at + 1);
    rest = rest.slice(0, at);
  } else {
    const colon = rest.lastIndexOf(":");
    if (colon > rest.lastIndexOf("/")) {
      reference = rest.slice(colon + 1);
      rest = rest.slice(0, colon);
    }
  }
  if (registry === "registry-1.docker.io" && !rest.includes("/")) rest = `library/${rest}`;
  const host = registry.split(":")[0];
  const insecure = host === "localhost" || host === "127.0.0.1" || process.env.SCUT_INSECURE_REGISTRY === registry;
  return { registry, repo: rest, reference, insecure };
}

export const goArch = () => (process.arch === "arm64" ? "arm64" : "amd64");

class Registry {
  private token?: string;
  constructor(private ref: ImageRef) {}
  private get base() { return `${this.ref.insecure ? "http" : "https"}://${this.ref.registry}/v2/${this.ref.repo}`; }

  async get(path: string, accept?: string): Promise<Response> {
    const doFetch = () => fetch(`${this.base}${path}`, {
      headers: { ...(accept ? { accept } : {}), ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      redirect: "follow",
      signal: AbortSignal.timeout(path.includes("/blobs/") ? 30 * 60_000 : 30_000),
    });
    let r = await doFetch();
    if (r.status === 401 && !this.token) {
      const h = r.headers.get("www-authenticate") ?? "";
      const realm = h.match(/realm="([^"]+)"/)?.[1];
      if (!realm) throw new Error(`The registry ${this.ref.registry} refused the download (401)`);
      const service = h.match(/service="([^"]+)"/)?.[1];
      const u = new URL(realm);
      if (service) u.searchParams.set("service", service);
      u.searchParams.set("scope", `repository:${this.ref.repo}:pull`);
      const t = (await (await fetch(u, { signal: AbortSignal.timeout(30_000) })).json()) as { token?: string; access_token?: string };
      this.token = t.token ?? t.access_token;
      r = await doFetch();
    }
    if (!r.ok) throw new Error(`Couldn't download the agent computer: ${this.ref.registry} answered ${r.status} for ${path.split("/").pop()}`);
    return r;
  }
}

/** Download (or reuse) every blob of `image` for this computer's architecture into `cacheDir`. */
export async function pullImage(image: string, cacheDir: string, onProgress?: (p: { done: number; total: number }) => void): Promise<PulledImage> {
  const ref = parseRef(image);
  const reg = new Registry(ref);
  let r = await reg.get(`/manifests/${ref.reference}`, MANIFEST_TYPES);
  let digest = r.headers.get("docker-content-digest") ?? "";
  let m = (await r.json()) as any;
  if (m.manifests) {
    const want = m.manifests.find((x: any) => x.platform?.os === "linux" && x.platform?.architecture === goArch());
    if (!want) throw new Error(`The agent computer isn't built for ${goArch()}`);
    r = await reg.get(`/manifests/${want.digest}`, MANIFEST_TYPES);
    digest = want.digest;
    m = await r.json();
  }
  const blobs = `${cacheDir}/blobs`;
  await mkdir(blobs, { recursive: true });
  const fetchBlob = async (d: string): Promise<string> => {
    const path = `${blobs}/${d.replace(":", "-")}`;
    if (existsSync(path)) return path;
    const res = await reg.get(`/blobs/${d}`);
    const tmp = `${path}.part`;
    const w = Bun.file(tmp).writer();
    const hash = new Bun.CryptoHasher("sha256");
    for await (const chunk of res.body as ReadableStream<Uint8Array>) {
      hash.update(chunk);
      w.write(chunk);
    }
    await w.end();
    const got = `sha256:${hash.digest("hex")}`;
    if (got !== d) {
      await rm(tmp, { force: true });
      throw new Error(`Downloaded part ${d.slice(7, 19)} is damaged (checksum mismatch); try again`);
    }
    await rename(tmp, path);
    return path;
  };
  const config = (await Bun.file(await fetchBlob(m.config.digest)).json()) as { config?: ImageConfig };
  const layers: Layer[] = [];
  const total = m.layers.length;
  onProgress?.({ done: 0, total });
  // A few at a time: big layers download in parallel, without opening dozens of connections.
  let next = 0;
  let done = 0;
  const out: Layer[] = new Array(total);
  await Promise.all(Array.from({ length: Math.min(3, total) }, async () => {
    while (next < total) {
      const i = next++;
      const l = m.layers[i];
      out[i] = { digest: l.digest, mediaType: l.mediaType, size: l.size, path: await fetchBlob(l.digest) };
      onProgress?.({ done: ++done, total });
    }
  }));
  layers.push(...out);
  return { ref, digest: digest || m.config.digest, config: config.config ?? {}, layers, configDigest: m.config.digest };
}

const tarCompression = (mediaType: string) => (mediaType.endsWith("zstd") ? ["--zstd"] : mediaType.endsWith("gzip") || mediaType.endsWith("tar.gzip") ? ["-z"] : []);

/** Files a layer deletes from the layers under it (OCI whiteouts). Exported for tests. */
export function whiteouts(entries: string[]): { remove: string[]; opaque: string[]; markers: string[] } {
  const remove: string[] = [];
  const opaque: string[] = [];
  const markers: string[] = [];
  for (const raw of entries) {
    const e = raw.replace(/^\.\//, "").replace(/\/$/, "");
    const slash = e.lastIndexOf("/");
    const dir = slash >= 0 ? e.slice(0, slash) : "";
    const base = e.slice(slash + 1);
    if (base === ".wh..wh..opq") { opaque.push(dir); markers.push(e); }
    else if (base.startsWith(".wh.")) { remove.push(dir ? `${dir}/${base.slice(4)}` : base.slice(4)); markers.push(e); }
  }
  return { remove, opaque, markers };
}

const safe = (root: string, p: string) => {
  const full = join(root, p);
  if (!full.startsWith(root.endsWith("/") ? root : `${root}/`) && full !== root) throw new Error(`layer path escapes the root: ${p}`);
  return full;
};

/** Apply image layers in order into `dest` (created fresh). Needs `tar` (every Linux and macOS has it). */
export async function extractRootfs(layers: Layer[], dest: string) {
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  for (const l of layers) {
    const list = Bun.spawnSync(["tar", ...tarCompression(l.mediaType), "-tf", l.path], { stdout: "pipe", stderr: "pipe" });
    if (list.exitCode !== 0) throw new Error(`Couldn't read a layer of the agent computer: ${list.stderr.toString().slice(0, 200)}`);
    const wh = whiteouts(list.stdout.toString().split("\n").filter(Boolean));
    for (const d of wh.opaque) {
      const full = safe(dest, d);
      for (const f of await readdir(full).catch(() => [] as string[])) await rm(join(full, f), { recursive: true, force: true });
    }
    for (const f of wh.remove) await rm(safe(dest, f), { recursive: true, force: true });
    const asRoot = process.getuid?.() === 0;
    const x = Bun.spawnSync(
      ["tar", ...tarCompression(l.mediaType), "-xf", l.path, "-C", dest, "--exclude=*.wh.*", ...(asRoot ? ["--same-owner"] : ["--no-same-owner"]), "--delay-directory-restore"],
      { stdout: "ignore", stderr: "pipe" },
    );
    if (x.exitCode !== 0) {
      // Without root, device nodes (/dev/*) can't be made; the sandbox provides its own /dev.
      const errs = x.stderr.toString().split("\n").filter((s) => s.trim() && !/Cannot mknod|Exiting with failure status due to previous errors/.test(s));
      if (errs.length) throw new Error(`Couldn't unpack the agent computer: ${errs.slice(0, 3).join("; ")}`);
    }
  }
  // Directories from layers can come out read-only for the owner; the sandbox writes into an overlay, but keep it tidy.
  await stat(dest);
}

/** Delete cached blobs of older images: only the ones `img` needs stay (they make the next update a small download). */
export async function pruneBlobs(cacheDir: string, img: PulledImage) {
  const keep = new Set([img.configDigest, ...img.layers.map((l) => l.digest)].map((d) => d.replace(":", "-")));
  for (const f of await readdir(`${cacheDir}/blobs`).catch(() => [] as string[])) {
    if (!keep.has(f)) await rm(`${cacheDir}/blobs/${f}`, { force: true });
  }
}
