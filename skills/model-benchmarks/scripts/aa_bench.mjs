#!/usr/bin/env node
// aa_bench.mjs — benchmark cross-check for opencode agent model choices.
// Pulls Artificial Analysis data in ONE browser session:
//   1. homepage Highlights (Intelligence Index, Speed, Cost per Task — global top)
//   2. Engineering capability index table (top ~26 as observed 2026-09-16,
//      via model-page tab; models below cutoff are off-chart)
//   3. per-slug model pages (token pricing, speed, eval cost)
//   4. agent model definitions (agent/*.md + opencode.jsonc) mapped to AA slugs
// Usage:
//   node aa_bench.mjs check <slug>... [--out FILE] [--config DIR]
//     DIR defaults to ~/.config/opencode (reads agent(s)/*.md, opencode.json(c))
//   node aa_bench.mjs coding [--out FILE]
//   node aa_bench.mjs inventory [provider...] [--out FILE]
// Requires playwright-core for check/coding: run from a dir that has it,
// or set PW_CORE=/path/to/playwright-core/index.mjs.
// inventory shells out to the opencode binary: $OPENCODE_BIN, `which opencode`,
// then ~/.opencode/bin/opencode. No --out prints JSON to stdout.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

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

function defaultBin() {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
  try {
    const found = execFileSync('which', ['opencode'], { encoding: 'utf8', timeout: 10000 }).trim();
    if (found) return found;
  } catch { /* not on PATH — try machine fallback below */ }
  return '/Users/yasihusain/.opencode/bin/opencode'; // last-resort machine default
}

function parseArgs(argv) {
  const out = { cmd: argv[0], slugs: [], out: null, config: path.join(os.homedir(), '.config/opencode'), configSet: false, errors: [] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' || a === '--config') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) { out.errors.push(`${a} needs a value`); continue; }
      if (a === '--out') out.out = v; else { out.config = v; out.configSet = true; }
      i++;
    } else if (a.startsWith('--')) {
      out.errors.push(`unknown flag '${a}'`);
    } else {
      out.slugs.push(a);
    }
  }
  return out;
}

// --- coding-agent index ------------------------------------------------------
// Harnesses (chart legend always starts a new entry on one of these).
const HARNESSES = ['Claude Code', 'Codex', 'Devin Fusion', 'SWE-2', 'Muse Code', 'Opencode', 'Kimi Code CLI', 'Grok Build', 'Antigravity SDK'];

function parseAgentChart(text, chartTitle) {
  const L = linesOf(text);
  const h = L.findIndex(l => l === chartTitle);
  if (h === -1) return null;
  // legend: lines until the first pure number / percent / $ / time value
  let i = h + 1;
  while (i < L.length && L[i] !== 'Color by') i++;
  while (i < L.length && L[i] !== '14 of 15 models' && L[i] !== '15 of 15 models') i++;
  i++;
  const legend = [];
  const isVal = l => /^(\d+%?|\$[\d.]+|[\d.]+[mh])$/.test(l);
  while (i < L.length && legend.length < 80) {
    const l = L[i];
    if (!l) { i++; continue; }
    if (isVal(l)) break;
    if (!/^(Color by|Model|Agent|Most attractive|Pareto line|What This)/.test(l)) legend.push(l);
    i++;
  }
  const vals = [];
  while (i < L.length && /^(\d+[%]?|\$[\d.]+|[\d.]+[mh])$/.test(L[i])) { vals.push(L[i]); i++; }
  // chunk legend lines into entries on harness boundaries; a trailing
  // "SWE-2 (medium)" belongs to the Devin row above, not its own entry
  const entries = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    const joined = cur.join(' ');
    if (/^SWE-2/.test(joined) && entries.length) entries[entries.length - 1] += ' ' + joined;
    else entries.push(joined);
    cur = [];
  };
  for (const l of legend) {
    if (HARNESSES.includes(l) && cur.length) flush();
    cur.push(l);
  }
  flush();
  if (entries.length !== vals.length) {
    console.error(`WARN ${chartTitle}: ${entries.length} legend entries vs ${vals.length} values — rows may misalign (new harness or AA UI change?)`);
  }
  const n = Math.min(entries.length, vals.length);
  return entries.slice(0, n).map((entry, k) => ({ entry, value: vals[k] }));
}

async function runInventory(providers, bin) {
  const result = { scraped_at: new Date().toISOString().slice(0, 10), bin, providers: {} };
  for (const p of providers) {
    try {
      const out = execFileSync(bin, ['models', p], { encoding: 'utf8', timeout: 120000 });
      result.providers[p] = out.split('\n').map(l => l.trim()).filter(Boolean);
      console.error(`${p}: ${result.providers[p].length} models`);
    } catch (e) { result.providers[p] = { error: String(e.message).split('\n')[0] }; console.error(`${p} FAILED`); }
  }
  return result;
}

