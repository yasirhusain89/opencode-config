#!/usr/bin/env node
// weekly_report.mjs — join an OpenRouter catalog snapshot with curated AA
// benchmark data → value ranking + week-over-week deltas, as Markdown.
// Deterministic (no LLM call): read it directly, or hand it to an agent
// for deeper analysis.
// Usage:
//   node weekly_report.mjs --catalog FILE [--prev FILE] [--coding FILE] [--out FILE]
// --coding points at a coding-index snapshot for harness-qualified agentic rows
// (optional; falls back to the curated table below). No --out prints to stdout.
//
// Curated AA data (AA_BENCH) is refreshed by hand from the skill snapshots +
// guide after each benchmark pull. Fields: eng, intel, cai, ds (DeepSWE),
// tb (Terminal-Bench), qna, plus *_src quirks inline. Absent = unevaluated.

import fs from 'fs';

// family -> curated AA numbers (see skill snapshots + model-selection-guide.html)
const AA_BENCH = {
  spark13:    { eng: 49, intel: 48, cai: 54, ds: 72, tb: 32, qna: 59, note: 'DeepSWE co-leader' },
  spark12:    { intel: 40, note: 'dominated by 1.3 at same price; LMArena text #5 (xHigh)' },
  glm53flash:{ eng: 44, note: 'no agentic data' },
  kimiK3:     { eng: 43, intel: 44, cai: 52, ds: 68, tb: 21, qna: 66, note: '1h/task, slow' },
  gemini38f:  { eng: 43, intel: 41, cai: 42, ds: 66, tb: 15, qna: 45, note: 'fastest 11.7m' },
  gemma4:     { intel: 39.2, note: 'no Eng/CAI; strong AA Coding Index note' },
  ds41flash:  { eng: 39, intel: 40, note: 'no agentic data; strict-dominates DS Pro on Intel/Eng/price' },
  dspro0813:  { eng: 37, intel: 36, cai: 43, ds: 57, tb: 10, qna: 62, note: '$0.24/task cheapest agent; T-Bench last' },
  luna:       { eng: 36, intel: 38, note: 'check discount status' },
  dsflash:    { eng: 35, cai: '~39*', ds: 54, tb: 11, qna: 51, note: '*composite inferred' },
  dspro:      { eng: 32, note: 'floating alias, weaker than 0813 pin' },
  m3:         { eng: 32, note: '' },
  k26:        { eng: 31, note: '' },
  k27code:    { eng: 30, note: '' },
  inkling:    { eng: 29, note: '' },
  mimoPro:    { eng: 29, note: '' },
  oss120:     { intel: 33.3, note: 'docs-grade' },
  lingflash:  { intel: 38, note: 'thin ecosystem' },
  lingfin:    { note: 'finance-tuned variant; base family Intel 38' },
  lingvl:     { note: 'vision variant; base family Intel 38' },
  lingsante:  { note: 'health variant; base family Intel 38' },
  mimoBase:   { intel: 22, note: 'base; Pro variant scores higher (Intel 43/Eng 29)' },
  nemoUltra:  { intel: 48, note: 'no Eng/CAI; trial-logged free' },
  nemoSuper:  { intel: 36, note: 'no Eng/CAI' },
  sol:        { ds: 72, tb: 37, qna: 54, note: 'no composite/cost; watchlist' },
  sonnet5:    { eng: 40, intel: 38, note: 'LMArena text #26; pricier than equal scorers' },
  sonnet46:   { intel: 25, note: 'high-effort non-reasoning; dominated by Sonnet 5 on all axes' },
};

