// Render smoke test: SSR-renders the Svelte templates against the real
// generated data (data.js + first sessions/*.js) and asserts key content.
// Usage: npm run check   (run from this dir; needs OUT dir data present)
import { compile } from "svelte/compiler";
import * as esbuild from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(here, "src");
const OUT = path.join(os.homedir(), ".opencode/usage-dashboard");
const TMP = path.join(here, ".check-tmp");
fs.mkdirSync(TMP, { recursive: true });

const svelteSSR = {
  name: "svelte-ssr",
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async (args) => {
      const source = await fs.promises.readFile(args.path, "utf8");
      const out = compile(source, {
        filename: args.path,
        generate: "server",
        dev: false,
      });
      return { contents: out.js.code, loader: "js" };
    });
  },
};

function loadPayload(file, prefix) {
  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw.startsWith(prefix)) throw new Error("bad prefix in " + file);
  return raw.slice(prefix.length).replace(/;\s*$/, "");
}

const dataJS = loadPayload(path.join(OUT, "data.js"), "window.__OCUD__ = ");
const sessFiles = fs.readdirSync(path.join(OUT, "sessions")).filter((f) => f.endsWith(".js")).sort();
if (!sessFiles.length) throw new Error("no session files in " + OUT);
const sessJS = loadPayload(path.join(OUT, "sessions", sessFiles[0]), "window.__OCUD_SESSION__ = ");

const entryIndex = path.join(TMP, "entry-index.js");
const entrySession = path.join(TMP, "entry-session.js");
fs.writeFileSync(
  entryIndex,
  `import { render } from "svelte/server";\nimport App from ${JSON.stringify(path.join(SRC, "App.svelte"))};\n` +
    `globalThis.__OCUD_PAGE__ = "index";\nglobalThis.__OCUD__ = ${dataJS};\n` +
    `export const body = render(App).body;\n`
);
const sessId = sessFiles[0].replace(/\.js$/, "");
fs.writeFileSync(
  entrySession,
  `import { render } from "svelte/server";\nimport App from ${JSON.stringify(path.join(SRC, "App.svelte"))};\n` +
    `globalThis.__OCUD_PAGE__ = "session";\nglobalThis.__OCUD_SESSION_ID__ = ${JSON.stringify(sessId)};\n` +
    `globalThis.__OCUD_SESSION__ = ${sessJS};\n` +
    `export const body = render(App).body;\n`
);

let failures = 0;
let bundleN = 0;
async function check(entry, wants, label) {
  const outFile = `${entry}.${bundleN++}.bundle.mjs`;
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: outFile,
    plugins: [svelteSSR],
    logLevel: "silent",
  });
  const mod = await import(pathToFileURL(outFile).href);
  const body = mod.body;
  console.log(`${label}: rendered ${body.length} chars`);
  for (const w of wants) {
    if (!body.includes(w)) {
      console.error(`  MISSING: ${w.slice(0, 80)}`);
      failures++;
    }
  }
}

const data = JSON.parse(dataJS);

await check(entryIndex, [
  "Usage — Opus 5 equivalent",
  `$${data.hero.opus5.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  `session.html#${data.sessions[0].id8}`,
  "Tool use by category",
  "Commit-landing ratio",
  "Methodology",
], "index");

// deep assertions on the first session file…
const sess = JSON.parse(sessJS);

await check(entrySession, [
  sess.title.split(" ")[0],
  "Tool time by category",
  "Turn timeline",
  "Action",
  "Outcome",
  "Effectiveness",
  "Improve — user side",
], "session");

// …plus a shape sweep over every session file (catches per-session variance:
// no tool calls, no prompts, null finishes). The bar or the empty note must
// render, and the timeline must always be present.
for (const f of sessFiles) {
  const raw = loadPayload(path.join(OUT, "sessions", f), "window.__OCUD_SESSION__ = ");
  const entry = path.join(TMP, "entry-one.js");
  fs.writeFileSync(
    entry,
    `import { render } from "svelte/server";\nimport App from ${JSON.stringify(path.join(SRC, "App.svelte"))};\n` +
      `globalThis.__OCUD_PAGE__ = "session";\nglobalThis.__OCUD_SESSION_ID__ = ${JSON.stringify(f.replace(/\.js$/, ""))};\n` +
      `globalThis.__OCUD_SESSION__ = ${raw};\n` +
      `export const body = render(App).body;\n`
  );
  const s = JSON.parse(raw);
  const wants = ["Turn timeline", (s.title || s.id8).split(" ")[0]];
  wants.push(s.tool_ms > 0 ? 'class="tbar"' : "No tool calls in this session");
  await check(entry, wants, "session " + s.id8);
}

fs.rmSync(TMP, { recursive: true, force: true });
if (failures) {
  console.error(`check FAILED (${failures} missing strings)`);
  process.exit(1);
}
console.log("check OK");
