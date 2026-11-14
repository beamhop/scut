// Harness adapters: the agent loop is pluggable (Pi default; Codex CLI, Copilot CLI, opencode; mock for tests).
// Every harness runs with HOME=<data>/home so its sessions, logins and config live in /data and beam with the agent.
import type { AgentSpec } from "@scut/protocol";
import { mkdir } from "node:fs/promises";

export type HarnessEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; args: unknown }
  | { type: "tool_end"; name: string; isError: boolean }
  | { type: "usage"; input: number; output: number }
  | { type: "error"; message: string };

export interface Harness {
  start(): Promise<void>;
  /** Run one prompt to completion; resolves with the final assistant text. */
  prompt(text: string, onEvent: (e: HarnessEvent) => void): Promise<string>;
  stop(): Promise<void>;
  /** Interrupt the current prompt, keeping the session. */
  abort?(): void;
}

export interface HarnessContext {
  spec: AgentSpec;
  dataDir: string;
  /** Command that starts the computer-use MCP server (stdio). */
  mcpCommand: string[];
  mcpEnv: Record<string, string>;
  systemPrompt: string;
}

export function systemPromptFor(spec: AgentSpec): string {
  const role =
    spec.template === "researcher"
      ? "You research topics on the web and write clear, sourced reports."
      : spec.template === "developer"
        ? "You are a software developer working in your workspace."
        : "You are a personal assistant who gets errands done in your own web browser.";
  return [
    `You are ${spec.name}, an AI agent with your own Linux computer (1280x800 screen) and a Chromium browser.`,
    role,
    spec.persona ? `Persona: ${spec.persona}` : "",
    "Use the `computer` MCP tools (screenshot, click, type_text, key, scroll, open_url) to operate your computer.",
    "When you learn something durable about your owner or your work (preferences, names, decisions), save it with the remember tool.",
    "Take a screenshot before acting and after each important step.",
    "Before payments, sending messages to new contacts, deleting data, or entering credentials, call request_approval and wait.",
    "Your human may move their own cursor on your screen at the same time; do not fight it.",
    "Keep replies short; you are chatting in Telegram, Slack, Discord, Nostr or the Beamhop app.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function harnessEnv(ctx: HarnessContext): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    HOME: `${ctx.dataDir}/home`,
    PI_CODING_AGENT_DIR: `${ctx.dataDir}/home/.pi/agent`,
    PI_OFFLINE: "1",
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Bun.write(path, JSON.stringify(value, null, 2));
}

// ---------------- Pi (RPC mode) ----------------
export class PiHarness implements Harness {
  private proc?: ReturnType<typeof Bun.spawn>;
  private listeners = new Set<(rec: any) => void>();
  private seq = 0;

  constructor(private ctx: HarnessContext) {}

  async start() {
    const { spec, dataDir } = this.ctx;
    const agentDir = `${dataDir}/home/.pi/agent`;
    const m = spec.model;
    if (m) {
      await writeJson(`${agentDir}/models.json`, {
        providers: {
          scut: {
            baseUrl: m.baseUrl,
            api: m.api,
            apiKey: m.apiKey ?? "none",
            models: [{ id: m.model, input: ["text", "image"] }],
          },
        },
      });
    }
    await writeJson(`${agentDir}/mcp.json`, {
      mcpServers: {
        computer: {
          command: this.ctx.mcpCommand[0],
          args: this.ctx.mcpCommand.slice(1),
          env: this.ctx.mcpEnv,
          exposure: "direct",
          description: "Your own computer: screen, mouse, keyboard and Chromium browser",
        },
      },
    });
    await mkdir(`${dataDir}/workspace`, { recursive: true });
    await Bun.write(`${dataDir}/workspace/AGENTS.md`, this.ctx.systemPrompt);
    const piBin = process.env.SCUT_PI_BIN ?? "pi";
    const args = [piBin, "--mode", "rpc", "--session-dir", `${dataDir}/sessions`, "--continue"];
    if (m) args.push("--model", `scut/${m.model}`);
    this.proc = Bun.spawn(args, {
      cwd: `${dataDir}/workspace`,
      env: harnessEnv(this.ctx),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    this.readLoop();
  }

  private async readLoop() {
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of this.proc!.stdout as ReadableStream<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line);
          for (const l of this.listeners) l(rec);
        } catch {
          /* ignore non-JSON */
        }
      }
    }
  }

  private send(cmd: Record<string, unknown>) {
    const id = `scut-${++this.seq}`;
    (this.proc!.stdin as any).write(JSON.stringify({ id, ...cmd }) + "\n");
    return id;
  }

  prompt(text: string, onEvent: (e: HarnessEvent) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      let final = "";
      const l = (rec: any) => {
        if (rec.type === "response" && rec.id === id && rec.success === false) {
          this.listeners.delete(l);
          reject(new Error(rec.error));
        } else if (rec.type === "response" && rec.id === id && rec.data?.disposition === "handled") {
          this.listeners.delete(l);
          resolve(final);
        } else if (rec.type === "message_update" && rec.assistantMessageEvent?.type === "text_delta") {
          onEvent({ type: "text", delta: rec.assistantMessageEvent.delta });
        } else if (rec.type === "message_end" && rec.message?.role === "assistant") {
          const parts = Array.isArray(rec.message.content) ? rec.message.content : [];
          const t = parts.filter((p: any) => p.type === "text").map((p: any) => p.text).join("");
          if (t) final = t;
          const u = rec.message.usage;
          if (u) onEvent({ type: "usage", input: u.input ?? 0, output: u.output ?? 0 });
          if (rec.message.stopReason === "error" && rec.message.errorMessage) onEvent({ type: "error", message: rec.message.errorMessage });
        } else if (rec.type === "tool_execution_start") {
          onEvent({ type: "tool", name: rec.toolName, args: rec.args });
        } else if (rec.type === "tool_execution_end") {
          onEvent({ type: "tool_end", name: rec.toolName, isError: !!rec.isError });
        } else if (rec.type === "agent_settled") {
          this.listeners.delete(l);
          resolve(final);
        }
      };
      this.listeners.add(l);
      const id = this.send({ type: "prompt", message: text });
    });
  }

  abort() {
    if (this.proc) this.send({ type: "abort" });
  }

  async stop() {
    if (!this.proc) return;
    try {
      this.send({ type: "abort" });
    } catch {}
    this.proc.kill();
    await this.proc.exited;
    this.proc = undefined;
  }
}

