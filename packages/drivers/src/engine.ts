// The local microVM engine (smolmachines) ships inside the compiled app: scripts/embed-engine.ts packs the SDK and
// this platform's native package (addon, signed boot helper, hypervisor libraries, guest rootfs) into the binary.
// On first use it is unpacked once into ~/.scut/engines/ and loaded from there, so nothing has to be installed.
// From a source checkout (no embedded engine) the SDK comes from node_modules as usual.
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type Embedded = { version: string; platform: string; blob: string };

async function embedded(): Promise<Embedded | null> {
  try {
    return (await import("./engine-blob.ts")).engine;
  } catch {
    return null; // source checkout: not generated
  }
}

/** Unpack the embedded engine (once per version) and return its directory. */
export async function unpackEngine(e: Embedded, home = process.env.SCUT_HOME ?? join(homedir(), ".scut")): Promise<string> {
  const dir = join(home, "engines", `smolmachines-${e.version}-${e.platform}`);
  if (existsSync(join(dir, ".complete"))) return dir;
  const raw = Bun.zstdDecompressSync(new Uint8Array(await Bun.file(e.blob).arrayBuffer()));
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const hlen = view.getUint32(0);
  const files: { path: string; mode: number; size: number }[] = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + hlen)));
  const tmp = `${dir}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  let off = 4 + hlen;
  for (const f of files) {
    if (f.path.split("/").includes("..")) throw new Error(`bad engine entry ${f.path}`);
    const p = join(tmp, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, raw.subarray(off, off + f.size));
    chmodSync(p, f.mode);
    off += f.size;
  }
  writeFileSync(join(tmp, ".complete"), e.version);
  rmSync(dir, { recursive: true, force: true });
  try {
    renameSync(tmp, dir);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    if (!existsSync(join(dir, ".complete"))) throw err; // another process won the race otherwise
  }
  return dir;
}

/** The smolmachines SDK module: the copy embedded in the app when there is one, else node_modules. */
export async function loadSmolmachines(): Promise<any> {
  const e = await embedded();
  if (e) {
    const dir = await unpackEngine(e);
    return createRequire(join(dir, "noop.js"))(join(dir, "smolmachines/dist/index.js"));
  }
  return await import("smolmachines");
}
