#!/usr/bin/env node
// aa_model_info.mjs — pull model pricing + top-20 leaderboard from artificialanalysis.ai
// Usage:
//   node aa_model_info.mjs top20 [--out FILE]
//   node aa_model_info.mjs models <slug>... [--from top20.json] [--out FILE]
// Requires playwright-core: run from a dir that has it, or set PW_CORE=/path/index.mjs

import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

function loadPw() {
  const candidates = [
    process.env.PW_CORE,
    path.join(os.homedir(), 'PycharmProjects/monartha/node_modules/playwright-core/index.mjs'),
  ].filter(Boolean);
  for (const c of candidates) {
    try { fs.accessSync(c); return import(pathToFile(c)); } catch { /* next */ }
  }
  return import('playwright-core');
}
function pathToFile(p) {
  return 'file://' + p.replace(/^\/+/, m => '/' + m);
}

function parseArgs(argv) {
  const out = { cmd: argv[0], slugs: [], from: null, out: null };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--from') out.from = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else out.slugs.push(argv[i]);
  }
  return out;
}

// --- parsing ---------------------------------------------------------------

const CTX_RE = /^[\d.]+[kKmM]?$/;

function parseLeaderboard(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const rows = [];
  for (let i = 3; i < lines.length; i++) {
    // pattern: [name, ctx, creator, idx, $cost, speed, lat, total]
    const idx = lines[i];
    if (!/^\d+\*?$/.test(idx)) continue;
    const cost = lines[i + 1] || '';
    if (!/^\$[\d.]+$/.test(cost)) continue;
    const creator = lines[i - 1] || '';
    const ctx = lines[i - 2] || '';
    const name = lines[i - 3] || '';
    if (!name || CTX_RE.test(name) || /^\$/.test(name) || /^\d+\*?$/.test(name)) continue;
    if (!CTX_RE.test(ctx) || !creator || CTX_RE.test(creator)) continue;
    const speed = lines[i + 2];
    if (!speed || !/^\d+$/.test(speed)) continue; // speed must follow
    rows.push({
      name, context: ctx, creator,
      aa_index: parseInt(idx.replace('*', ''), 10),
      cost_per_task: parseFloat(cost.slice(1)),
      provisional: idx.endsWith('*'),
    });
  }
  // dedupe by (name, cost)
  const seen = new Set();
  return rows.filter(r => {
    const k = r.name + '|' + r.cost_per_task;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function parseModelPage(text, slug) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const m = {};
  for (const l of lines) {
    const pd = l.match(/^Cache Discount (\d+)%$/);
    if (pd && m.cache_discount_pct === undefined) {
      m.cache_discount_pct = parseInt(pd[1], 10);
      continue;
    }
    const ps = l.match(/At (\d+) tokens per second/);
    if (ps && m.speed_tps === undefined) {
      m.speed_tps = parseInt(ps[1], 10);
      continue;
    }
    if (m.input !== undefined) continue;
    const pm = l.match(/^Pricing for (.+?) is \$([\d.]+) per 1M input tokens.*?\$([\d.]+) per 1M output tokens/);
    if (pm) {
      m.display_name = pm[1];
      m.input = parseFloat(pm[2]);
      m.output = parseFloat(pm[3]);
      const pc = l.match(/cost \$([\d.]+) to evaluate/);
      if (pc) m.cost_per_task = parseFloat(pc[1]);
    }
  }
  if (m.input === undefined) return null;
  if (m.cache_discount_pct !== undefined) {
    m.cache_read = Math.round(m.input * (1 - m.cache_discount_pct / 100) * 100) / 100;
  }
  return { slug, ...m, cache_write: null };
}

// --- main ------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const { chromium } = await loadPw();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

async function goto(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);
  return page.evaluate(() => document.body.innerText);
}

let result = null;
try {
  if (args.cmd === 'top20') {
    const text = await goto('https://artificialanalysis.ai/leaderboards/models');
    const rows = parseLeaderboard(text).slice(0, 20);
    result = { scraped_at: new Date().toISOString().slice(0, 10), source: 'artificialanalysis.ai/leaderboards/models', top20: rows };
    console.error(`parsed ${rows.length} rows; #1 ${rows[0] ? rows[0].name : '—'}`);
  } else if (args.cmd === 'models') {
    let top20 = null;
    if (args.from) top20 = JSON.parse(fs.readFileSync(args.from, 'utf8')).top20;
    const models = [];
    for (const slug of args.slugs) {
      try {
        const text = await goto(`https://artificialanalysis.ai/models/${slug}`);
        const m = parseModelPage(text, slug);
        if (m) {
          const row = top20 ? top20.find(r => r.name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(slug.replace(/-/g, '').slice(0, 10))) : null;
          if (row) { m.aa_index = row.aa_index; if (m.cost_per_task === undefined) m.cost_per_task = row.cost_per_task; }
          models.push(m);
          console.error(`ok ${slug}: $${m.input}/$${m.output} cache $${m.cache_read} (${m.cache_discount_pct}%)`);
        } else {
          console.error(`NO PRICING on page for ${slug}`);
        }
      } catch (e) {
        console.error(`ERROR ${slug}: ${e.message.split('\n')[0]}`);
      }
    }
    result = { scraped_at: new Date().toISOString().slice(0, 10), source: 'artificialanalysis.ai/models', models };
  } else {
    console.error('unknown command; use top20 or models');
    process.exit(2);
  }
} finally {
  await browser.close();
}

const body = JSON.stringify(result, null, 2);
if (args.out) { fs.writeFileSync(args.out, body); console.error(`wrote ${args.out}`); }
else console.log(body);
