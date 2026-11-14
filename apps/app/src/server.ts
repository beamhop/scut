// Local app server: serves the UI and a small API. The desktop shell opens this in a webview.
import { Scut } from "./core.ts";
import type { HarnessKind, ModelConfig } from "@scut/protocol";
import { FlyDriver, RailwayDriver, RenderDriver } from "@scut/drivers";
import type { CrewRoom } from "./crew.ts";
import { autostartEnabled, setAutostart } from "./autostart.ts";

let embedded: Record<string, { type: string; b64: string }> | null = null;
try {
  embedded = (await import("./ui-assets.ts")).assets;
} catch {
  embedded = null; // dev: serve packages/ui/dist from disk
}
function asset(path: string): Response | null {
  const a = embedded?.[path] ?? (path.includes(".") ? null : embedded?.["/index.html"]);
  return a ? new Response(Buffer.from(a.b64, "base64"), { headers: { "content-type": a.type } }) : null;
}

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY", // nobody can frame the app and trick a click on "Allow"
  "content-security-policy": "frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
};

/**
 * The app API runs on localhost, but any website the user visits can still send requests to it.
 * Refuse anything that isn't from the app's own page: a foreign Host (DNS rebinding) or a foreign Origin (CSRF).
 */
export function localOnly(req: Request): string | null {
  const host = req.headers.get("host") ?? "";
  if (!LOOPBACK.test(host)) return "forbidden host";
  const origin = req.headers.get("origin");
  if (origin && origin !== `http://${host}`) return "forbidden origin";
  if (req.headers.get("sec-fetch-site") === "cross-site") return "forbidden cross-site request";
  return null;
}