// ordered OR-id substring -> family (first match wins; keep specific first)
const FAMILY_RULES = [
  ['muse-spark-1.3', 'spark13'],
  ['muse-spark-1.2', 'spark12'],
  ['claude-sonnet-5', 'sonnet5'],
  ['claude-sonnet-4-6', 'sonnet46'],
  ['glm-5.3-flash', 'glm53flash'],
  ['kimi-k3', 'kimiK3'],
  ['gemini-3.8-flash', 'gemini38f'],
  ['gemma-4-31b', 'gemma4'],
  ['gemma-4-26b', 'gemma4'],
  ['deepseek-v4-1-flash', 'ds41flash'],
  ['deepseek-v4-pro-0813', 'dspro0813'],
  ['deepseek-v4-pro', 'dspro'],
  ['deepseek-v4-flash-0731', 'dsflash'],
  ['deepseek-v4-flash-latest', 'dsflash'],
  ['deepseek-v4-flash', 'dsflash'],
  ['gpt-5.6-luna', 'luna'],
  ['gpt-luna-latest', 'luna'],
  ['minimax-m3', 'm3'],
  ['kimi-k2.7-code', 'k27code'],
  ['kimi-k2.6', 'k26'],
  ['inkling-small', 'inkling'],
  ['mimo-v2.5', 'mimoBase'],
  ['ling-3.0-flash-fin', 'lingfin'], ['ling-3.0-flash-vl', 'lingvl'],
  ['ling-3.0-flash-sante', 'lingsante'],
  ['ling-3.0-flash', 'lingflash'],
  ['nemotron-3-ultra', 'nemoUltra'],
  ['nemotron-3-super', 'nemoSuper'],
  ['nemotron-3.5-lightning', null], // unevaluated speed tier
  ['gpt-5.6-sol', 'sol'],
  ['qwen3-coder', null], ['qwen3.5-flash', null], ['qwen3.5-plus', null],
  ['qwen3.5-122b', null], ['qwen3.5-397b', null], ['step-3', null],
  ['tencent/hy3', null], ['solar-pro', null], ['mercury', null],
  ['mistral-nemo', null], ['codestral', null],
  ['qwen3.5-9b', null], ['qwen3.5-27b', null], ['qwen3.5-35b', null],
];

function familyOf(id) {
  const low = id.toLowerCase();
  for (const [sub, fam] of FAMILY_RULES) {
    if (low.includes(sub)) return fam; // null = recognized, unevaluated
  }
  return undefined; // unknown id
}

function parseArgs(argv) {
  const o = { catalog: null, prev: null, coding: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--catalog') o.catalog = argv[++i];
    else if (argv[i] === '--prev') o.prev = argv[++i];
    else if (argv[i] === '--coding') o.coding = argv[++i];
    else if (argv[i] === '--out') o.out = argv[++i];
    else { console.error(`unknown arg '${argv[i]}'`); process.exit(2); }
  }
  if (!o.catalog) { console.error('usage: node weekly_report.mjs --catalog FILE [--prev FILE] [--coding FILE] [--out FILE]'); process.exit(2); }
  return o;
}

const args = parseArgs(process.argv.slice(2));
const cat = JSON.parse(fs.readFileSync(args.catalog, 'utf8'));
const prev = args.prev && fs.existsSync(args.prev) ? JSON.parse(fs.readFileSync(args.prev, 'utf8')) : null;
const prevById = {};
if (prev) for (const m of prev.models) prevById[m.id] = m;

const isTextOut = m => (m.mod || '').endsWith('->text');
const rows = cat.models.filter(m => m.tools === 1 && isTextOut(m));
const free = rows.filter(m => m.in === 0 && m.out === 0);
const paid = rows.filter(m => !(m.in === 0 && m.out === 0));

function bench(id) {
  const fam = familyOf(id);
  if (fam === undefined) return { known: false };
  if (fam === null) return { known: true, evaluated: false };
  return { known: true, evaluated: true, fam, ...(AA_BENCH[fam] || {}) };
}
function benchStr(id) {
  const b = bench(id);
  if (!b.known) return '—';
  if (!b.evaluated) return 'unevaluated';
  const parts = [];
  if (b.ds !== undefined) parts.push(`DS ${b.ds}`);
  if (b.cai !== undefined) parts.push(`CAI ${b.cai}`);
  if (b.eng !== undefined) parts.push(`Eng ${b.eng}`);
  if (b.intel !== undefined) parts.push(`Intel ${b.intel}`);
  if (b.tb !== undefined) parts.push(`TB ${b.tb}`);
  if (!parts.length) return b.note ? b.note : '—';
  return parts.join(' · ');
}

// Tier 1: benchmarked value — paid, input <= $0.30, has DS/CAI/Eng/Intel
const tier1 = paid
  .filter(m => m.in <= 0.30)
  .map(m => ({ ...m, b: bench(m.id) }))
  .filter(m => m.b.evaluated && (m.b.ds !== undefined || m.b.cai !== undefined || m.b.eng !== undefined || m.b.intel !== undefined))
  .sort((a, b) => a.in - b.in || a.out - b.out);
