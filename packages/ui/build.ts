import tailwind from "bun-plugin-tailwind";
import { rm } from "node:fs/promises";

// Start clean: stale chunks would otherwise pile up and get embedded in the app and the agent image.
await rm("./dist", { recursive: true, force: true });

const r = await Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",
  minify: process.env.NOMIN ? false : true, sourcemap: process.env.NOMIN ? "inline" : "none",
  plugins: [tailwind],
  define: { "process.env.NODE_ENV": '"production"' },
});
if (!r.success) {
  for (const l of r.logs) console.error(l);
  process.exit(1);
}
console.log(`built ${r.outputs.length} files`);