// ---------------- One-shot CLI harnesses (Codex, Copilot CLI, opencode) ----------------
// They sign in on the agent's own desktop (device login); tokens land in $HOME under /data.
export class CliHarness implements Harness {
  constructor(private ctx: HarnessContext, private kind: "codex" | "copilot" | "opencode") {}

  async start() {
    const home = `${this.ctx.dataDir}/home`;
    const [cmd, ...args] = this.ctx.mcpCommand;
    if (this.kind === "codex") {
      const toml = [
        "[mcp_servers.computer]",
        `command = ${JSON.stringify(cmd)}`,
        `args = ${JSON.stringify(args)}`,
        `env = { ${Object.entries(this.ctx.mcpEnv).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ")} }`,
      ].join("\n");
      await mkdir(`${home}/.codex`, { recursive: true });
      await Bun.write(`${home}/.codex/config.toml`, toml + "\n");
    } else if (this.kind === "copilot") {
      await writeJson(`${home}/.copilot/mcp-config.json`, {
        mcpServers: { computer: { type: "local", command: cmd, args, env: this.ctx.mcpEnv, tools: ["*"] } },
      });
    } else {
      await writeJson(`${home}/.config/opencode/opencode.json`, {
        $schema: "https://opencode.ai/config.json",
        mcp: { computer: { type: "local", command: this.ctx.mcpCommand, environment: this.ctx.mcpEnv, enabled: true } },
      });
    }
    await mkdir(`${this.ctx.dataDir}/workspace`, { recursive: true });
    await Bun.write(`${this.ctx.dataDir}/workspace/AGENTS.md`, this.ctx.systemPrompt);
  }

  async prompt(text: string, onEvent: (e: HarnessEvent) => void): Promise<string> {
    const argv =
      this.kind === "codex"
        ? ["codex", "exec", "--skip-git-repo-check", "--full-auto", text]
        : this.kind === "copilot"
          ? ["copilot", "-p", text, "--allow-all-tools"]
          : ["opencode", "run", text];
    const p = Bun.spawn(argv, { cwd: `${this.ctx.dataDir}/workspace`, env: harnessEnv(this.ctx), stdout: "pipe", stderr: "pipe" });
    const out = await new Response(p.stdout).text();
    const code = await p.exited;
    if (code !== 0) {
      const err = (await new Response(p.stderr).text()).slice(-500);
      onEvent({ type: "error", message: err });
      throw new Error(`${this.kind} exited ${code}: ${err}`);
    }
    onEvent({ type: "text", delta: out });
    return out.trim();
  }

  async stop() {}
}

// ---------------- Mock (tests, demos without a model) ----------------
export class MockHarness implements Harness {
  constructor(private ctx: HarnessContext, private computer: (action: Record<string, unknown>) => Promise<any>) {}
  async start() {
    await mkdir(`${this.ctx.dataDir}/workspace`, { recursive: true });
  }
  async prompt(text: string, onEvent: (e: HarnessEvent) => void) {
    const log = `${this.ctx.dataDir}/workspace/mock-log.txt`;
    const prev = (await Bun.file(log).exists()) ? await Bun.file(log).text() : "";
    await Bun.write(log, prev + text + "\n");
    const url = text.match(/https?:\/\/\S+/)?.[0];
    if (url) {
      onEvent({ type: "tool", name: "open_url", args: { url } });
      await this.computer({ kind: "open_url", url });
      await Bun.sleep(1500);
    }
    onEvent({ type: "tool", name: "screenshot", args: {} });
    const shot = await this.computer({ kind: "screenshot" });
    const n = prev.split("\n").filter(Boolean).length + 1;
    // "#loop" in a message makes the mock echo it whole (used to test the crew loop guard).
    const reply = `mock: message #${n} received ("${text.includes("#loop") ? text : text.slice(0, 60)}"), screenshot ${shot?.bytes ?? 0} bytes`;
    onEvent({ type: "text", delta: reply });
    onEvent({ type: "usage", input: text.length, output: reply.length });
    return reply;
  }
  async stop() {}
}

export function createHarness(ctx: HarnessContext, computer: (a: Record<string, unknown>) => Promise<any>): Harness {
  switch (ctx.spec.harness) {
    case "pi":
      return new PiHarness(ctx);
    case "codex":
    case "copilot":
    case "opencode":
      return new CliHarness(ctx, ctx.spec.harness);
    default:
      return new MockHarness(ctx, computer);
  }
}
