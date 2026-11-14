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
