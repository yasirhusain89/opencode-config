#!/usr/bin/env node
// Compose the guide runtime payload from curated content + live snapshots.
// Writes <skill>/data.js (window.__MB__). The Svelte shell reads it at load
// time, so a data refresh needs NO rebuild. Run after dashboard.mjs.
//
// Inputs:
//   content/guide.json                 curated sections (prose + non-live tables)
//   snapshots/dashboard-YYYY-MM-DD.json  newest by filename date
//   snapshots/routing-YYYY-MM-DD.json    matching date
// Output:
//   data.js  →  { meta, toc, sections } with §1 / §8 / §9 rows replaced
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SNAP = path.join(ROOT, 'snapshots');
const CONTENT = path.join(ROOT, 'content/guide.json');
const OUT = path.join(ROOT, 'data.js');

const guide = JSON.parse(fs.readFileSync(CONTENT, 'utf8'));

const latest = (re) =>
  fs.readdirSync(SNAP).filter((f) => re.test(f)).sort().pop();
const dashFile = latest(/^dashboard-\d{4}-\d{2}-\d{2}\.json$/);
if (!dashFile) throw new Error('no dashboard snapshot in ' + SNAP);
const dash = JSON.parse(fs.readFileSync(path.join(SNAP, dashFile), 'utf8'));
if (!dash.goPrices) throw new Error(`${dashFile} lacks goPrices — regenerate it with dashboard.mjs`);
const routeFile = path.join(SNAP, `routing-${dash.date}.json`);
const routing = fs.existsSync(routeFile) ? JSON.parse(fs.readFileSync(routeFile, 'utf8')) : null;
if (!routing) console.warn(`no ${path.basename(routeFile)} — §9 pins stay at the last curated values`);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtM = (v) => (v >= 1 ? v.toFixed(1) : v.toFixed(2));
// family key — same normalization as dashboard.mjs fam()
function fam(modelId) {
  let s = String(modelId || '').split('/').pop().toLowerCase();
  for (const suf of ['-contributor-free', '-free', '-nightly', '-exp']) if (s.endsWith(suf)) s = s.slice(0, -suf.length);
  const d = s.match(/^(.*)-\d{4}$/);
  if (d) s = d[1];
  return s;
}
const cell = (h, extra = {}) => ({ h: String(h), ...extra });
const table = (id) => guide.sections.find((s) => s.id === id)?.blocks.find((b) => b.t === 'table');
const setRows = (id, rows, head) => {
  const t = table(id);
  if (!t) throw new Error('no table in section ' + id);
  t.rows = rows;
  if (head) t.head = head;
};

// meta: snapshot date follows the dashboard
guide.meta.snapshot = dash.date;
guide.meta.meta = guide.meta.meta.replace(/Snapshot \d{4}-\d{2}-\d{2}/, `Snapshot ${dash.date}`);

// §1 decision dashboard
const deadByModel = {};
for (const d of dash.deadPins) (deadByModel[d.model] = deadByModel[d.model] || []).push(d.where);
const deadCell = dash.deadPins.length
  ? Object.entries(deadByModel)
      .map(([m, w]) => `<code>${esc(m)}</code> ×${w.length} (${esc(w.join(', '))})`)
      .join('; ') + ` — <span class="warn"><b>DEAD</b> (not in the ${esc(dash.date)} catalog)</span>`
  : 'all pins resolve';
const burnCell = dash.totals.msgs
  ? `${dash.totals.msgs.toLocaleString('en-US')} msgs · ${((dash.totals.inM / Math.max(1, dash.totals.msgs)) * 1000).toFixed(0)}K in + ${((dash.totals.cacheM / Math.max(1, dash.totals.msgs)) * 1000).toFixed(0)}K cached + ${((dash.totals.outM / Math.max(1, dash.totals.msgs)) * 1000).toFixed(1)}K out per msg (${Math.round(dash.totals.cacheShare * 100)}% cache-read) · peak ${dash.peakMsgs}/hr ${esc((dash.peakHour || '').slice(11))} UTC`
  : 'no assistant traffic recorded';