async function runCoding(page) {
  await page.goto('https://artificialanalysis.ai/agents/coding-agents', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  for (let i = 0; i < 8; i++) { await page.evaluate(() => window.scrollBy(0, 2500)); await page.waitForTimeout(500); }
  const result = { source: 'artificialanalysis.ai/agents/coding-agents', scraped_at: new Date().toISOString().slice(0, 10), errors: [] };
  const base = await page.evaluate(() => document.body.innerText);
  const L = linesOf(base);
  const num = /^\d+$/;
  const money = /^\$[\d.]+$/;
  const time = /^[\d.]+[mh]$/;
  result.index = Object.fromEntries((parseNameValueSection(L, 'Artificial Analysis Coding Agent Index v1.5 · Higher is better', num) || []).map(r => [r.name, parseInt(r.value, 10)]));
  result.time_per_task = Object.fromEntries((parseNameValueSection(L, 'Average agent wall time per task · Lower is better', time) || []).map(r => [r.name, r.value]));
  result.cost_per_task = Object.fromEntries((parseNameValueSection(L, 'Average API cost per task (USD) · Lower is better', money) || []).map(r => [r.name, parseFloat(r.value.slice(1))]));
  result.benchmarks = {};
  for (const [tab, title] of [['DeepSWE v1.1', 'DeepSWE v1.1 Benchmark Score'], ['Terminal-Bench 4.0', 'Terminal-Bench 4.0 Benchmark Score'], ['SWE-Atlas-QnA', 'SWE-Atlas-QnA Benchmark Score']]) {
    try {
      await page.getByRole('tab', { name: tab }).first().click();
      await page.waitForTimeout(4000);
      const t = await page.evaluate(() => document.body.innerText);
      result.benchmarks[tab] = parseAgentChart(t, title);
      console.error(`${tab}: ${result.benchmarks[tab] ? result.benchmarks[tab].length : 0} rows`);
    } catch (e) {
      const msg = `${tab} failed: ${e.message.split('\n')[0]}`;
      result.errors.push(msg); console.error(msg);
    }
  }
  result.partial = result.errors.length > 0;
  return result;
}

// --- parsing ---------------------------------------------------------------

function linesOf(text) {
  return text.split('\n').map(l => l.trim());
}

// Generic "names then values" section parser. Anchor = exact heading line.
// Names: lines containing a letter, not starting with '$', not pure numbers.
// Values: pure ints or $floats. Stops at first line that is neither.
function parseNameValueSection(allLines, anchor, valueRe) {
  const h = allLines.findIndex(l => l === anchor);
  if (h === -1) return null;
  let i = h + 1;
  const names = [];
  while (i < allLines.length) {
    const l = allLines[i];
    if (!l) { i++; continue; }
    if (valueRe.test(l)) break; // value-looking line ends names (e.g. "11.7m")
    if (/[a-zA-Z]/.test(l) && !/^\$/.test(l) && !/^\d+$/.test(l)) { names.push(l); i++; continue; }
    break;
  }
  const vals = [];
  while (i < allLines.length) {
    const l = allLines[i];
    if (!l) { i++; continue; }
    if (valueRe.test(l)) { vals.push(l); i++; continue; }
    break;
  }
  const n = Math.min(names.length, vals.length);
  return names.slice(0, n).map((name, k) => ({ name, value: vals[k] }));
}

function parseHighlights(text) {
  const L = linesOf(text);
  const num = /^\d+$/;
  const money = /^\$[\d.]+$/;
  const intel = parseNameValueSection(L, 'Artificial Analysis Intelligence Index · Higher is better', num) || [];
  const speed = parseNameValueSection(L, 'Output tokens per second · Higher is better', num) || [];
  const cost = parseNameValueSection(L, 'Weighted average cost (USD) per Intelligence Index task · Lower is better', money) || [];
  const zip = (ns, vs, fn) => {
    const m = {};
    ns.forEach((r, k) => { if (k < vs.length) m[r.name] = fn(vs[k].value, r.name); });
    return m;
  };
  const toNum = v => parseFloat(String(v).replace('$', ''));
  const intelM = {}, speedM = {}, costM = {};
  intel.forEach((r, k) => { intelM[r.name] = parseInt(r.value, 10); });
  speed.forEach((r, k) => { speedM[r.name] = parseInt(r.value, 10); });
  cost.forEach((r, k) => { costM[r.name] = parseFloat(r.value.slice(1)); });
  return { intelligence: intelM, speed_tps: speedM, cost_per_task: costM, _order: intel.map(r => r.name) };
}

function parseEngineering(text) {
  const L = linesOf(text);
  const h = L.findIndex(l => l === 'Artificial Analysis Engineering Index');
  if (h === -1) return null;
  let i = h;
  while (i < L.length && L[i] !== 'Add model from specific provider') i++;
  if (i >= L.length) return null; // table CTA text changed — caller must warn, not store []
  i++;
  const names = [];
  while (i < L.length && !/^\d+$/.test(L[i])) { if (L[i]) names.push(L[i]); i++; }
  const vals = [];
  while (i < L.length && /^\d+$/.test(L[i])) { vals.push(parseInt(L[i], 10)); i++; }
  const n = Math.min(names.length, vals.length);
  if (!n) return null;
  return names.slice(0, n).map((name, k) => ({ rank: k + 1, name, engineering: vals[k] }));
}

function parseModelPage(text, slug) {
  const L = linesOf(text).filter(Boolean);
  const m = {};
  for (const l of L) {
    const pd = l.match(/^Cache Discount (\d+)%$/);
    if (pd && m.cache_discount_pct === undefined) { m.cache_discount_pct = parseInt(pd[1], 10); continue; }
    const ps = l.match(/At (\d+) tokens per second/);
    if (ps && m.speed_tps === undefined) { m.speed_tps = parseInt(ps[1], 10); continue; }
  }
  // pricing may wrap across lines — match on flattened text
  const flat = L.join(' ');
  const pm = flat.match(/Pricing for (.+?) is \$([\d.]+) per 1M input tokens.*?\$([\d.]+) per 1M output tokens/);
  if (!pm) return null;
  m.display_name = pm[1];
  m.input = parseFloat(pm[2]);
  m.output = parseFloat(pm[3]);
  const pc = flat.match(/cost \$([\d.]+) to evaluate/);
  if (pc) m.eval_total_cost = parseFloat(pc[1]);
  if (m.cache_discount_pct !== undefined) {
    m.cache_read = Math.round(m.input * (1 - m.cache_discount_pct / 100) * 100) / 100;
  }
  return { slug, ...m, cache_write: null };
}

// opencode model id ("nvidia/deepseek-ai/deepseek-v4-pro") -> AA slug candidates
function slugCandidates(modelId) {
  const last = modelId.split('/').pop().toLowerCase().replace(/\./g, '-');
  const cands = [last];
  for (const suffix of ['-contributor-free', '-free', '-nightly', '-exp']) {
    if (last.endsWith(suffix)) cands.push(last.slice(0, -suffix.length));
  }
  const dated = last.match(/^(.*)-\d{4}$/); // pinned snapshots: deepseek-v4-pro-0813
  if (dated) cands.push(dated[1]);
  return [...new Set(cands)];
}

function readAgentModels(configDir) {
  const agents = [];
  const agentDir = path.join(configDir, 'agent');
  const agentDirs = [agentDir, path.join(configDir, 'agents')].filter(d => fs.existsSync(d));
  for (const d of agentDirs) {
    for (const f of fs.readdirSync(d).filter(f => f.endsWith('.md'))) {
      const body = fs.readFileSync(path.join(d, f), 'utf8');
      const mm = body.match(/^model:\s*(.+)$/m);
      if (mm) agents.push({ agent: f.replace(/\.md$/, ''), file: path.join(d, f), model: mm[1].trim() });
    }
  }
  for (const cfg of ['opencode.json', 'opencode.jsonc']) {
    const p = path.join(configDir, cfg);
    if (!fs.existsSync(p)) continue;
    const body = fs.readFileSync(p, 'utf8');
    for (const key of ['"model"', '"small_model"']) {
      const mm = body.match(new RegExp(key + '\\s*:\\s*"([^"]+)"'));
      if (mm) agents.push({ agent: `(config ${key.replace(/"/g, '')})`, file: p, model: mm[1] });
    }
  }
  return agents;
}

// --- main ------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));

function usage() {
  console.error('usage: node aa_bench.mjs check <slug>... [--out FILE] [--config DIR]');
  console.error('       node aa_bench.mjs coding [--out FILE]');
  console.error('       node aa_bench.mjs inventory [provider...] [--out FILE]');
}

function validateArgs(a) {
  const errs = [...a.errors];
  if (!['check', 'coding', 'inventory'].includes(a.cmd)) errs.push(`unknown command '${a.cmd}'`);
  if (a.cmd === 'check' && !a.slugs.length) errs.push('check needs at least one slug');
  if (a.cmd === 'coding' && a.slugs.length) errs.push('coding takes no slugs');
  if ((a.cmd === 'coding' || a.cmd === 'inventory') && a.configSet) errs.push(`${a.cmd} does not use --config`);
  return errs;
}

const argErrs = validateArgs(args);
if (argErrs.length) { usage(); argErrs.forEach(e => console.error('error: ' + e)); process.exit(2); }

function emit(obj) {
  const body = JSON.stringify(obj, null, 2);
  if (args.out) { fs.writeFileSync(args.out, body); console.error(`wrote ${args.out}`); }
  else console.log(body);
}

if (args.cmd === 'inventory') {
  // no browser needed — runs before any playwright import
  const result = await runInventory(args.slugs.length ? args.slugs : ['opencode', 'nvidia', 'ollama'], defaultBin());
  result.partial = Object.values(result.providers).some(v => v && v.error);
  emit(result);
  process.exit(0);
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

if (args.cmd === 'coding') {
  let result;
  try {
    result = await runCoding(page);
  } finally {
    await browser.close();
  }
  emit(result);
  process.exit(0);
}

async function getText(url, scrolls, waitMs) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(waitMs || 5000);
  for (let i = 0; i < (scrolls || 0); i++) {
    await page.evaluate(() => window.scrollBy(0, 2500));
    await page.waitForTimeout(700);
  }
  return page.evaluate(() => document.body.innerText);
}

const result = { scraped_at: new Date().toISOString().slice(0, 10), source: 'artificialanalysis.ai', errors: [] };
try {
  console.error('homepage highlights…');
  result.highlights = parseHighlights(await getText('https://artificialanalysis.ai/', 0, 6000));
  const hl = result.highlights;
  console.error(`highlights: intel=${Object.keys(hl.intelligence).length} speed=${Object.keys(hl.speed_tps).length} cost=${Object.keys(hl.cost_per_task).length}`);
  if (!Object.keys(hl.intelligence).length) result.errors.push('homepage highlights parsed empty (AA UI changed?)');

  result.models = [];
  let engDone = false;
  for (const slug of args.slugs) {
    try {
      console.error(`model page ${slug}…`);
      const text = await getText(`https://artificialanalysis.ai/models/${slug}`, 6, 5000);
      if (!engDone) {
        try {
          const roleTab = page.getByRole('tab', { name: /engineering/i }).first();
          if (await roleTab.count()) await roleTab.click();
          else await page.locator('[id$="-trigger-engineering"]').first().click(); // Radix-id fallback
          await page.waitForTimeout(4000);
          const engText = await page.evaluate(() => document.body.innerText);
          result.engineering = parseEngineering(engText);
          if (!result.engineering) result.errors.push('engineering table anchor miss (AA UI changed?)');
          else console.error(`engineering table: ${result.engineering.length} rows`);
          engDone = true;
        } catch (e) {
          const msg = `engineering tab failed: ${e.message.split('\n')[0]}`;
          result.errors.push(msg); console.error(msg);
        }
      }
      const m = parseModelPage(text, slug);
      if (m) { result.models.push(m); console.error(`ok ${slug}: $${m.input}/$${m.output} ${m.speed_tps} tps`); }
      else { result.errors.push(`no pricing parsed for ${slug}`); console.error(`NO PRICING on page for ${slug}`); }
    } catch (e) {
      const msg = `slug ${slug} failed: ${e.message.split('\n')[0]}`;
      result.errors.push(msg); console.error(msg);
    }
  }
} finally {
  await browser.close();
}
result.partial = result.errors.length > 0;

// cross-check agent definitions
const agents = readAgentModels(args.config);
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const engByNorm = {};
(result.engineering || []).forEach(r => { engByNorm[norm(r.name)] = r; });
function matchEng(table, needle) {
  const n = norm(needle);
  if (table[n]) return table[n];
  // fuzzy fallback: prefix match only across a digit boundary (variant
  // suffixes like 0813/max), longest first; log ambiguity, don't hide it
  const cands = Object.entries(table).filter(([k]) =>
    (k.startsWith(n) && (k.length === n.length || /\d/.test(k[n.length]))) ||
    (n.startsWith(k) && (n.length === k.length || /\d/.test(n[k.length]))));
  cands.sort((a, b) => b[0].length - a[0].length);
  if (cands.length > 1) console.error(`eng fuzzy '${needle}' -> '${cands[0][1].name}' (also: ${cands.slice(1).map(c => c[1].name).join('; ')})`);
  return cands.length ? cands[0][1] : null;
}
result.agents = agents.map(a => {
  const cands = slugCandidates(a.model);
  const hit = result.models.find(m => cands.includes(m.slug));
  // match display name against engineering table
  let eng = null;
  if (hit && hit.display_name) eng = matchEng(engByNorm, hit.display_name);
  if (!eng) {
    // fallback: match the pinned id itself (covers slugs not fetched this run)
    for (const c of cands) { eng = matchEng(engByNorm, c); if (eng) break; }
  }
  return { ...a, aa_slug: hit ? hit.slug : null, aa_match: eng ? eng.name : (hit ? hit.display_name : null), engineering: eng };
});

emit(result);