// Tier 2: cheap fliers — paid, input <= $0.30, recognized but unevaluated, non-tiny ctx
const tier2 = paid
  .filter(m => m.in <= 0.30 && m.ctx >= 131072)
  .map(m => ({ ...m, b: bench(m.id) }))
  .filter(m => m.b.known && !m.b.evaluated)
  .sort((a, b) => a.in - b.in || a.out - b.out);
// Free with tools (exclude tool-less dead ends like glm-5.2:free)
const freeRows = free.filter(m => m.ctx >= 65536).sort((a, b) => b.ctx - a.ctx);

function fmtPrice(m) {
  const flag = [];
  if (m.id.endsWith(':batch')) flag.push('queued');
  if (m.id.startsWith('~')) flag.push('unlisted route');
  if (m.id.endsWith(':free')) flag.push('free route');
  return `$${m.in} / $${m.out}` + (flag.length ? ` (${flag.join(', ')})` : '');
}

// Deltas vs previous catalog (contenders only: tracked families or price moves on cheap routes)
const deltas = { added: [], removed: [], moved: [] };
if (prev) {
  const cur = new Map(cat.models.map(m => [m.id, m]));
  const tracked = id => familyOf(id) !== undefined || (prevById[id] && prevById[id].in <= 1);
  for (const m of cat.models) {
    if (!tracked(m.id)) continue;
    const p = prevById[m.id];
    if (!p) deltas.added.push(m);
    else if (Math.abs(p.in - m.in) / Math.max(p.in, 1e-9) > 0.05 || Math.abs(p.out - m.out) / Math.max(p.out, 1e-9) > 0.05) {
      deltas.moved.push({ ...m, wasIn: p.in, wasOut: p.out });
    }
  }
  for (const id of Object.keys(prevById)) {
    if (!cur.has(id) && tracked(id)) deltas.removed.push(prevById[id]);
  }
}

const L = [];
L.push(`# OpenRouter value report — ${cat.scraped_at}`);
L.push('');
L.push(`Catalog: ${cat.count} routes (${rows.length} tool-capable text-out). Prices $/1M. Benchmarks: curated AA snapshot (see skill).`);
if (args.coding) L.push(`Agentic cross-check: ${args.coding}.`);
L.push('');
L.push('## Tier 1 — benchmarked value (paid, input ≤ $0.30)');
L.push('');
L.push('| Route | $/1M in/out | ctx | AA signal |');
L.push('|---|---|---|---|');
for (const m of tier1.slice(0, 30)) L.push(`| \`${m.id}\` | ${fmtPrice(m)} | ${(m.ctx / 1024) | 0}K | ${benchStr(m.id)} |`);
L.push('');
L.push('## Tier 2 — cheap fliers, no AA data (trial only, never pin blind)');
L.push('');
L.push('| Route | $/1M in/out | ctx |');
L.push('|---|---|---|');
for (const m of tier2.slice(0, 30)) L.push(`| \`${m.id}\` | ${fmtPrice(m)} | ${(m.ctx / 1024) | 0}K |`);
L.push('');
L.push('## Free routes with tools (ctx ≥ 64K)');
L.push('');
L.push('| Route | ctx | AA signal |');
L.push('|---|---|---|');
for (const m of freeRows.slice(0, 20)) L.push(`| \`${m.id}\` | ${(m.ctx / 1024) | 0}K | ${benchStr(m.id)} |`);
L.push('');
L.push('## Week-over-week deltas');
L.push('');
if (!prev) { L.push('Baseline run — no previous catalog for comparison.'); }
else {
  if (!deltas.added.length && !deltas.removed.length && !deltas.moved.length) L.push('No contender changes.');
  for (const m of deltas.added) L.push(`- NEW \`${m.id}\` ${fmtPrice(m)} (${benchStr(m.id)})`);
  for (const m of deltas.removed) L.push(`- GONE \`${m.id}\` (was $${m.in} / $${m.out})`);
  for (const m of deltas.moved) L.push(`- MOVED \`${m.id}\` $${m.wasIn} / $${m.wasOut} → ${fmtPrice(m)}`);
}
L.push('');
L.push('Caveats: `:batch` = queued (not for interactive loops); `~` = unlisted route, verify identity; OR prices drift daily; enforce ZDR + training opt-out (see skill terms section).');

const body = L.join('\n') + '\n';
if (args.out) { fs.writeFileSync(args.out, body); console.error(`wrote ${args.out}`); }
else console.log(body);
