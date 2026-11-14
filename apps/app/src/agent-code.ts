// The agent's own software (agentd, the computer-use MCP server, the agent's web UI), built from the same source as
// this app. Local sandboxes start from the agent image, which can be older than the app: the app installs this code
// into each of its agents and restarts them, so an agent always runs exactly the app's version.
// The compiled app embeds it (scripts/embed-agent-code.ts writes ./agent-code.gen.ts); from source it is built here.
import { createHash } from "node:crypto";
import { Glob } from "bun";

export type AgentCode = { hash: string; files: Record<string, Uint8Array> };
/** agentd reports this from /health; the build swaps it for the code's hash. */
export const CODE_PLACEHOLDER = "__SCUT_AGENT_CODE__";

const ROOT = new URL("../../../", import.meta.url).pathname;
/** Where the image keeps each piece (its CMD, SCUT_MCP_CMD and SCUT_UI_DIR point at these). */
const TARGET = { agentd: "/opt/scut/packages/agentd/src/main.ts", mcp: "/opt/scut/packages/agent/src/mcp-computer.ts", ui: "/opt/scut/ui" };

/** Bundle agentd and the MCP server (self-contained: the image's node_modules don't matter) plus the built UI. */
export async function buildAgentCode(root = ROOT): Promise<AgentCode> {
  const r = await Bun.build({
    entrypoints: [`${root}packages/agentd/src/main.ts`, `${root}packages/agent/src/mcp-computer.ts`],
    target: "bun",
    minify: true,
    naming: "[name].[ext]",
  });
  if (!r.success) throw new Error(`Couldn't build the agent's code: ${r.logs.map(String).join("\n").slice(0, 500)}`);
  const out = Object.fromEntries(await Promise.all(r.outputs.map(async (o) => [o.path.split("/").pop()!, await o.text()] as const)));
  const agentd = out["main.js"], mcp = out["mcp-computer.js"];
  if (!agentd || !mcp) throw new Error(`Couldn't build the agent's code: got ${Object.keys(out).join(", ")}`);
  const files: Record<string, Uint8Array> = {};
  const enc = new TextEncoder();
  files[TARGET.mcp] = enc.encode(mcp);
  const ui = `${root}packages/ui/dist/`;
  for await (const f of new Glob("**/*").scan(ui)) files[`${TARGET.ui}/${f}`] = new Uint8Array(await Bun.file(ui + f).arrayBuffer());
  const h = createHash("sha256").update(agentd);
  for (const k of Object.keys(files).sort()) h.update(k).update(files[k]);
  const hash = h.digest("hex").slice(0, 16);
  if (!agentd.includes(CODE_PLACEHOLDER)) throw new Error("agentd's code marker is missing from its bundle");
  files[TARGET.agentd] = enc.encode(agentd.replaceAll(CODE_PLACEHOLDER, hash));
  return { hash, files };
}

let cached: Promise<AgentCode | null> | undefined;
/** This app's agent code; null when it can't be had (then agents keep what their image has). */
export function agentCode(): Promise<AgentCode | null> {
  cached ??= (async () => {
    // The compiled app uses the copy embedded at build time; running from source, always the source as it is now.
    if (/\$bunfs|~BUN/.test(Bun.main)) try {
      const { code } = await import("./agent-code.gen.ts");
      if (code?.hash) return { hash: code.hash, files: Object.fromEntries(Object.entries(code.files).map(([k, v]) => [k, Buffer.from(v, "base64")])) };
    } catch {}
    try {
      return await buildAgentCode();
    } catch (e: any) {
      console.error(String(e?.message ?? e));
      return null;
    }
  })();
  return cached;
}
