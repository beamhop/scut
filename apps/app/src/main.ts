#!/usr/bin/env bun
// scut — Beamhop desktop app + CLI.
//   scut                      open the app (local UI)
//   scut create <name> [--harness pi|codex|copilot|opencode|mock] [--to local] [--telegram TOKEN]
//                      [--model-api openai-completions --model-url URL --model-key KEY --model NAME]
//   scut ls
//   scut beam <agent> --to <destination>
//   scut rm <agent>
import { Scut } from "./core.ts";
import { serve } from "./server.ts";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    harness: { type: "string" },
    to: { type: "string" },
    telegram: { type: "string" },
    template: { type: "string" },
    autonomy: { type: "string" },
    "model-api": { type: "string" },
    "model-url": { type: "string" },
    "model-key": { type: "string" },
    model: { type: "string" },
    port: { type: "string" },
    ui: { type: "string" },
    "destroy-source": { type: "boolean" },
  },
});

const scut = await Scut.open();
const [cmd, ...rest] = positionals;

switch (cmd) {
  case "create": {
    const rec = await scut.create({
      name: rest.join(" ") || "Agent",
      harness: values.harness as any,
      template: values.template as any,
      autonomy: values.autonomy as any,
      driver: values.to,
      telegramToken: values.telegram,
      model: values.model
        ? { provider: "scut", api: (values["model-api"] as any) ?? "openai-completions", baseUrl: values["model-url"], apiKey: values["model-key"], model: values.model }
        : undefined,
    });
    console.log(`created ${rec.name} (${rec.id}) on ${rec.current.driver} at ${rec.current.endpoint}`);
    break;
  }
  case "ls":
    for (const a of scut.agents) console.log(`${a.id}\t${a.current.driver}\t${a.current.endpoint}\t${a.beam?.stage ?? ""}`);
    break;
  case "beam": {
    const t0 = Date.now();
    const rec = await scut.beam(rest[0], values.to ?? "local", {
      destroySource: values["destroy-source"],
      onStage: (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`),
    });
    console.log(`${rec.name} is now on ${rec.current.driver} at ${rec.current.endpoint}`);
    break;
  }
  case "rm":
    await scut.remove(rest[0]);
    console.log("removed");
    break;
  case undefined:
  case "app": {
    const port = Number(values.port ?? 7777);
    const ui = values.ui ?? process.env.SCUT_UI_DIR ?? new URL("../../../packages/ui/dist", import.meta.url).pathname;
    serve(scut, port, ui);
    console.log(`Beamhop running at http://127.0.0.1:${port}`);
    break;
  }
  default:
    console.error(`unknown command ${cmd}`);
    process.exit(1);
}
