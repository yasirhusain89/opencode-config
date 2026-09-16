// Build the Svelte templates into static assets for the dashboard dir.
// Usage: npm run build   (run from this dir; no network needed, deps vendored)
// Output: <home>/.opencode/usage-dashboard/{dashboard.html,session.html,assets/,sessions/}
// The daily generator only rewrites data.js + sessions/*.js — never these.
import { compile } from "svelte/compiler";
import * as esbuild from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(here, "src");
const OUT = path.join(os.homedir(), ".opencode/usage-dashboard");

const sveltePlugin = {
  name: "svelte",
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async (args) => {
      const source = await fs.promises.readFile(args.path, "utf8");
      const out = compile(source, {
        filename: args.path,
        generate: "client",
        dev: false,
      });
      for (const w of out.warnings || []) {
        console.warn("svelte warning %s: %s", args.path, w.message);
      }
      return { contents: out.js.code, loader: "js" };
    });
  },
};

fs.mkdirSync(path.join(OUT, "assets"), { recursive: true });
fs.mkdirSync(path.join(OUT, "sessions"), { recursive: true });

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
fs.copyFileSync(
  path.join(SRC, "shells/dashboard.html"), path.join(OUT, "dashboard.html"));
fs.copyFileSync(
  path.join(SRC, "shells/session.html"), path.join(OUT, "session.html"));

const kb = fs.statSync(path.join(OUT, "assets/app.js")).size / 1024;
console.log("built " + OUT + " (app.js " + kb.toFixed(1) + " KB)");
