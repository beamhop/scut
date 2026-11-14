// Marketing site for GitHub Pages (served from /scut/, so every URL in the output must be relative).
import tailwind from "bun-plugin-tailwind";
import { rm, mkdir, copyFile, readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

await rm("./dist", { recursive: true, force: true });

const r = await Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",
  minify: true,
  publicPath: "./",
  plugins: [tailwind],
  define: { "process.env.NODE_ENV": '"production"' },
  external: ["/fonts/*"],
});
if (!r.success) {
  for (const l of r.logs) console.error(l);
  process.exit(1);
}

// Same self-hosted fonts as the app (packages/ui/build.ts).
const pkg = (name: string) => dirname(Bun.resolveSync(`${name}/package.json`, import.meta.dir));
const mona = pkg("@fontsource-variable/mona-sans");
const commit = pkg("@fontsource/commit-mono");
const ui = join(import.meta.dir, "../../packages/ui/src/fonts");
const fonts: [string, string][] = [
  [join(mona, "files/mona-sans-latin-wdth-normal.woff2"), "mona-sans-latin-wdth-normal.woff2"],
  [join(mona, "files/mona-sans-latin-ext-wdth-normal.woff2"), "mona-sans-latin-ext-wdth-normal.woff2"],
  [join(commit, "files/commit-mono-latin-400-normal.woff2"), "commit-mono-latin-400-normal.woff2"],
  [join(ui, "DepartureMono-Regular.woff2"), "DepartureMono-Regular.woff2"],
];
await mkdir("./dist/fonts", { recursive: true });
for (const [from, to] of fonts) await copyFile(from, `./dist/fonts/${to}`);

// The design system's CSS points at /fonts/…; on Pages the site lives under /scut/, so make those relative.
for (const f of await readdir("./dist")) {
  if (!f.endsWith(".css")) continue;
  const p = join("./dist", f);
  await writeFile(p, (await readFile(p, "utf8")).replaceAll("/fonts/", "./fonts/"));
}
const html = await readFile("./dist/index.html", "utf8");
await writeFile("./dist/index.html", html.replace("</head>",
  `<link rel="preload" href="./fonts/mona-sans-latin-wdth-normal.woff2" as="font" type="font/woff2" crossorigin></head>`));
await writeFile("./dist/.nojekyll", "");

console.log(`built ${r.outputs.length} files + ${fonts.length} fonts`);
