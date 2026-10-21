#!/usr/bin/env node
// dashboard.mjs — regenerate the guide's live sections from local ground truth.
// Reads: opencode.db (usage), opencode.log (429s/timeouts), agent pins +
// opencode.jsonc, newest access snapshot (dead-pin check).
// Writes: snapshots/dashboard-YYYY-MM-DD.json (+ --html fragment with the
// §1 dashboard and §8 usage tbodys), optionally splices them into the guide
// with --write-guide (strict anchor assertions, aborts on ambiguity).
//
// Usage:
//   node dashboard.mjs [--date YYYY-MM-DD] [--db PATH] [--log PATH]
//   [--config DIR] [--access FILE] [--out FILE] [--html FILE] [--write-guide FILE]
// Defaults mirror the skill layout (~/.config/opencode, ~/.local/share/opencode).
// No network, stdlib + sqlite3 CLI only.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const HOME = os.homedir();
const SKILL = path.join(HOME, '.config/opencode/skills/model-benchmarks');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i === -1 ? def : (process.argv[i + 1] || (() => { throw new Error(name + ' needs a value'); })());
}
const has = (name) => process.argv.includes(name);

const DATE = arg('--date', new Date().toISOString().slice(0, 10));
const DB = arg('--db', path.join(HOME, '.local/share/opencode/opencode.db'));
const LOG = arg('--log', path.join(HOME, '.local/share/opencode/log/opencode.log'));
const CONFIG = arg('--config', path.join(HOME, '.config/opencode'));
const SNAP = path.join(SKILL, 'snapshots');
function newestAccess() {
  const fs2 = fs.readdirSync(SNAP).filter(f => /^access-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!fs2.length) throw new Error('no access snapshot in ' + SNAP);
  return path.join(SNAP, fs2[fs2.length - 1]);
}
const ACCESS = has('--access') ? arg('--access') : newestAccess();
function newestSnap(prefix) {
  const fs2 = fs.readdirSync(SNAP).filter(f => f.startsWith(prefix) && f.endsWith('.json')).sort();
  return fs2.length ? path.join(SNAP, fs2[fs2.length - 1]) : null;
}
const CHECK = has('--check') ? arg('--check') : newestSnap('check-');
const OUT = arg('--out', path.join(SNAP, `dashboard-${DATE}.json`));

// Go plan prices ($/1M in/out/cached) + monthly caps — mirror of guide §5, update together.
const GO = {
  'glm-5.3-flash':            { p: [0.15, 0.50, 0.03], cap: 60 },
  'glm-5.3':                  { p: [1.40, 4.40, 0.26], cap: 15 },
  'muse-spark-1.3-contributor': { p: [0.10, 0.20, 0.002], cap: 60 },
  'deepseek-v4.1-flash':      { p: [0.15, 0.60, 0.003], cap: 80 },
  'deepseek-v4-pro':          { p: [0.66, 1.98, 0.022], cap: 15 },
  'gpt-6-luna':               { p: [0.10, 0.50, 0.01], cap: 15 },
  'claude-haiku-5.5':         { p: [0.10, 0.50, 0.01], cap: 15 },
  'mimo-v2.6-pro':            { p: [0.435, 0.87, 0.0036], cap: 15 },
  'mimo-v2.6-flash':          { p: [0.14, 0.28, 0.0028], cap: 60 },
  'step-5-preview':           { p: [1.00, 2.70, 0.10], cap: 60 },
  'space-bunny':              { p: [0.15, 0.60, 0.015], cap: 30 }, // historic ID; AA 10-20 confirms = M3.1 Flash early build, 90% cache discount
  'minimax-m3.1-flash':       { p: [0.15, 0.60, 0.015], cap: 30 }, // ex-space-bunny (live 10-20); cap inherits $30 — verify in Go console
  'gemini-4-argon-contributor': { p: [4.00, 20.00, 0.20], cap: 60 }, // console 10-20 bills at full-rate equivalent (2x counting cancels the 50% off): 23 reqs = $1.60
  'gpt-5.6-luna':             { p: [0.20, 1.20, 0.02], cap: 15 }, // Zen docs 10-20 (≤272K); cap = $15-tier default — verify
  'kimi-k2.7-code':           { p: [0.95, 4.00, 0.19], cap: 15 }, // Zen docs 10-20; cap = $15-tier default — verify
  'qwen3.8-flash':            { p: [0.15, 0.47, 0.016], cap: 15 }, // Zen docs 10-20; cap = $15-tier default — verify
  'qwen3.7-plus':             { p: [0.40, 1.60, 0.04], cap: 15 }, // Zen docs 10-20; cap = $15-tier default — verify
  'minimax-m3':               { p: [0.30, 1.20, 0.06], cap: 15 }, // Zen docs 10-20; cap = $15-tier default — verify
  'qwen3.8-max':              { p: [2.00, 6.00, 0.25], cap: 15 },
  'kimi-k3':                  { p: [3.00, 15.00, 0.30], cap: 15 },
};
// family key: strip provider + date pins + free suffixes
function fam(modelId) {
  let s = String(modelId || '').split('/').pop().toLowerCase();
  for (const suf of ['-contributor-free', '-free', '-nightly', '-exp']) if (s.endsWith(suf)) s = s.slice(0, -suf.length);
  const d = s.match(/^(.*)-\d{4}$/); if (d) s = d[1];
  return s;
}

