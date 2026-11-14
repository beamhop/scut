// Local app server: serves the UI and a small API. The desktop shell opens this in a webview.
import type { Scut } from "./core.ts";

export function serve(scut: Scut, port: number, uiDir: string) {
  const json = (v: unknown, status = 200) => Response.json(v, { status });
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 255,
    async fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;
      try {
        if (p === "/api/agents" && req.method === "GET") {
          return json(scut.agents.map((a) => ({ ...a, token: scut.auth(a.current.endpoint) })));
        }
        if (p === "/api/agents" && req.method === "POST") {
          const body = (await req.json()) as any;
          const rec = await scut.create(body);
          return json(rec);
        }
        if (p === "/api/destinations") {
          return json([...scut.drivers.values()].map((d) => ({ id: d.id, label: d.label, isolation: d.isolation, monthlyUsd: d.monthlyUsd })));
        }
        const m = p.match(/^\/api\/agents\/([^/]+)(?:\/(\w+))?$/);
        if (m) {
          const [, id, action] = m;
          const rec = scut.get(decodeURIComponent(id));
          if (!action && req.method === "DELETE") {
            await scut.remove(rec.id);
            return json({ ok: true });
          }
          if (!action) return json({ ...rec, token: scut.auth(rec.current.endpoint) });
          if (action === "token") return json({ endpoint: rec.current.endpoint, token: scut.auth(rec.current.endpoint) });
          if (action === "beam" && req.method === "POST") {
            const { to } = (await req.json()) as { to: string };
            if (rec.beam && !["online", "failed"].includes(rec.beam.stage)) return json({ error: "beam in progress" }, 409);
            rec.beam = { to, stage: "packing", startedAt: Date.now() };
            scut.beam(rec.id, to).catch((e) => console.error("beam failed", e));
            return json({ ok: true });
          }
        }
        if (p === "/api/providers" && req.method === "POST") {
          const { id, ...cfg } = (await req.json()) as any;
          await scut.saveProvider(id, cfg);
          return json({ ok: true });
        }
        const f = Bun.file(`${uiDir}${p === "/" ? "/index.html" : p}`);
        if (await f.exists()) return new Response(f);
        return new Response(Bun.file(`${uiDir}/index.html`));
      } catch (e: any) {
        return json({ error: String(e?.message ?? e) }, 500);
      }
    },
  });
}
