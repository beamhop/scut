import tailwind from "bun-plugin-tailwind";

const r = await Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",
  minify: true,
  plugins: [tailwind],
  define: { "process.env.NODE_ENV": '"production"' },
});
if (!r.success) {
  for (const l of r.logs) console.error(l);
  process.exit(1);
}
console.log(`built ${r.outputs.length} files`);
