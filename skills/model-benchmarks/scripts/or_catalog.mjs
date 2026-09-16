#!/usr/bin/env node
// or_catalog.mjs — dump the OpenRouter model catalog (pricing, context,
// tool support) to compact JSON. No API key needed (public endpoint).
// Usage: node or_catalog.mjs [--out FILE]
// Requires playwright-core: run from a dir that has it, or set
// PW_CORE=/path/to/playwright-core/index.mjs. No --out prints to stdout.

import fs from 'fs';
import os from 'os';
import path from 'path';

function pathToFile(p) {
  return 'file://' + p.replace(/^\/+/, m => '/' + m);
}

async function loadPw() {
  if (process.env.PW_CORE) {
    try { fs.accessSync(process.env.PW_CORE); return import(pathToFile(process.env.PW_CORE)); }
    catch (e) { throw new Error(`PW_CORE=${process.env.PW_CORE} unreadable: ${e.message}`); }
  }
  try { return await import('playwright-core'); }
  catch { /* not resolvable from here — try machine fallback below */ }
  const legacy = path.join(os.homedir(), 'PycharmProjects/monartha/node_modules/playwright-core/index.mjs');
  try { fs.accessSync(legacy); return import(pathToFile(legacy)); } catch { /* next */ }
  throw new Error('playwright-core not found: run from a directory that has it, or set PW_CORE=/path/to/playwright-core/index.mjs');
}

const args = process.argv.slice(2);
let out = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') {
    if (i + 1 >= args.length) { console.error('usage: node or_catalog.mjs [--out FILE]'); process.exit(2); }
    out = args[++i];
  } else { console.error(`unknown arg '${args[i]}'\nusage: node or_catalog.mjs [--out FILE]`); process.exit(2); }
}

let chromium;
try {
  ({ chromium } = await loadPw());
} catch (e) {
  console.error('error: ' + e.message);
  process.exit(1);
}
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let models;
try {
  await page.goto('https://openrouter.ai/models', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  models = await page.evaluate(async () => {
    const r = await fetch('https://openrouter.ai/api/v1/models');
    if (!r.ok) throw new Error('models API HTTP ' + r.status);
    const j = await r.json();
    return j.data.map(m => ({
      id: m.id,
      in: Math.round(parseFloat(m.pricing.prompt) * 1e6 * 1000) / 1000,
      out: Math.round(parseFloat(m.pricing.completion) * 1e6 * 1000) / 1000,
      ctx: m.context_length,
      tools: ((m.supported_parameters || []).includes('tools')) ? 1 : 0,
      mod: m.architecture ? m.architecture.modality : null,
    }));
  });
} finally {
  await browser.close();
}
models.sort((a, b) => a.in - b.in || a.out - b.out);
const result = {
  scraped_at: new Date().toISOString().slice(0, 10),
  source: 'openrouter.ai/api/v1/models',
  count: models.length,
  // $/1M tokens; in/out may be 0 (free routes)
  models,
};
const body = JSON.stringify(result, null, 1);
if (out) { fs.writeFileSync(out, body); console.error(`wrote ${out} (${models.length} models)`); }
else console.log(body);
