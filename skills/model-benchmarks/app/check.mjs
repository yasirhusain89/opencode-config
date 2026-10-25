// Render smoke test: SSR-renders the guide against the real generated data.js
// and asserts section/table/row counts plus key content.
// Usage: npm run check   (run from this dir; data.js must exist)
import { compile } from "svelte/compiler";
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(here, "src");
const OUT = path.dirname(here);
const TMP = path.join(here, ".check-tmp");
fs.mkdirSync(TMP, { recursive: true });

const svelteSSR = {
  name: "svelte-ssr",
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async (args) => {
      const source = await fs.promises.readFile(args.path, "utf8");
      const out = compile(source, { filename: args.path, generate: "server", dev: false });
      return { contents: out.js.code, loader: "js" };
    });
  },
};

const raw = fs.readFileSync(path.join(OUT, "data.js"), "utf8").trim();
if (!raw.startsWith("window.__MB__ = ")) throw new Error("bad data.js prefix");
const dataJS = raw.slice("window.__MB__ = ".length).replace(/;\s*$/, "");

const entry = path.join(TMP, "entry-guide.js");
fs.writeFileSync(
  entry,
  `import { render } from "svelte/server";\n` +
    `import Guide from ${JSON.stringify(path.join(SRC, "Guide.svelte"))};\n` +
    `globalThis.__MB__ = ${dataJS};\n` +
    `export const body = render(Guide, { props: { data: globalThis.__MB__ } }).body;\n`
);

const outFile = path.join(TMP, "guide.bundle.mjs");
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: outFile,
  plugins: [svelteSSR],
  logLevel: "silent",
});

const { body } = await import(pathToFileURL(outFile).href);
const count = (re) => (body.match(re) || []).length;
const fail = [];
const check = (cond, msg) => { if (!cond) fail.push(msg); };
check(count(/<h2 id="/g) === 17, "expected 17 sections, got " + count(/<h2 id="/g));
check(count(/<table/g) === 23, "expected 23 tables, got " + count(/<table/g));
check(count(/<tr>/g) >= 280, "expected >=280 rows, got " + count(/<tr>/g));
check(!body.includes("undefined"), "rendered output contains undefined");
check(count(/tabindex="0"/g) > 80, "sortable/tip headers are focusable");
check(body.includes('aria-sort="none"'), "unsorted sortable headers expose aria-sort=none");
check(body.includes('data-tipfirst="1"') && body.includes('data-tiplast="1"'), "tooltip clamp markers rendered");
check(body.includes('aria-label="Filter table rows"'), "filter input has a label");
check(body.includes("aria-pressed="), "theme toggle exposes pressed state");
for (const id of ["dashboard", "master", "go", "goworkload", "usage", "recs", "harness"]) {
  check(body.includes('id="' + id + '"'), "missing section " + id);
}
console.log("rendered " + body.length + " chars; " + count(/<table/g) + " tables, " + count(/<tr>/g) + " rows");
if (fail.length) {
  for (const f of fail) console.error("  FAIL: " + f);
  process.exit(1);
}
console.log("check OK");
