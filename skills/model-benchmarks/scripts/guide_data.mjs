#!/usr/bin/env node
// Compose the guide runtime payload from curated content + live snapshots.
// Writes <skill>/data.js (window.__MB__). The Svelte shell reads it at load
// time, so a data refresh needs NO rebuild. Run after dashboard.mjs.
//
// Inputs:
//   content/guide.json                 curated sections (prose + non-live tables)
//   snapshots/dashboard-YYYY-MM-DD.json  newest by filename date
//   snapshots/routing-YYYY-MM-DD.json    matching date
//   snapshots/check-*.json / coding-index-*.json / access-*.json (newest + prev)
// Output:
//   data.js  →  { meta, toc, sections } with §1 / §2 / §6 / §8 / §9 rows replaced
//
// Quota semantics (P0): `-free` rows never burn Go quota or per-model caps.
// They sit in a separate free pool with tighter limits; NVIDIA is the slow
// last resort (p50 ~37s vs ~7s on Go). Gap math is same-vintage only:
// cross-vintage subtractions are misleading and get a stale badge instead.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SNAP = path.join(ROOT, 'snapshots');
const CONTENT = path.join(ROOT, 'content/guide.json');
const OUT = path.join(ROOT, 'data.js');

const guide = JSON.parse(fs.readFileSync(CONTENT, 'utf8'));

const latest = (re) =>
  fs.readdirSync(SNAP).filter((f) => re.test(f)).sort().pop();
const sorted = (re) =>
  fs.readdirSync(SNAP).filter((f) => re.test(f)).sort();
const dashFile = latest(/^dashboard-\d{4}-\d{2}-\d{2}\.json$/);
if (!dashFile) throw new Error('no dashboard snapshot in ' + SNAP);
const dash = JSON.parse(fs.readFileSync(path.join(SNAP, dashFile), 'utf8'));
if (!dash.goPrices) throw new Error(`${dashFile} lacks goPrices — regenerate it with dashboard.mjs`);
const routeFile = path.join(SNAP, `routing-${dash.date}.json`);
const routing = fs.existsSync(routeFile) ? JSON.parse(fs.readFileSync(routeFile, 'utf8')) : null;
if (!routing) console.warn(`no ${path.basename(routeFile)} — §9 pins stay at the last curated values`);

// --- snapshot helpers (P1 freshness + diffs) ---
const loadSnap = (f) => { try { return JSON.parse(fs.readFileSync(path.join(SNAP, f), 'utf8')); } catch { return null; } }; 
const checkFiles = sorted(/^check-\d{4}-\d{2}-\d{2}\.json$/);
const accessFiles = sorted(/^access-\d{4}-\d{2}-\d{2}\.json$/);
const codingFiles = sorted(/^coding-index-\d{4}-\d{2}-\d{2}\.json$/);
const checkFile = checkFiles[checkFiles.length - 1];
const prevCheckFile = checkFiles.length > 1 ? checkFiles[checkFiles.length - 2] : null;
const accessFile = accessFiles[accessFiles.length - 1];
// Previous access WITH an opencode-go catalog (older snapshots predate the
// provider split and would diff the whole plan as "new").
const prevAccessFile = [...accessFiles].reverse().find((f) => {
  if (f === accessFile) return false;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(SNAP, f), 'utf8'));
    return Array.isArray(j.providers?.['opencode-go']) && j.providers['opencode-go'].length > 0;
  } catch { return false; }
}) || null;
const codingFile = codingFiles[codingFiles.length - 1];
const check = checkFile ? loadSnap(checkFile) : null;
const prevCheck = prevCheckFile ? loadSnap(prevCheckFile) : null;
const access = accessFile ? loadSnap(accessFile) : null;
const prevAccess = prevAccessFile ? loadSnap(prevAccessFile) : null;
const coding = codingFile ? loadSnap(codingFile) : null;

