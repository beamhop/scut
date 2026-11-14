// scut — Beamhop desktop app + CLI.
//   scut                      open the app (local UI)
//   scut create <name> [--harness pi|codex|copilot|opencode|mock] [--to local] [--telegram TOKEN]
//                      [--model-api openai-completions --model-url URL --model-key KEY --model NAME]
//   scut ls
//   scut beam <agent> --to <destination>
//   scut rm <agent>
//   scut export <agent> [--out FILE]   move an agent into a passphrase-locked file (asks for the passphrase,
//   scut import <FILE> [--to local]    or reads SCUT_PASSPHRASE)
import { HOME, Scut } from "./core.ts";
import { serve } from "./server.ts";
import { CrewRoom } from "./crew.ts";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

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
    out: { type: "string" },
  },
});

/** Open the UI as an app window: Chrome/Edge/Chromium in --app mode if present, else the default browser. */
function openWindow(url: string) {
  const candidates =
    process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
      : process.platform === "win32"
        ? [`${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`, `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  for (const c of candidates) {
    try {
      if (require("node:fs").existsSync(c)) {
        Bun.spawn([c, `--app=${url}`, "--window-size=1440,900", `--user-data-dir=${HOME}/window`], { stdout: "ignore", stderr: "ignore" });
        return;
      }
    } catch {}
  }
  const opener = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try {
    Bun.spawn(opener, { stdout: "ignore", stderr: "ignore" });
  } catch {}
}

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
  case "export": {
    const pass = process.env.SCUT_PASSPHRASE ?? prompt("Passphrase (8+ characters):") ?? "";
    const { file, filename } = await scut.exportAgent(rest[0], pass);
    const out = values.out ?? filename;
    await Bun.write(out, file);
    console.log(`${rest[0]} is now in ${out} (${file.length > 1e6 ? `${(file.length / 1e6).toFixed(1)} MB` : `${Math.ceil(file.length / 1e3)} KB`}). Open it with: scut import ${out}`);
    break;
  }
  case "import": {
    const pass = process.env.SCUT_PASSPHRASE ?? prompt("Passphrase:") ?? "";
    const rec = await scut.importAgent(new Uint8Array(await Bun.file(rest[0]).arrayBuffer()), pass, values.to ?? "local");
    console.log(`${rec.name} (${rec.id}) is here, on ${rec.current.driver} at ${rec.current.endpoint}`);
    break;
  }
  case "rm":
    await scut.remove(rest[0]);
    console.log("removed");
    break;
  case undefined:
  case "app": {
    const port = Number(values.port ?? 7777);
    const ui = values.ui ?? process.env.SCUT_UI_DIR ?? fileURLToPath(new URL("../../../packages/ui/dist", import.meta.url));
    const crew = process.env.SCUT_NO_CREW ? undefined : new CrewRoom(scut);
    await crew?.start();
    const srv = serve(scut, port, ui, crew);
    scut.startPrefetch();
    const url = `http://127.0.0.1:${srv.port}`;
    console.log(`Beamhop running at ${url}`);
    if (!process.env.SCUT_NO_WINDOW && cmd === undefined) openWindow(url);
    break;
  }
  default:
    console.error(`unknown command ${cmd}`);
    process.exit(1);
}
