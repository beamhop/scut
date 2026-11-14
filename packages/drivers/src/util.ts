// Small helpers shared by the local drivers.
import { createServer } from "node:net";

/** A TCP port that is free on 127.0.0.1 right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** Is something already listening on 127.0.0.1:port? */
export function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(true));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(false)));
  });
}

/** Write `files` (absolute paths) under a new temporary folder, as they should land in the agent's root; and a tar of it. */
export async function stageFiles(files: Record<string, Uint8Array>): Promise<{ dir: string; tar: string; cleanup: () => Promise<void> }> {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const base = await mkdtemp(`${tmpdir()}/scut-code-`);
  const dir = `${base}/root`;
  for (const [p, data] of Object.entries(files)) {
    await mkdir(`${dir}${p.slice(0, p.lastIndexOf("/"))}`, { recursive: true });
    await writeFile(`${dir}${p}`, data);
  }
  const tar = `${base}/code.tar`;
  const t = run(["tar", "-cf", tar, "-C", dir, "."], { timeout: 60_000 });
  if (t.code !== 0) throw new Error(`Couldn't pack the agent's code: ${t.err.slice(0, 200)}`);
  return { dir, tar, cleanup: () => rm(base, { recursive: true, force: true }) };
}

/** Shell lines that keep `<f>.prev` copies of files about to be replaced, or put them back. Paths are quoted. */
export function backupScript(paths: string[], restore = false): string {
  const q = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;
  return paths.map((p) => restore
    ? `if [ -f ${q(p + ".prev")} ]; then mv -f ${q(p + ".prev")} ${q(p)}; fi`
    : `mkdir -p ${q(p.slice(0, p.lastIndexOf("/")) || "/")}; if [ -f ${q(p)} ]; then cp -f ${q(p)} ${q(p + ".prev")}; fi`).join("\n");
}

/** Like run, without blocking: for long installs while the app keeps serving. */
export async function runAsync(cmd: string[], opts: { timeout?: number; env?: Record<string, string | undefined>; cwd?: string } = {}): Promise<{ code: number; out: string; err: string }> {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: opts.timeout ?? 30_000, env: opts.env as Record<string, string>, cwd: opts.cwd });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { code: code ?? 1, out, err };
  } catch (e: any) {
    return { code: 127, out: "", err: String(e?.message ?? e) };
  }
}

/** Runs a command and never throws: a missing binary is exit code 127. */
export function run(cmd: string[], opts: { timeout?: number; env?: Record<string, string | undefined>; cwd?: string } = {}): { code: number; out: string; err: string } {
  try {
    const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: opts.timeout ?? 30_000, env: opts.env as Record<string, string>, cwd: opts.cwd });
    return { code: p.exitCode ?? 1, out: p.stdout.toString(), err: p.stderr.toString() };
  } catch (e: any) {
    return { code: 127, out: "", err: String(e?.message ?? e) };
  }
}
