#!/usr/bin/env node
// aa_version.mjs — fetch the Coding Agent Index version string from the AA
// coding-agents page (one page load, no tab clicks) and compare it against
// the pinned version in snapshots/aa-index-version.txt.
// Usage: node aa_version.mjs [--expect vX.Y] [--out FILE] [--selftest]
// Exit 0 = match (or no --expect given, prints version); 2 = version drift;
// 1 = scrape error. Requires playwright-core (same resolution as or_catalog.mjs).

import fs from 'fs';
import os from 'os';
import path from 'path';

function pathToFile(p) {
  return 'file://' + p.replace(/^\/+/, m => '/' + m);
}

async function loadPw() {
  if (process.env.PW_CORE) {
    try { fs.accessSync(process.env.PW_CORE); return import(pathToFile(process.env.PW_CORE)); } catch { throw new Error('PW_CORE unreadable: ' + process.env.PW_CORE); }
  }
  try { return await import('playwright-core'); } catch { /* fallback below */ }
  const legacy = path.join(os.homedir(), 'PycharmProjects/monartha/node_modules/playwright-core/index.mjs');
  try { fs.accessSync(legacy); return import(pathToFile(legacy)); } catch { /* next */ }
  throw new Error('playwright-core not found: run from a directory that has it, or set PW_CORE');
}

function extractVersion(bodyText) {
  const m = bodyText.match(/Coding Agent Index\s+(v[\d.]+)/);
  return m ? m[1] : null;
}

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true);
}

if (flag('--selftest')) {
  const cases = [
    ['Artificial Analysis Coding Agent Index v1.5 · Higher is better', 'v1.5'],
    ['index v2.0\nCoding Agent Index v10.25 blah', 'v10.25'],
    ['no version here', null],
  ];
  let fail = 0;
  for (const [text, want] of cases) {
    const got = extractVersion(text);
    if (got === want) console.log('ok   aa_version parses ' + JSON.stringify(want));
    else { fail++; console.log(`FAIL aa_version: want ${want}, got ${got}`); }
  }
  if (fail) { console.error(fail + ' FAILURE(S)'); process.exitCode = 1; }
  else console.log('ALL AA_VERSION TESTS PASSED');
  process.exit(process.exitCode || 0);
}

const expect = flag('--expect');
const out = flag('--out');
let chromium;
try { ({ chromium } = await loadPw()); }
catch (e) { console.error('error: ' + e.message); process.exit(1); }
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto('https://artificialanalysis.ai/agents/coding-agents', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  const text = await page.evaluate(() => document.body.innerText);
  const ver = extractVersion(text);
  if (!ver) { console.error('error: no Coding Agent Index version found on page (AA redesign?)'); process.exit(1); }
  console.error('aa index version: ' + ver);
  if (out) fs.writeFileSync(out, ver + '\n');
  else console.log(ver);
  if (expect && expect !== true && expect !== ver) {
    console.error(`VERSION DRIFT: expected ${expect}, live page shows ${ver} — re-pull coding snapshot + update guide/SKILL`);
    process.exit(2);
  }
} finally {
  await browser.close();
}
