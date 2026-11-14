import tailwind from "bun-plugin-tailwind";
import { rm, mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Start clean: stale chunks would otherwise pile up and get embedded in the app and the agent image.
await rm("./dist", { recursive: true, force: true });

const r = await Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",
  minify: process.env.NOMIN ? false : true, sourcemap: process.env.NOMIN ? "inline" : "none",
  plugins: [tailwind],
  define: { "process.env.NODE_ENV": '"production"' },
  // Fonts are copied below and referenced as /fonts/… from styles.css. Bun would otherwise inline them as base64
  // data URLs into the CSS (render-blocking, +33 %, and every subset downloaded even when unused).
  external: ["/fonts/*"],
});
if (!r.success) {
  for (const l of r.logs) console.error(l);
  process.exit(1);
}

// Self-hosted fonts (OFL). Latin + latin-ext subsets only; unicode-range keeps latin-ext from loading unless needed.
const pkg = (name: string) => dirname(Bun.resolveSync(`${name}/package.json`, import.meta.dir));
const mona = pkg("@fontsource-variable/mona-sans");
const commit = pkg("@fontsource/commit-mono");
const fonts: [string, string][] = [
  [join(mona, "files/mona-sans-latin-wdth-normal.woff2"), "mona-sans-latin-wdth-normal.woff2"],
  [join(mona, "files/mona-sans-latin-ext-wdth-normal.woff2"), "mona-sans-latin-ext-wdth-normal.woff2"],
  [join(mona, "LICENSE"), "MonaSans-OFL.txt"],
  [join(commit, "files/commit-mono-latin-400-normal.woff2"), "commit-mono-latin-400-normal.woff2"],
  [join(commit, "LICENSE"), "CommitMono-OFL.txt"],
  ["./src/fonts/DepartureMono-Regular.woff2", "DepartureMono-Regular.woff2"],
  ["./src/fonts/DepartureMono-OFL.txt", "DepartureMono-OFL.txt"],
];
await mkdir("./dist/fonts", { recursive: true });
for (const [from, to] of fonts) await copyFile(from, `./dist/fonts/${to}`);

// Preload the UI face so the first paint is already in Mona Sans.
const html = await readFile("./dist/index.html", "utf8");
await writeFile("./dist/index.html", html.replace("</head>",
  `<link rel="preload" href="/fonts/mona-sans-latin-wdth-normal.woff2" as="font" type="font/woff2" crossorigin></head>`));

console.log(`built ${r.outputs.length} files + ${fonts.length} font files`);