const limCell = [
  dash.freeShelf.lastActivity ? `free shelf quiet since ${esc(dash.freeShelf.lastActivity.slice(11, 16))} UTC` : null,
  dash.errors429.count
    ? `NVIDIA/API 429s ${dash.errors429.count}× ${esc((dash.errors429.first || '').slice(11, 19))}→${esc((dash.errors429.last || '').slice(11, 19))} UTC (${esc(dash.errors429.models.join(', '))})`
    : 'no 429s in log window',
].filter(Boolean).join('; ');
const goTop = dash.goTop || dash.goHeadroom;
const goCell = goTop
  ? `${goTop.family} loop ${goTop.msgs} msgs ≈ $${goTop.costPerDay} of $${goTop.cap} cap (~${goTop.capPct}%)`
  : 'no Go traffic today';
setRows('dashboard', [
  [cell('<b>Pins</b>'), cell(deadCell), cell('Re-pin dead IDs (§9), restart opencode')],
  [cell(`<b>Today's burn</b> (${esc(dash.date)})`), cell(burnCell), cell('Pace loops &lt;2 req/min')],
  [cell('<b>Limits hit</b>'), cell(`${limCell}; fallback routes kept working`), cell('Move loop volume to a Go route')],
  [cell('<b>Go headroom</b> ($10/mo)'), cell(goCell), cell('Reviewer → <code>opencode-go/glm-5.3-flash</code>, keep free fallback')],
]);

// §8 usage — top routes by msgs
const roleOf = (m) =>
  /glm-5.3-flash-free/.test(m) ? 'capped free route'
  : /space-bunny|minimax-m3.1-flash|glm-5.3-flash/.test(m) ? 'reviewer'
  : /nemotron-3.5-super/.test(m) ? 'researcher fallback'
  : 'mixed';
const usageRows = [...dash.perRoute].sort((a, b) => b.msgs - a.msgs).slice(0, 6).map((r) => {
  const g = dash.goPrices?.[fam(r.model)];
  const equiv = g ? `~$${(r.inM * g.p[0] + (r.outM + r.reasM) * g.p[1] + r.cacheM * g.p[2]).toFixed(1)} on Go` : '$0';
  return [
    cell(`<code>${esc(r.model)}</code>`),
    cell(r.msgs, { n: 1 }),
    cell(fmtM(r.inM), { n: 1 }),
    cell(fmtM(r.cacheM), { n: 1 }),
    cell(equiv, { n: 1 }),
    cell(`${r.failPct}%`, { n: 1 }),
    cell(r.p50s ?? '—', { n: 1 }),
    cell(roleOf(r.model)),
  ];
});
const usageHead = table('usage').head;
usageHead[0].h = `Route (${esc(dash.date)})`;
setRows('usage', usageRows, usageHead);

// §9 pins — one row per configured agent, from the routing artifact.
// The Pick cell is live; the Why cell prefers the curated rationale already
// in content/guide.json (richer than routing.why) and falls back to routing.
if (routing) {
  const recTable = table('recs');
  const curatedWhy = {};
  for (const row of recTable.rows) {
    const agent = row[0].h.replace(/<[^>]*>/g, '').trim();
    if (agent in routing.agents) curatedWhy[agent] = row[2]?.h;
  }
  const rows = Object.entries(routing.agents).map(([agent, r]) => {
    const fallback = r.fallback ? ` (+ <code>${esc(r.fallback)}</code> fallback)` : '';
    return [
      cell(agent),
      cell(`<code>${esc(r.primary)}</code>${fallback}`),
      cell(curatedWhy[agent] || esc(r.why)),
    ];
  });
  setRows('recs', rows, recTable.head);
}

fs.writeFileSync(OUT, 'window.__MB__ = ' + JSON.stringify(guide) + ';\n');
const nRows = guide.sections.reduce((a, s) => a + s.blocks.filter((b) => b.t === 'table').reduce((x, b) => x + b.rows.length, 0), 0);
console.log(`wrote ${path.relative(process.cwd(), OUT)} (${dashFile}, ${dash.date}; ${guide.sections.length} sections, ${nRows} rows)`);
