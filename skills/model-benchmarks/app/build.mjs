// Build the Svelte guide into static assets for the skill dir.
// Usage: npm run build   (run from this dir; no network needed, deps vendored)
// Output: <skill>/{model-selection-guide.html,assets/}
// Data (data.js) is generated separately by scripts/guide_data.mjs and is
// never touched here — a data refresh needs no rebuild.
import { compile } from "svelte/compiler";
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(here, "src");
const OUT = path.dirname(here);

const sveltePlugin = {
  name: "svelte",
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async (args) => {
      const source = await fs.promises.readFile(args.path, "utf8");
      const out = compile(source, { filename: args.path, generate: "client", dev: false });
      for (const w of out.warnings || []) console.warn("svelte warning %s: %s", args.path, w.message);
      return { contents: out.js.code, loader: "js" };
    });
  },
};

fs.mkdirSync(path.join(OUT, "assets"), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(SRC, "main.js")],
  bundle: true,
  minify: true,
  format: "iife",
  outfile: path.join(OUT, "assets/app.js"),
  plugins: [sveltePlugin],
  logLevel: "warning",
});

fs.copyFileSync(path.join(SRC, "app.css"), path.join(OUT, "assets/app.css"));
fs.copyFileSync(path.join(SRC, "shells/guide.html"), path.join(OUT, "model-selection-guide.html"));

const kb = fs.statSync(path.join(OUT, "assets/app.js")).size / 1024;
console.log(`built ${OUT} (app.js ${kb.toFixed(1)} KB)`);