function q(sql) {
  const out = execFileSync('sqlite3', [DB, '-separator', '\t', sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.trim() ? out.trim().split('\n').map(l => l.split('\t')) : [];
}
const N = (v) => (v === null || v === undefined || v === '' || v === 'NULL') ? 0 : parseFloat(v);

// --- usage (assistant rows, UTC day window) ---
const dayStart = `${DATE} 00:00:00`, dayEnd = `${DATE} 23:59:59`;
const rows = q(`SELECT COALESCE(json_extract(data,'\$.modelID'),'?'), COALESCE(json_extract(data,'\$.providerID'),'?'), COUNT(*), COALESCE(SUM(json_extract(data,'\$.tokens.input')),0), COALESCE(SUM(json_extract(data,'\$.tokens.output')),0), COALESCE(SUM(json_extract(data,'\$.tokens.reasoning')),0), COALESCE(SUM(json_extract(data,'\$.tokens.cache.read')),0), MAX(datetime(time_created/1000,'unixepoch')), COALESCE(SUM(json_extract(data,'\$.cost')),0), SUM(CASE WHEN COALESCE(json_extract(data,'\$.tokens.total'),0)=0 AND json_extract(data,'\$.finish') IS NULL THEN 1 ELSE 0 END) FROM message WHERE json_extract(data,'\$.role')='assistant' AND datetime(time_created/1000,'unixepoch') BETWEEN '${dayStart}' AND '${dayEnd}' GROUP BY 1,2 ORDER BY 3 DESC;`);
const perRoute = rows.map(r => ({ model: r[0], provider: r[1], msgs: +r[2], inM: N(r[3]) / 1e6, outM: N(r[4]) / 1e6, reasM: N(r[5]) / 1e6, cacheM: N(r[6]) / 1e6, last: r[7] || '', usd: +(+r[8]).toFixed(3), failN: +r[9] || 0 }));
perRoute.forEach(r => { r.failPct = r.msgs ? +(100 * r.failN / r.msgs).toFixed(1) : 0; });
// p50 turn latency per route (ms -> s)
const durs = q(`SELECT COALESCE(json_extract(data,'\$.modelID'),'?'), (json_extract(data,'\$.time.completed')-json_extract(data,'\$.time.created'))/1000.0 FROM message WHERE json_extract(data,'\$.role')='assistant' AND datetime(time_created/1000,'unixepoch') BETWEEN '${dayStart}' AND '${dayEnd}' AND json_extract(data,'\$.time.completed') IS NOT NULL AND json_extract(data,'\$.time.created') IS NOT NULL;`);
const byModel = {};
for (const [m, d] of durs) { const v = +d; if (v >= 0) (byModel[m] = byModel[m] || []).push(v); }
for (const r of perRoute) {
  const a = (byModel[r.model] || []).sort((x, y) => x - y);
  r.p50s = a.length ? +(a[Math.floor(a.length / 2)]).toFixed(1) : null;
}
const meteredGoUsd = +perRoute.filter(r => r.provider === 'opencode-go').reduce((a, r) => a + r.usd, 0).toFixed(2);
const tot = perRoute.reduce((a, r) => ({ msgs: a.msgs + r.msgs, inM: a.inM + r.inM, outM: a.outM + r.outM, cacheM: a.cacheM + r.cacheM }), { msgs: 0, inM: 0, outM: 0, cacheM: 0 });
const peak = q(`SELECT substr(datetime(time_created/1000,'unixepoch'),1,13), COUNT(*) FROM message WHERE json_extract(data,'$.role')='assistant' AND datetime(time_created/1000,'unixepoch') BETWEEN '${dayStart}' AND '${dayEnd}' GROUP BY 1 ORDER BY 2 DESC LIMIT 1;`)[0] || [];

// --- pins ---
const pins = [];
for (const d of ['agent', 'agents']) {
  const dir = path.join(CONFIG, d);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
    const body = fs.readFileSync(path.join(dir, f), 'utf8');
    const mm = body.match(/^model:\s*(.+)$/m);
    if (mm) pins.push({ where: `${d}/${f}`, model: mm[1].trim() });
  }
}
for (const cfg of ['opencode.json', 'opencode.jsonc']) {
  const pth = path.join(CONFIG, cfg);
  if (!fs.existsSync(pth)) continue;
  const body = fs.readFileSync(pth, 'utf8');
  for (const key of ['"model"', '"small_model"']) {
    // strip full-line // comments first: they may contain {"model": ...} examples
    const code = body.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    const mm = code.match(new RegExp(key + '\\s*:\\s*"([^"]+)"'));
    if (mm) pins.push({ where: `${cfg} ${key.replace(/"/g, '')}`, model: mm[1] });
  }
}
let shelf = [];
try { shelf = JSON.parse(fs.readFileSync(ACCESS, 'utf8')).providers.opencode.map(s => String(s).split('/').pop()); } catch { /* access unreadable: skip dead-pin check */ }
const deadPins = shelf.length ? pins.filter(a => /-free$/.test(a.model.split('/').pop()) && !shelf.includes(a.model.split('/').pop())) : [];

// --- log incidents (429s) in window ---
let errors429 = [];
try {
  const log = fs.readFileSync(LOG, 'utf8');
  for (const line of log.split('\n')) {
    if (!/stream error/.test(line)) continue; // ignore permission-audit echoes of our own grep commands
    if (!/Too Many Requests| 429 /.test(line)) continue;
    const ts = (line.match(/timestamp=([0-9T:.\-]+Z)/) || [])[1] || '';
    if (!ts.startsWith(DATE)) continue;
    const model = (line.match(/modelID=([^\s]+)/) || [])[1] || '?';
    errors429.push({ ts, model });
  }
} catch { /* no log */ }
const errModels = [...new Set(errors429.map(e => e.model))];

// --- Go headroom for the reviewer loop (glm-5.3-flash family, today's mix) ---
function goCost(family, inM, outM, cacheM) {
  const g = GO[family]; if (!g) return null;
  const [pi, po, pc] = g.p;
  const cost = inM * pi + (outM) * po + cacheM * pc;
  return { cost, cap: g.cap, pct: cost / g.cap };
}
const flash = perRoute.filter(r => fam(r.model) === 'glm-5.3-flash');
const flashIn = flash.reduce((a, r) => a + r.inM, 0), flashOut = flash.reduce((a, r) => a + r.outM + r.reasM, 0), flashCache = flash.reduce((a, r) => a + r.cacheM, 0);
const flashMsgs = flash.reduce((a, r) => a + r.msgs, 0);
const flashGo = goCost('glm-5.3-flash', flashIn, flashOut, flashCache);
// drift: agent pins with no AA match in the newest check snapshot + snapshot ages
let unmatched = [], snapAges = {};
if (CHECK && fs.existsSync(CHECK)) {
  try {
    const cj = JSON.parse(fs.readFileSync(CHECK, 'utf8'));
    for (const a of (cj.agents || [])) if (!a.aa_slug) unmatched.push({ where: a.agent, model: a.model });
    snapAges.check = cj.scraped_at || null;
  } catch { /* ignore */ }
}
try {
  snapAges.access = JSON.parse(fs.readFileSync(ACCESS, 'utf8')).scraped_at || null;
} catch { /* ignore */ }
const codingSnap = newestSnap('coding-index-');
if (codingSnap) { try { snapAges.coding = JSON.parse(fs.readFileSync(codingSnap, 'utf8')).scraped_at || null; } catch { /* ignore */ } }
// pacing: days until the weekly sub-cap (50% of monthly) at today's burn
const pacing = flashGo ? { family: 'glm-5.3-flash', perDay: +flashGo.cost.toFixed(2), weeklyCap: flashGo.cap * 0.5, daysToWeeklyCap: +(flashGo.cap * 0.5 / flashGo.cost).toFixed(1) } : null;
// metered vs projected (actuals reconciliation)
const metered = { goUsd: meteredGoUsd, projectedGoLoopUsd: flashGo ? +flashGo.cost.toFixed(2) : null };
// routing artifact: machine-readable pins+fallbacks (mirror of guide §9)
const ROUTES = {
  reviewer: { primary: 'opencode-go/glm-5.3-flash', fallback: 'opencode/minimax-m3.1-flash-free', why: 'zero-retention Go loop; free §16 winner (ex-space-bunny) as fallback' },
  researcher: { primary: 'opencode/nemotron-3.5-super-vl-free', fallback: 'opencode-go/glm-5.3-flash', why: 'no Go T-Bench fit except training-flagged Argon' },
  'security-reviewer': { primary: 'opencode-go/claude-haiku-5.5', fallback: 'opencode-go/muse-spark-1.3-contributor', why: 'cheapest scored quality; spark-contrib is break-glass only (trains Meta, non-proprietary code only)' },
  brainstorm: { primary: 'opencode/glm-5.3-flash-free', fallback: 'opencode/minimax-m3.1-flash-free', why: 'personality fit: top imagination/expressiveness/warmth; minimax fallback for Intel 43' },
  'docs-writer': { primary: 'opencode/glm-5.3-flash-free', fallback: 'opencode/nemotron-3.5-super-vl-free', why: 'free tier is enough for latency/price roles' },
  'domain-companion': { primary: 'opencode/glm-5.3-flash-free', fallback: 'opencode/nemotron-3.5-super-vl-free', why: 'free tier is enough for latency/price roles' },
};

// --- standardized requests: 1 SR ≡ $0.01 of model spend (≈ 1 GLM-5.3-flash
// console-mix request). Converts per-model caps + burn into one currency:
// allowedMsgs = cap / observed $/msg (runway in own-mix requests),
// usedSR/allowedSR = spend/cap in SR. Day-window only, like perRoute.
const SR = 0.01;
const srRoutes = perRoute.filter(r => r.provider === 'opencode-go' && GO[fam(r.model)]).map(r => {
  const g = GO[fam(r.model)];
  const costPerMsg = r.msgs ? r.usd / r.msgs : 0;
  return {
    model: r.model, msgs: r.msgs, usd: r.usd, cap: g.cap,
    costPerMsg: +costPerMsg.toFixed(5),
    allowedMsgs: costPerMsg > 0 ? Math.floor(g.cap / costPerMsg) : null,
    usedSR: Math.round(r.usd / SR), allowedSR: Math.round(g.cap / SR),
  };
});
const standardReq = {
  unit: '$0.01 of model spend (~1 GLM-5.3-flash console-mix request)',
  routes: srRoutes,
  allowedSR: srRoutes.reduce((a, r) => a + r.allowedSR, 0),
  usedSR: srRoutes.reduce((a, r) => a + r.usedSR, 0),
};
standardReq.pct = standardReq.allowedSR ? +(100 * standardReq.usedSR / standardReq.allowedSR).toFixed(1) : 0;
// --- free-shelf halt detection ---
const freeToday = perRoute.filter(r => /-free$/.test(r.model.split('/').pop()));
const freeLast = freeToday.length ? freeToday.map(r => r.last).sort().pop() : null;
const paidLast = perRoute.filter(r => !/-free$/.test(r.model.split('/').pop())).map(r => r.last).sort().pop() || null;

const result = {
  generated_at: new Date().toISOString(), date: DATE,
  totals: { msgs: tot.msgs, inM: +tot.inM.toFixed(1), outM: +tot.outM.toFixed(2), cacheM: +tot.cacheM.toFixed(1), cacheShare: tot.inM + tot.cacheM ? +(tot.cacheM / (tot.inM + tot.cacheM)).toFixed(2) : 0 },
  perRoute,
  peakHour: peak[0] || null, peakMsgs: peak[1] ? +peak[1] : 0,
  pins: pins.map(a => a.model), deadPins,
  errors429: { count: errors429.length, first: errors429[0]?.ts || null, last: errors429[errors429.length - 1]?.ts || null, models: errModels },
  freeShelf: { routes: freeToday.map(r => ({ model: r.model, msgs: r.msgs, last: r.last })), lastActivity: freeLast, paidContinuesAfter: paidLast },
  goHeadroom: flashMsgs ? { family: 'glm-5.3-flash', msgs: flashMsgs, costPerDay: flashGo ? +flashGo.cost.toFixed(2) : null, cap: flashGo?.cap || null, capPct: flashGo ? +(flashGo.pct * 100).toFixed(1) : null } : null,
  unmatchedCheckPins: unmatched,
  snapshotAges: snapAges,
  pacing,
  metered,
  standardReq,
  routing: Object.fromEntries(Object.entries(ROUTES).map(([a, r]) => [a, { ...r, primaryLive: !deadPins.some(d => d.model === r.primary || d.model === r.primary.split('/').pop()) }])),
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtM = v => v >= 1 ? v.toFixed(1) : v.toFixed(2);
// group dead pins by model so the cell doesn't repeat the same ID
const deadByModel = {};
for (const d of result.deadPins) (deadByModel[d.model] = deadByModel[d.model] || []).push(d.where);
// §1 dashboard tbody
const deadCell = result.deadPins.length
  ? Object.entries(deadByModel).map(([m, w]) => `<code>${esc(m)}</code> ×${w.length} (${esc(w.join(', '))})`).join('; ') + ` — <span class="warn"><b>DEAD</b> (not on free shelf ${esc(DATE)})</span>`
  : 'all pins resolve';
const burnCell = result.totals.msgs
  ? `${result.totals.msgs.toLocaleString('en-US')} msgs · ${(result.totals.inM / Math.max(1, result.totals.msgs) * 1000).toFixed(0)}K in + ${(result.totals.cacheM / Math.max(1, result.totals.msgs) * 1000).toFixed(0)}K cached + ${(result.totals.outM / Math.max(1, result.totals.msgs) * 1000).toFixed(1)}K out per msg (${Math.round(result.totals.cacheShare * 100)}% cache-read) · peak ${result.peakMsgs}/hr ${esc((result.peakHour || '').slice(11))} UTC`
  : 'no assistant traffic recorded';
const limCell = [
  result.freeShelf.lastActivity ? `free shelf quiet since ${esc(result.freeShelf.lastActivity.slice(11, 16))} UTC` : null,
  result.errors429.count ? `NVIDIA/API 429s ${result.errors429.count}× ${esc((result.errors429.first || '').slice(11, 19))}→${esc((result.errors429.last || '').slice(11, 19))} UTC (${esc(result.errors429.models.join(', '))})` : 'no 429s in log window',
].filter(Boolean).join('; ');
const goCell = result.goHeadroom
  ? `glm-5.3-flash loop ${result.goHeadroom.msgs} msgs ≈ $${result.goHeadroom.costPerDay} of $${result.goHeadroom.cap} cap (~${result.goHeadroom.capPct}%)`
  : 'no glm-5.3-flash traffic today';
const dashTbody = `<tbody>
<tr><td><b>Pins</b></td><td>${deadCell}</td><td>Re-pin dead IDs (§9), restart opencode</td></tr>
<tr><td><b>Today's burn</b> (${esc(DATE)})</td><td>${burnCell}</td><td>Pace loops &lt;2 req/min</td></tr>
<tr><td><b>Limits hit</b></td><td>${limCell}; fallback routes kept working</td><td>Move loop volume to a Go route</td></tr>
<tr><td><b>Go headroom</b> ($10/mo)</td><td>${goCell}</td><td>Reviewer → <code>opencode-go/glm-5.3-flash</code>, keep free fallback</td></tr>
</tbody>`;
// §8 usage tbody (top routes by msgs)
const roleOf = (m) => /glm-5.3-flash-free/.test(m) ? 'capped free route' : /space-bunny|minimax-m3.1-flash|glm-5.3-flash/.test(m) ? 'reviewer' : /nemotron-3.5-super/.test(m) ? 'researcher fallback' : 'mixed';
const usageRows = [...perRoute].sort((a, b) => b.msgs - a.msgs).slice(0, 6).map(r => {
  const g = GO[fam(r.model)];
  const equiv = g ? `~$${(r.inM * g.p[0] + (r.outM + r.reasM) * g.p[1] + r.cacheM * g.p[2]).toFixed(1)} on Go` : '$0';
  return `<tr><td><code>${esc(r.model)}</code></td><td class="num">${r.msgs}</td><td class="num">${fmtM(r.inM)}</td><td class="num">${fmtM(r.cacheM)}</td><td class="num">${equiv}</td><td class="num">${r.failPct}%</td><td class="num">${r.p50s ?? '—'}</td><td>${roleOf(r.model)}</td></tr>`;
}).join('\n');
const usageTbody = `<tbody>\n${usageRows}\n</tbody>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.error(`wrote ${OUT}`);
fs.writeFileSync(path.join(path.dirname(OUT), `routing-${DATE}.json`), JSON.stringify({ generated_at: result.generated_at, source_snapshot: path.basename(OUT), agents: result.routing }, null, 2));
console.error(`wrote routing-${DATE}.json`);

if (has('--html')) {
  const html = `<!-- DASHBOARD-TBODY (generated ${DATE}, do not hand-edit; see scripts/dashboard.mjs) -->\n${dashTbody}\n<!-- USAGE-TBODY (generated ${DATE}) -->\n${usageTbody}\n`;
  fs.writeFileSync(arg('--html'), html);
  console.error(`wrote ${arg('--html')}`);
}
if (has('--write-guide')) {
  const gp = arg('--write-guide');
  let html = fs.readFileSync(gp, 'utf8');
  for (const [id, body] of [['dashboard', `<!-- DASHBOARD-TBODY (generated ${DATE}; do not hand-edit — see scripts/dashboard.mjs) -->\n${dashTbody}`], ['usage', `<!-- USAGE-TBODY (generated ${DATE}; do not hand-edit) -->\n${usageTbody}`]]) {
    const tag = `<h2 id="${id}">`;
    if (html.split(tag).length !== 2) throw new Error(`anchor ${tag} must occur exactly once`);
    const h = html.indexOf(tag);
    const bs = html.indexOf('<tbody>', h);
    if (bs === -1) throw new Error(`no tbody after ${tag}`);
    const be = html.indexOf('</tbody>', bs) + '</tbody>'.length;
    html = html.slice(0, bs) + body + html.slice(be);
  }
  fs.writeFileSync(gp, html);
  console.error(`updated ${gp}`);
}
if (!has('--out') && !has('--html') && !has('--write-guide')) console.log(JSON.stringify(result, null, 2));