export function serve(scut: Scut, port: number, uiDir: string, crew?: CrewRoom) {
  const json = (v: unknown, status = 200) => Response.json(v, { status });
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 255,
    maxRequestBodySize: 8 * 1024 * 1024 * 1024, // agent files carry a whole workspace
    async fetch(req) {
      const bad = localOnly(req);
      if (bad) return new Response(bad, { status: 403, headers: SECURITY_HEADERS });
      const res = await handle(req);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
      return res;
    },
  });

  async function handle(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const p = url.pathname;
      try {
        if (p === "/api/agents" && req.method === "GET") {
          return json(await Promise.all(scut.agents.map(async (a) => ({ ...a, token: scut.auth(a.current.endpoint), price: await scut.price(a.model), ...(scut.updating.has(a.id) ? { updating: true } : {}) }))));
        }
        if (p === "/api/agents" && req.method === "POST") {
          const body = (await req.json()) as any;
          const rec = await scut.create(body);
          return json(rec);
        }
        if (p === "/api/crew" && req.method === "GET") return json({ enabled: !!crew, lines: crew?.lines.slice(-200) ?? [], members: scut.crewMembers() });
        if (p === "/api/crew" && req.method === "POST") {
          const { text } = (await req.json()) as { text: string };
          if (!crew) return json({ error: "crew room disabled" }, 400);
          await crew.post(String(text).slice(0, 4000));
          return json({ ok: true });
        }
        // Global controls: pause (a plain pause, not "you have control"), resume or stop every agent at once.
        if ((p === "/api/agents/pause-all" || p === "/api/agents/resume-all" || p === "/api/agents/stop-all") && req.method === "POST") {
          const msg = p.endsWith("pause-all") ? { t: "pause", paused: true, control: false } : p.endsWith("resume-all") ? { t: "pause", paused: false, control: false } : { t: "stop" };
          return json({ ok: true, ...(await scut.sendAll(msg)) });
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
          if (action === "export" && req.method === "POST") {
            const { passphrase } = (await req.json()) as { passphrase: string };
            try {
              const { file, filename } = await scut.exportAgent(rec.id, String(passphrase ?? ""));
              return new Response(file as Uint8Array<ArrayBuffer>, { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${filename}"` } });
            } catch (e: any) {
              return json({ error: String(e?.message ?? e) }, 400);
            }
          }
          if (action === "model" && req.method === "POST") {
            // The brain changed in the agent's Settings (no key here): get its agent software ready on this computer
            // if it runs without a sandbox, and keep the tile's price and labels in step.
            const b = (await req.json()) as { harness?: HarnessKind; baseUrl?: string; model?: string | null };
            await scut.setBrain(rec, { harness: b.harness, model: b.model === null ? null : typeof b.model === "string" && b.model ? { baseUrl: b.baseUrl, model: b.model } : undefined });
            return json({ ok: true });
          }
          if (action === "token") return json({ endpoint: rec.current.endpoint, token: scut.auth(rec.current.endpoint) });
          if (action === "phone") return json(scut.phoneLink(rec));
          if (action === "beam" && req.method === "POST") {
            const { to } = (await req.json()) as { to: string };
            if (rec.beam && !["online", "failed"].includes(rec.beam.stage)) return json({ error: "beam in progress" }, 409);
            rec.beam = { to, stage: "packing", startedAt: Date.now() };
            // Once the agent is up on the new host the old one is only a retired shell; remove it (cloud hosts bill by the hour).
            scut.beam(rec.id, to, { destroySource: true }).catch((e) => console.error("beam failed", e));
            return json({ ok: true });
          }
        }
        if (p === "/api/import" && req.method === "POST") {
          try {
            const rec = await scut.importAgent(new Uint8Array(await req.arrayBuffer()), decodeURIComponent(req.headers.get("x-passphrase") ?? ""), url.searchParams.get("to") ?? "local");
            return json(rec);
          } catch (e: any) {
            return json({ error: String(e?.message ?? e) }); // a wrong passphrase is an answer, not a server error
          }
        }
        if (p === "/api/prefetch") return json(scut.prefetch);
        // Where agents run on this computer, how it was picked, and the choice when nothing works.
        if (p === "/api/local" && req.method === "GET") {
          const d = scut.drivers.get("local");
          return json({ ...scut.local, label: d?.label, isolation: d?.isolation, clouds: [...scut.drivers.keys()].filter((k) => k !== "local") });
        }
        if (p === "/api/local" && req.method === "POST") {
          const { allowHost } = (await req.json()) as { allowHost?: boolean };
          await scut.allowHost(!!allowHost);
          const d = scut.drivers.get("local");
          return json({ ...scut.local, label: d?.label, isolation: d?.isolation });
        }
        if (p === "/api/local/sandboxes" && req.method === "GET") return json(await scut.sandboxes(url.searchParams.has("fresh")));
        if (p === "/api/local/enable-wsl" && req.method === "POST") return json(scut.enableWsl());
        if (p === "/api/autostart") {
          if (req.method === "POST") await setAutostart(!!((await req.json()) as { on: boolean }).on);
          return json({ on: await autostartEnabled() });
        }
        if (p === "/api/brain" && req.method === "GET") {
          const b = await scut.brain();
          return json(b ? { api: b.api, baseUrl: b.baseUrl, model: b.model, hasKey: !!b.apiKey } : null);
        }
        if (p === "/api/brain/verify" && req.method === "POST") {
          const m = (await req.json()) as ModelConfig;
          const saved = await scut.brain();
          if (!m.apiKey && saved?.baseUrl === m.baseUrl) m.apiKey = saved!.apiKey;
          return json(await Scut.verifyModel(m));
        }
        if (p === "/api/providers" && req.method === "POST") {
          const { id, token } = (await req.json()) as { id: string; token: string };
          if (!token?.trim()) return json({ ok: false, error: "Paste a token first" });
          try {
            const t = token.trim();
            if (id === "fly") await scut.saveProvider("fly", { token: t, ...(await FlyDriver.verify(t)) });
            else if (id === "render") await scut.saveProvider("render", { token: t, ownerId: (await RenderDriver.verify(t)).ownerId });
            else if (id === "railway") await scut.saveProvider("railway", { token: t, ...(await RailwayDriver.verify(t)) });
            else return json({ error: `unknown provider ${id}` }, 400);
          } catch (e: any) {
            return json({ ok: false, error: String(e?.message ?? e) }); // a rejected token is an answer, not a server error
          }
          return json({ ok: true });
        }
        // Prefer the UI on disk (development); fall back to the copy embedded in the compiled binary.
        const f = Bun.file(`${uiDir}${p === "/" ? "/index.html" : p}`);
        if (await f.exists()) return new Response(f);
        const e = asset(p === "/" ? "/index.html" : p);
        if (e) return e;
        return new Response(Bun.file(`${uiDir}/index.html`));
      } catch (e: any) {
        return json({ error: String(e?.message ?? e) }, 500);
      }
  }
}