// --- Stage 1 mini-eval probe snapshots (snapshots/evals/*/probe-summary.json) ---
const EVALS_DIR = path.join(SNAP, 'evals');
const probeByModel = new Map(); // exact 'provider/model' -> record
const probeByFam = new Map();   // normFam(fam(id)) -> record (prefers exact Go route, else newest)
let latestProbeDate = null;
if (fs.existsSync(EVALS_DIR)) {
  const evalDirs = fs.readdirSync(EVALS_DIR).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  for (const d of evalDirs) {
    const pFile = path.join(EVALS_DIR, d, 'probe-summary.json');
    if (!fs.existsSync(pFile)) continue;
    try {
      const pj = JSON.parse(fs.readFileSync(pFile, 'utf8'));
      latestProbeDate = pj.date || d;
      for (const [mId, rec] of Object.entries(pj.models || {})) {
        probeByModel.set(mId, rec);
      }
    } catch { /* ignore malformed */ }
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtM = (v) => (v >= 1 ? v.toFixed(1) : v.toFixed(2));
// family key — same normalization as dashboard.mjs fam()
function fam(modelId) {
  let s = String(modelId || '').split('/').pop().toLowerCase();
  for (const suf of ['-contributor-free', '-free', '-nightly', '-exp']) if (s.endsWith(suf)) s = s.slice(0, -suf.length);
  const d = s.match(/^(.*)-\d{4}$/); if (d) s = d[1];
  return s;
}
const isFreeId = (id) => /-free$/i.test(String(id || '').split('/').pop());
// slug/family join key: dots, dashes, spaces and case are the same family
// (kimi-k3.1-pro vs kimi-k3-1-pro vs "Kimi K3.1 Pro"). Normalized to
// lowercase dash-joined alphanumerics so AA display names, slugs and live
// model IDs all meet on one key.
const normFam = (s) => String(s || '').toLowerCase().replace(/[.]/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
for (const [mId, rec] of probeByModel) {
  const fk = normFam(fam(mId));
  if (!probeByFam.has(fk) || String(mId).startsWith('opencode-go/')) {
    probeByFam.set(fk, rec);
  }
}
const cell = (h, extra = {}) => ({ h: String(h), ...extra });
const table = (id) => guide.sections.find((s) => s.id === id)?.blocks.find((b) => b.t === 'table');
const setRows = (id, rows, head) => {
  const t = table(id);
  if (!t) throw new Error('no table in section ' + id);
  t.rows = rows;
  if (head) t.head = head;
};

// --- AA lookups (same-vintage gap math only) ---
// Display names carry effort/harness suffixes ("(high)", "(max)") and vendor
// prefixes ("Tencent Hy4" vs Go "hy4"); slugs use dashes where families use
// dots. Exact normFam match first, then prefix either way, then aliases.
const FAM_ALIAS = { hy4: 'tencent-hy4', 'hy4-preview': 'tencent-hy4' };
// Effort/harness suffixes from AA display names ("(high)", "(max with
// fallback)") — stripped for family matching. NOT "-preview": that is part
// of the model name (hy4-preview, step-5-preview).
const stripEffort = (k) => String(k || '').replace(/-(xhigh|high|max-with-fallback|max-default-fallback|max|with-fallback)$/, '');
const lookupByFam = (map, k) => {
  if (map.has(k)) return map.get(k);
  if (FAM_ALIAS[k] && map.has(FAM_ALIAS[k])) return map.get(FAM_ALIAS[k]);
  for (const [key, v] of map) {
    if (stripEffort(key) === k) return v;
  }
  return null;
};
const intelByFam = new Map();   // normFam -> {intel, slug, display, priceIn, priceOut}
const intelVintageByFam = new Map();
if (check?.models) {
  for (const m of check.models) {
    const k = normFam(m.slug || m.display_name);
    if (m.intelligence != null) {
      intelByFam.set(k, {
        intel: m.intelligence, slug: m.slug, display: m.display_name,
        priceIn: m.input, priceOut: m.output,
      });
      intelVintageByFam.set(k, check.scraped_at);
    }
  }
}
// Fallback to the previous pull for families the latest scrape did not cover
// (e.g. kimi-k3, deepseek-v4.1-flash). Freshness bar + column tip carry the
// vintage; a missing latest score is never silently presented as current.
if (prevCheck?.models) {
  for (const m of prevCheck.models) {
    const k = normFam(m.slug || m.display_name);
    if (m.intelligence != null && !intelByFam.has(k)) {
      intelByFam.set(k, {
        intel: m.intelligence, slug: m.slug, display: m.display_name,
        priceIn: m.input, priceOut: m.output,
      });
      intelVintageByFam.set(k, prevCheck.scraped_at);
    }
  }
}
const engByFam = new Map();     // normFam -> {eng, name, vintage}
const engVintage =
  (check?.engineering?.length ? check.scraped_at : null) ||
  (prevCheck?.engineering?.length ? prevCheck.scraped_at : null) || null;
const engSource = (check?.engineering?.length ? check : prevCheck);
if (engSource?.engineering) {
  for (const e of engSource.engineering) {
    const k = normFam(e.name);
    if (e.engineering != null) engByFam.set(k, { eng: e.engineering, name: e.name, vintage: engSource.scraped_at });
  }
}
// CAI / agentic signal from the newest coding-index (partial ok, flagged)
const caiByFam = new Map();
if (coding?.benchmarks) {
  // benchmarks shape varies (SWE-Atlas-QnA object or null); keep raw for display
}
const goFams = new Set(
  (access?.providers?.['opencode-go'] || []).map((id) => normFam(fam(id)))
);
const intelVintage = check?.scraped_at || null;
const intelPartial = !!check?.partial;

// gap: frontier best vs Go best, SAME vintage only
function bestIntel(famSet) {
  let best = null;
  const inSet = (k) => {
    if (!famSet) return true;
    if (famSet.has(k)) return true;
    if (FAM_ALIAS[k] && famSet.has(FAM_ALIAS[k])) return true;
    for (const f of famSet) {
      if (stripEffort(k) === f || stripEffort(f) === stripEffort(k)) return true;
    }
    return false;
  };
  for (const [k, v] of intelByFam) {
    if (!inSet(k)) continue;
    if (!best || v.intel > best.intel) best = { ...v, fam: k };
  }
  return best;
}
const frontierIntel = bestIntel(null);
const goIntel = bestIntel(goFams);
function bestEng(famSet) {
  let best = null;
  const inSet = (k) => {
    if (!famSet) return true;
    if (famSet.has(k)) return true;
    for (const f of famSet) {
      if (stripEffort(k) === f || stripEffort(f) === stripEffort(k)) return true;
    }
    return false;
  };
  for (const [k, v] of engByFam) {
    if (/no-publicly-available-api/.test(k)) continue; // chart placeholder, not a model
    if (!inSet(k)) continue;
    if (!best || v.eng > best.eng) best = { ...v, fam: k };
  }
  return best;
}
const frontierEng = bestEng(null);
const goEng = bestEng(goFams);

// --- diffs: what's new since the previous pull ---
const goNow = new Set(access?.providers?.['opencode-go'] || []);
const goPrev = new Set(prevAccess?.providers?.['opencode-go'] || []);
const newOnGo = [...goNow].filter((m) => !goPrev.has(m)).sort();
const removedFromGo = [...goPrev].filter((m) => !goNow.has(m)).sort();
const slugNow = new Set((check?.models || []).map((m) => m.slug));
const slugPrev = new Set((prevCheck?.models || []).map((m) => m.slug));
const newOnAA = [...slugNow].filter((s) => !slugPrev.has(s)).sort();

// --- freshness bar ---
const freshBits = [
  `Intel/price: ${esc(intelVintage || '—')}${intelPartial ? ' (partial — Eng tabs timed out)' : ''}`,
  `Eng: ${esc(engVintage || '— (stale — re-pull pending)')}`,
  `CAI: ${esc(coding?.scraped_at || '—')}${coding?.partial ? ' (partial)' : ''}`,
  `Catalogs: ${esc(access?.scraped_at || '—')}`,
  ...(latestProbeDate ? [`Mini-eval: ${esc(latestProbeDate)} (${probeByModel.size} models quantified)`] : []),
  `Dashboard: ${esc(dash.date)}`,
];
const refreshCmd = `<code>node scripts/aa_bench.mjs check &lt;slugs&gt; --out /tmp/aa_check.json</code>`;

// --- §1 decision dashboard (P1: gap + launch + freshness, no broken V1 burn) ---
const deadByModel = {};
for (const d of dash.deadPins) (deadByModel[d.model] = deadByModel[d.model] || []).push(d.where);
const deadCell = dash.deadPins.length
  ? Object.entries(deadByModel)
      .map(([m, w]) => `<code>${esc(m)}</code> ×${w.length} (${esc(w.join(', '))})`)
      .join('; ') + ` — <span class="warn"><b>DEAD</b> (not in the ${esc(dash.date)} catalog)</span>`
  : 'all pins resolve';
const gapCell = (frontierIntel && goIntel)
  ? `Intel ${frontierIntel.intel} (${esc(frontierIntel.display || frontierIntel.slug)}) vs Go ${goIntel.intel} (${esc(goIntel.display || goIntel.slug)}) — <b>−${frontierIntel.intel - goIntel.intel} pts</b> same-vintage (${esc(intelVintage)})` +
    (frontierEng && goEng
      ? ` · Eng ${frontierEng.eng} vs Go ${goEng.eng} — <b>−${frontierEng.eng - goEng.eng} pts</b> (${esc(engVintage)} vintage)`
      : ` · Eng vintage ${esc(engVintage || 'stale')} — re-pull pending, no gap math`)
  : 'insufficient AA coverage for gap math';
const newBits = [];
if (newOnGo.length) newBits.push(`Go +${newOnGo.length}: ${newOnGo.slice(0, 6).map((m) => `<code>${esc(m.split('/').pop())}</code>`).join(', ')}${newOnGo.length > 6 ? ` +${newOnGo.length - 6} more` : ''}`);
if (newOnAA.length) newBits.push(`AA +${newOnAA.length}: ${newOnAA.slice(0, 6).map(esc).join(', ')}${newOnAA.length > 6 ? ` +${newOnAA.length - 6} more` : ''}`);
if (removedFromGo.length) newBits.push(`Go −${removedFromGo.length}: ${removedFromGo.slice(0, 4).map((m) => `<code>${esc(m.split('/').pop())}</code>`).join(', ')}`);
const newCell = newBits.length ? newBits.join(' · ') : 'no catalog/AA changes since last pull';
const goTop = dash.goTop || dash.goHeadroom;
const goCell = goTop
  ? `${goTop.family} loop ${goTop.msgs} msgs ≈ $${goTop.costPerDay} of $${goTop.cap} cap (~${goTop.capPct}%)`
  : 'no Go traffic today';
const limCell = [
  dash.freeShelf.lastActivity ? `free shelf quiet since ${esc(dash.freeShelf.lastActivity.slice(11, 16))} UTC` : null,
  dash.errors429.count
    ? `NVIDIA/API 429s ${dash.errors429.count}× ${esc((dash.errors429.first || '').slice(11, 19))}→${esc((dash.errors429.last || '').slice(11, 19))} UTC (${esc(dash.errors429.models.join(', '))})`
    : 'no 429s in log window',
].filter(Boolean).join('; ');
setRows('dashboard', [
  [cell('<b>Pins</b>'), cell(deadCell), cell('Re-pin dead IDs (§9), restart opencode')],
  [cell('<b>Provider gap</b> (same-vintage)'), cell(gapCell), cell('Go trails frontier on general Intel; Eng/CAI gap is small — keep loop volume on Go')],
  [cell('<b>What\u2019s new</b>'), cell(newCell), cell('Evaluate new Go arrivals (§6) before pinning; confirm free-pool vs quota tier')],
  [cell('<b>Data freshness</b>'), cell(`${freshBits.join(' · ')} · refresh: ${refreshCmd}`), cell('Re-pull on new AA version, new model wave, or 30d staleness')],
  [cell('<b>Go headroom</b> ($10/mo)'), cell(goCell), cell('Reviewer → <code>opencode-go/glm-5.3-flash</code>; low-stakes → free pool first, NVIDIA last')],
  [cell('<b>Limits hit</b>'), cell(`${limCell}; fallback routes kept working`), cell('Free pool has own limits; NVIDIA is slow — prefer waiting for the free reset')],
]);

// --- §2 master: add live "Available" badges (family-key join, no silent rows) ---
{
  const t = table('master');
  if (t) {
    const availHead = { h: 'Available ⇅', s: 't', tip: 'Live provider availability from the newest access snapshot, joined on model family. Go = on the $10/mo plan · OC Free = opencode/*-free pool · NV = NVIDIA trial/slow lane · OR = OpenRouter BYOK alias.' };
    if (!t.head.some((h) => /Available/.test(h.h))) t.head = [...t.head, availHead];
    const providers = access?.providers || {};
    const hasFam = (prov, famNorm) =>
      (providers[prov] || []).some((id) => normFam(fam(id)) === famNorm);
    const hasOR = (famNorm) =>
      (providers.openrouter || []).some((id) => normFam(id).includes(famNorm) || famNorm.includes(normFam(id.split('/').pop())));
    t.rows = t.rows.map((r) => {
      if (r.length > t.head.length - 1 && /tag|Go \\$10|OC Free/.test(r[r.length - 1]?.h || '')) return r;
      const name = (r[0]?.h || '').replace(/<[^>]*>/g, '');
      const nk = normFam(name.replace(/[^a-z0-9.+-]+/gi, '-'));
      // match: a live Go family appearing as a token run in the row text
      // (or vice versa for contributor-suffixed IDs). Length guards stop
      // short stems ("gpt-6") matching siblings ("gpt-6-astra" vs "gpt-6-luna").
      const matchFam = [...goFams].find((g) => (g.length >= 6 && nk.includes(g)) || (nk.length >= 10 && g.includes(nk)));
      const badges = [];
      if (matchFam) {
        badges.push('<span class="tag">Go $10</span>');
        if (hasFam('opencode-go', matchFam) && (access.providers['opencode-go'] || []).some((id) => isFreeId(id) && normFam(fam(id)) === matchFam)) badges.push('<span class="tag">Go-free</span>');
      }
      // free-pool / nvidia presence for the same family (same guards)
      const freeFams = new Set([...(providers.opencode || [])].filter(isFreeId).map((id) => normFam(fam(id))));
      if ([...freeFams].some((g) => matchFam ? g === matchFam : ((g.length >= 6 && nk.includes(g)) || (nk.length >= 10 && g.includes(nk))))) badges.push('<span class="tag">OC Free</span>');
      const nvIds = providers.nvidia || [];
      if (matchFam && nvIds.some((id) => normFam(id).includes(matchFam))) badges.push('<span class="tag">NV</span>');
      if (!badges.length && hasOR(matchFam || nk)) badges.push('<span class="tag">OR</span>');
      const pinned = routing && Object.values(routing.agents || {}).some((a) => a.primary && normFam(fam(a.primary)) === matchFam);
      if (pinned) badges.push('<span class="tag">PINNED</span>');
      const isNew = matchFam && newOnGo.some((id) => normFam(fam(id)) === matchFam);
      const newBadge = isNew ? ' <span class="tag">NEW</span>' : '';
      const base = r.length === t.head.length ? r.slice(0, -1) : r;
      return [...base, cell(badges.length ? badges.join(' ') + newBadge : '—' + newBadge)];
    });
    t.head[0].h = `Model (effort/harness) ⇅`;
    const sec = guide.sections.find((s) => s.id === 'master');
    if (sec && !/Available/.test(sec.title)) sec.title = sec.title.replace(/<span class="tag">.*<\/span>/, '<span class="tag">AA 10-24 Eng · 11-22 Intel · live availability</span>');
  }
}

// --- §6 Go catalog: all 33 routes, tiered for software building (P2) ---
{
  const goIds = [...(access?.providers?.['opencode-go'] || [])].sort();
  const pinByFam = new Map();
  if (routing) {
    for (const [agent, r] of Object.entries(routing.agents || {})) {
      const k = normFam(fam(r.primary));
      if (!pinByFam.has(k)) pinByFam.set(k, []);
      pinByFam.get(k).push(agent);
    }
  }
  const tierOf = (id) => {
    if (isFreeId(id)) return { group: 'Free pool', order: 4 };
    const cap = dash.goPrices?.[fam(id)]?.cap;
    if (cap == null) return { group: 'Unpriced', order: 5 };
    if (cap <= 30) return { group: 'Apex reasoning', order: 1 };
    return { group: 'Workhorse', order: 2 };
  };
  const agenticNote = (k) => {
    // newest coding-index is partial (SWE-Atlas-QnA only); surface time/cost
    // rows when the family appears, else —
    if (!coding) return '—';
    const hit = [...Object.keys(coding.time_per_task || {}), ...Object.keys(coding.cost_per_task || {})]
      .find((h) => normFam(h).includes(k) || k.includes(normFam(h).split(' ').slice(0, 2).join('-')));
    return hit ? esc(hit.split(' - ')[0].slice(0, 28)) : '—';
  };
  const rows = goIds.map((id) => {
    const short = id.split('/').pop();
    const k = normFam(fam(id));
    const g = dash.goPrices?.[fam(id)];
    const intel = lookupByFam(intelByFam, k);
    const eng = lookupByFam(engByFam, k);
    const probe = probeByModel.get(id) || probeByFam.get(k) || null;
    const tier = tierOf(id);
    const pins = pinByFam.get(k);
    const isNew = newOnGo.includes(id);
    const probeBadge = probe ? ' <span class="tag">EVAL</span>' : '';
    const probeSummaryTxt = probe
      ? `Mini-eval ${probe.composite}/100 (${probe.tier}, C:${probe.tasks?.coding?.score ?? 0}/35 B:${probe.tasks?.bughunt?.score ?? 0}/35 L:${probe.tasks?.reasoning?.score ?? 0}/15 A:${probe.tasks?.agentic?.score ?? 0}/15, p50 ${probe.p50_s ?? '—'}s). `
      : '';
    const baseVerdict = isFreeId(id)
      ? 'Free pool — own limits, outside Go quota. Use first for low-stakes; spill to paid Go when capped.'
      : k.includes('kimi-k3-1-pro') ? 'Apex coder (Eng 55/Intel 46 same-vintage gap −19 Intel, −3 Eng). Main/plan candidate — confirm with mini-eval.'
      : k.includes('gemini-4-argon') ? 'DeepSWE leader (79) + CAI 64. Researcher/reviewer candidate on Go.'
      : k.includes('qwen4-max') ? 'NEW arrival (Intel 43). Unbenchmarked on Eng/CAI — needs AA + mini-eval before pinning.'
      : k.includes('hy4') ? 'NEW arrival (Intel 35). Unbenchmarked — evaluate before pinning.'
      : k.includes('glm-5-3-flash') ? 'Reviewer workhorse. Free pool first for low-stakes; paid Go for loop volume.'
      : k.includes('muse-spark-1-3') ? 'Global main pin. Balanced loop volume pick.'
      : k.includes('deepseek-v4-1-flash') ? 'Sustained loop headroom pick (verify peak/off-peak pricing).'
      : k.includes('grok-4-7') ? 'Apex but T-Bench-weak — keep off researcher; code-gen only with eval.'
      : 'On-plan route — match to role by Eng/Intel; mini-eval before pinning.';
    return [
      cell(`<code>${esc(short)}</code>${isNew ? ' <span class="tag">NEW</span>' : ''}${pins ? ' <span class="tag">PINNED</span>' : ''}${probeBadge}`),
      cell(tier.group),
      cell(eng ? String(eng.eng) : '—', { n: 1 }),
      cell(intel ? String(intel.intel) : '—', { n: 1 }),
      cell(probe ? `${probe.composite}` : '—', { n: 1, v: probe ? probe.composite : undefined }),
      cell(agenticNote(k)),
      cell(g ? `${g.p[0]} / ${g.p[1]} / ${g.p[2]}` : '—', { n: 1 }),
      cell(g ? `$${g.cap}` : (isFreeId(id) ? 'free pool' : '?'), { n: 1 }),
      cell(pins ? esc(pins.join(', ')) : '—'),
      cell(probeSummaryTxt + baseVerdict),
    ];
  }).sort((a, b) => {
    const order = { 'Apex reasoning': 1, Workhorse: 2, 'Free pool': 4, Unpriced: 5 };
    const strip = (h) => h.replace(/<[^>]*>/g, '').trim();
    const ga = strip(a[1].h), gb = strip(b[1].h);
    if ((order[ga] ?? 9) !== (order[gb] ?? 9)) return (order[ga] ?? 9) - (order[gb] ?? 9);
    const ia = parseFloat(a[3].h), ib = parseFloat(b[3].h);
    if (!isNaN(ib) && !isNaN(ia) && ib !== ia) return ib - ia;
    const ea = parseFloat(a[4].h), eb = parseFloat(b[4].h);
    if (!isNaN(eb) && !isNaN(ea) && eb !== ea) return eb - ea;
    return strip(a[0].h).localeCompare(strip(b[0].h));
  });
  setRows('goworkload', rows, [
    { h: 'Model ⇅', s: 't', tip: 'Live opencode-go catalog (newest access snapshot). NEW = added since the previous pull · PINNED = active agent pin · EVAL = local mini-eval quantified.' },
    { h: 'Group ⇅', s: 't', tip: 'Apex reasoning ($15–$30 nominal tier) · Workhorse ($60–$100) · Free pool (own tighter limits, outside Go quota).' },
    { h: 'Eng ⇅', n: 1, s: 'n', dir: 'desc', tip: `AA Engineering Index, ${engVintage || 'stale'} vintage. Same-vintage only — no cross-vintage gap math.` },
    { h: 'Intel ⇅', n: 1, s: 'n', dir: 'desc', tip: `AA Intelligence Index, ${intelVintage || '—'} vintage${intelPartial ? ' (partial pull)' : ''}.` },
    { h: 'Mini-eval ⇅', n: 1, s: 'n', dir: 'desc', tip: 'Stage 1 local deterministic probe composite (0–100: Coding 35 + BugHunt 35 + Logic 15 + Agentic 15). Full breakdown in §16.' },
    { h: 'Agentic', tip: 'Newest coding-index signal (partial ok). Scores are model×harness — transfer approximately.' },
    { h: 'Go $/1M', n: 1, tip: 'Nominal per-model tier (in/out/cached). Quota itself is request-scaled — see usage dashboard.' },
    { h: 'Cap', n: 1, tip: 'Nominal monthly tier. Binding layer is the rolling SR/request window, not dollars.' },
    { h: 'Pin', tip: 'Agents currently pinned to this family (live routing artifact).' },
    { h: 'Action', tip: 'What to do with this route: evaluate, pin, or keep as fallback.' },
  ]);
  const sec = guide.sections.find((s) => s.id === 'goworkload');
  if (sec) sec.title = `6. OpenCode Go catalog — all ${goIds.length} routes <span class="tag">live ${esc(access?.scraped_at || '')} · Intel ${esc(intelVintage || '')} · Eng ${esc(engVintage || '')}</span>`;
}

// meta: snapshot date follows the dashboard
guide.meta.snapshot = dash.date;
guide.meta.meta = guide.meta.meta.replace(/Snapshot \d{4}-\d{2}-\d{2}/, `Snapshot ${dash.date}`);

// §8 usage — top routes by msgs (free-pool equiv is $0, never Go spend)
const roleOf = (m) =>
  /glm-5.3-flash-free/.test(m) ? 'capped free route'
  : /space-bunny|minimax-m3.1-flash|glm-5.3-flash/.test(m) ? 'reviewer'
  : /nemotron-3.5-super/.test(m) ? 'researcher fallback'
  : 'mixed';
const usageRows = [...dash.perRoute].sort((a, b) => b.msgs - a.msgs).slice(0, 6).map((r) => {
  const g = isFreeId(r.model) ? null : dash.goPrices?.[fam(r.model)];
  const equiv = isFreeId(r.model) ? '$0 (free pool)' : g ? `~$${(r.inM * g.p[0] + (r.outM + r.reasM) * g.p[1] + r.cacheM * g.p[2]).toFixed(1)} on Go` : '$0';
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

// §4 free & cheap routes — enrich existing opencode/* rows with live mini-eval
// scores and append any live opencode free/stealth routes missing from the static table.
if (probeByModel.size > 0 || access?.providers?.opencode?.length) {
  const freeTable = table('free');
  if (freeTable) {
    const seenModels = new Set();
    const fmtEval = (p) =>
      `<b>Mini-eval ${p.composite}/100</b> (${esc(p.tier)} · C:${p.tasks?.coding?.score ?? 0}/35 B:${p.tasks?.bughunt?.score ?? 0}/35 L:${p.tasks?.reasoning?.score ?? 0}/15 A:${p.tasks?.agentic?.score ?? 0}/15 · ${p.delivered}/${p.attempted} · p50 ${p.p50_s ?? '—'}s${p.tok_per_s ? ` · ${p.tok_per_s} tps` : ''})`;
    freeTable.rows = freeTable.rows.map((r) => {
      const mMatch = (r[0]?.h || '').match(/<code>(opencode(?:-go)?\/[^<]+)<\/code>/);
      if (!mMatch) return r;
      const mId = mMatch[1];
      seenModels.add(mId);
      const fk = normFam(fam(mId));
      const p = probeByModel.get(mId) || probeByFam.get(fk);
      if (!p) return r;
      const badge = /EVAL/.test(r[0].h) ? '' : ' <span class="tag">EVAL</span>';
      const prevSig = (r[3]?.h || '').replace(/unevaluated/i, '').replace(/^;\s*|;\s*$/g, '').trim();
      return [
        cell(r[0].h + badge),
        r[1],
        r[2],
        cell(prevSig ? `${fmtEval(p)} · ${prevSig}` : fmtEval(p)),
      ];
    });
    for (const mId of access?.providers?.opencode || []) {
      if (seenModels.has(mId)) continue;
      if (!isFreeId(mId) && !/big-pickle|stealth|alpha/i.test(mId)) continue;
      const fk = normFam(fam(mId));
      const p = probeByModel.get(mId) || probeByFam.get(fk);
      const intel = lookupByFam(intelByFam, fk);
      const eng = lookupByFam(engByFam, fk);
      const aaBits = [
        eng ? `Eng ${eng.eng}` : null,
        intel ? `Intel ${intel.intel}` : null,
      ].filter(Boolean).join(' / ');
      const sig = p
        ? `${fmtEval(p)}${aaBits ? ` · AA ${aaBits}` : ' · stealth/unbenchmarked on AA'}`
        : aaBits || 'stealth/new free route — run mini_eval.mjs probe';
      freeTable.rows.unshift([
        cell(`<code>${esc(mId)}</code> <span class="tag">OC Free</span>${p ? ' <span class="tag">EVAL</span>' : ''}`),
        cell('$0', { n: 1 }),
        cell('free pool (~200/day-class, outside Go quota); check data-use terms'),
        cell(sig),
      ]);
    }
  }
}

// §16 evalproto — populate the live Stage 1 + anchor mini-eval scorecard table
if (probeByModel.size > 0) {
  const evalSec = guide.sections.find((s) => s.id === 'evalproto');
  if (evalSec) {
    evalSec.title = `16. Mini-eval protocol &amp; live stealth/launch scorecard <span class="tag">2-stage funnel · live ${esc(latestProbeDate || dash.date)} · ${probeByModel.size} models</span>`;
    const sortedProbes = [...probeByModel.values()].sort((a, b) => b.composite - a.composite);
    const evalRows = sortedProbes.map((r) => {
      const fk = normFam(fam(r.model));
      const aaI = lookupByFam(intelByFam, fk);
      const aaE = lookupByFam(engByFam, fk);
      const aaRef = (aaE || aaI) ? `AA Eng ${aaE ? aaE.eng : '—'} / Intel ${aaI ? aaI.intel : '—'}` : 'stealth / no AA';
      return [
        cell(`<code>${esc(r.model)}</code> <span class="tag">EVAL</span>`),
        cell(`<b>${r.composite}</b>`, { n: 1, v: r.composite }),
        cell(esc(r.tier)),
        cell(`${r.tasks?.coding?.score ?? 0}`, { n: 1, v: r.tasks?.coding?.score ?? 0 }),
        cell(`${r.tasks?.bughunt?.score ?? 0}`, { n: 1, v: r.tasks?.bughunt?.score ?? 0 }),
        cell(`${r.tasks?.reasoning?.score ?? 0}`, { n: 1, v: r.tasks?.reasoning?.score ?? 0 }),
        cell(`${r.tasks?.agentic?.score ?? 0}`, { n: 1, v: r.tasks?.agentic?.score ?? 0 }),
        cell(`${r.delivered}/${r.attempted}`, { n: 1 }),
        cell(r.p50_s != null ? `${r.p50_s}s` : '—', { n: 1, v: r.p50_s ?? undefined }),
        cell(r.tok_per_s != null ? `${r.tok_per_s}` : '—', { n: 1, v: r.tok_per_s ?? undefined }),
        cell(`${r.reasoning_share_pct ?? 0}%`, { n: 1, v: r.reasoning_share_pct ?? 0 }),
        cell(aaRef),
      ];
    });
    setRows('evalproto', evalRows, [
      { h: 'Model ⇅', s: 't', tip: 'Exact provider/model route evaluated by scripts/mini_eval.mjs probe (isolated tool-deny config for P1–P3, sandboxed fixture for P4, OPENCODE_MODEL_FALLBACK=off).' },
      { h: 'Composite ⇅', n: 1, s: 'n', dir: 'desc', tip: '0–100 deterministic score = P1 Coding (35) + P2 BugHunt (35) + P3 Logic (15) + P4 Agentic (15).' },
      { h: 'Tier ⇅', s: 't', tip: 'Apex (≥78) · Workhorse (58–77) · Flash/Lite (38–57) · Sub-par (<38).' },
      { h: 'P1 Code (35) ⇅', n: 1, s: 'n', dir: 'desc', tip: 'Engineering / Code Synthesis: 10 unit test cases on trailing-window quota accounting (boundaries, dedup, free exclusion, over-cap, sorting).' },
      { h: 'P2 BugHunt (35) ⇅', n: 1, s: 'n', dir: 'desc', tip: 'Reviewer / DeepSWE proxy: 3 planted defects (blocking truncation commit +14, major SQLi +10, minor unit mismatch +5, format +6) minus 10 pts per false alarm on the clean currency.ts decoy.' },
      { h: 'P3 Logic (15) ⇅', n: 1, s: 'n', dir: 'desc', tip: 'Intelligence / Constraint Scheduling: exact optimal completion time (16s), commit order (A,B,C,E,D), and peak write buffer (350 KiB).' },
      { h: 'P4 Agentic (15) ⇅', n: 1, s: 'n', dir: 'desc', tip: 'T-Bench / Tool Discipline: sandboxed read/grep root-cause hunt in src/reconcile.mjs:23 (>= vs >) with zero forbidden tool calls.' },
      { h: 'Deliv', n: 1, tip: 'Completed non-error responses out of 4 probe tasks (pauses after 2 consecutive DNFs).' },
      { h: 'p50 s ⇅', n: 1, s: 'n', tip: 'Median wall-clock seconds per probe task.' },
      { h: 'tok/s ⇅', n: 1, s: 'n', dir: 'desc', tip: 'Effective output + reasoning tokens per second of wall time.' },
      { h: 'Reas % ⇅', n: 1, s: 'n', dir: 'desc', tip: 'Share of generated tokens spent in reasoning/thinking blocks (identifies thinking models).' },
      { h: 'AA ref', tip: 'Published AA Engineering / Intelligence scores for calibration (— for stealth models).' },
    ]);
  }
}

fs.writeFileSync(OUT, 'window.__MB__ = ' + JSON.stringify(guide) + ';\n');
const nRows = guide.sections.reduce((a, s) => a + s.blocks.filter((b) => b.t === 'table').reduce((x, b) => x + b.rows.length, 0), 0);
console.log(`wrote ${path.relative(process.cwd(), OUT)} (${dashFile}, ${dash.date}; ${guide.sections.length} sections, ${nRows} rows)`);
