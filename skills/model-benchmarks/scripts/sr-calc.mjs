#!/usr/bin/env node
// sr-calc.mjs — account-level Go allowance calculator (schema 4).
//
// Console structure (verified 2026-10-26 screenshot + three 429 ground
// truths — the flat request-cap model was WRONG, rebuilt from scratch):
//   month   fixed billing cycle: 19th 00:00 UTC → next 19th 00:00 UTC
//   week    fixed calendar week: Monday 00:00 UTC → Monday 00:00 UTC
//   rolling trailing 5h bucket (provider 429 retryAfterMs = bucket reset;
//             a fresh bucket starts at the last expired 5h block's reset)
// Quota basis is TIER-NORMALIZED TOKEN DOLLARS, not flat requests:
//   pct(window) = 100 * Σ_models  USD(model,window) / Allowance(model,window)
// with USD = max(recorded cost, token-estimated cost at GO_PRICES) and the
// per-model $ allowances from the Go blog reference (5h = monthly/5,
// weekly = monthly/2). This matches every console reading and 429 block to
// ~1% with zero anchors (Oct-26 month 53.2 vs 52; Nov-16 5h 13.3 vs 13 and
// week 13.4 vs 13; Nov-17 month block 99.2 vs 100; Nov-23 5h block 99.2 vs
// 100 — a 163-turn gemini-4-argon burst at ~$0.040/req vs ~$0.0009/req for
// muse-spark, i.e. one Argon request burns ~91x the quota of one Spark
// request). Usage counts Go-product requests only (DB providerID =
// 'opencode-go', error rows excluded, `-free` models excluded): the console
// 2026-11-17 request log matched DB Go rows ±2/hr, while free/BYOK/trial
// rows never appeared in it. Free endpoints (opencode/*-free,
// opencode-go/*-free) sit in a separate pool with their own tighter
// (~200/day-class) limits — they never burn Go quota.
// Caps: none in request units — the old MONTH_CAP/WEEK_CAP request caps are
//   deprecated (kept exported for compat) and window capReq is null. The
//   only numbers that matter are GO_PRICES + GO_ALLOWANCE below, which are
//   the SINGLE source of truth (usage-dashboard/generate.py keeps a copy in
//   sync — same numbers, Python).
// Anchors (console sightings): sr-anchors.json {month|week|rolling:{pct,...}}
//   is now a manual pct OVERRIDE only (formula is self-calibrating ±1%).
//   Record one with --anchor <scope> <pct> --at <ISO> on a console sighting;
//   old count-based {usage,dbCount} anchors are ignored. Pass --at with the
//   reading's timestamp (a lagged reading once blocked the bar ~5.5h early).
//   node sr-calc.mjs --anchor month 68 --at 2026-11-23T20:00:00Z --note "..."
// Reads: opencode.db (read-only). No network, stdlib only.
// Usage:
//   node sr-calc.mjs [--db PATH] [--json PATH] [--anchors PATH]
//   node sr-calc.mjs --anchor <month|week|rolling> <pct> [--at ISO] [--note TEXT]
// Import: import { calcSR } from './sr-calc.mjs'  # calcSR(dbPath?, anchorsPath?) -> object
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const HOME = os.homedir();
const DEFAULT_DB = path.join(HOME, '.local/share/opencode/opencode.db');
const DEFAULT_ANCHORS = path.join(HOME, '.local/share/opencode/sr-anchors.json');

export const SR = 0.01;
// v4: fixed periods (month 19th–19th, week Mon–Mon, trailing 5h) with
// account-wide caps. v3 files (rolling windows, per-model caps) ignored.
export const SCHEMA = 4;
export const WARN_PCT = 70;
export const CRIT_PCT = 90;
// DEPRECATED request caps (flat-request model, superseded 2026-11-23 by
// tier-normalized token dollars — kept exported so old imports don't break).
export const MONTH_CAP = 18000; // was: calibrated 2026-10-26: console 9,334 = 52%
export const WEEK_CAP = 15700; // was: re-derived 2026-11-16 (single reading)
export const ROLL_MS = 5 * 3600e3;

// Token prices ($ per 1M tokens: input, output+reasoning, cache-read) from
// the Go blog reference (atomicbot.ai/blog/opencode-go, checked 2026-11-02;
// blog prices match recorded per-message costs to the 4th decimal). Models
// without a published price fall back to recorded cost. Cache-write price is
// unpublished and 0 on every Go row, so it is excluded from the estimate.
// KEEP IN SYNC with skills/usage-dashboard/generate.py GO_PRICES.
export const GO_PRICES = {
  'glm-5.3-flash': [0.15, 0.50, 0.03],
  'glm-5.3': [1.40, 4.40, 0.26],
  'glm-5.2': [1.40, 4.40, 0.26],
  'muse-spark-1.3-contributor': [0.10, 0.20, 0.002],
  'muse-spark-1.2-contributor': [0.10, 0.20, 0.002],
  'deepseek-v4.1-flash': [0.15, 0.60, 0.003],
  'deepseek-v4-pro': [0.66, 1.98, 0.022],
  'mimo-v2.6-pro': [0.435, 0.87, 0.003625],
  'mimo-v2.5-pro': [0.435, 0.87, 0.003625],
  'mimo-v2.6-flash': [0.14, 0.28, 0.0028],
  'mimo-v2.5': [0.14, 0.28, 0.0028],
  'minimax-m3.1-flash': [0.15, 0.60, 0.015],
  'minimax-m3': [0.30, 1.20, 0.06],
  'space-bunny': [0.15, 0.60, 0.015],
  'gpt-6-luna': [0.10, 0.50, 0.01],
  'gpt-5.6-luna': [0.20, 1.20, 0.02],
  'claude-haiku-5.5': [0.10, 0.50, 0.01],
  'kimi-k3.1-pro': [2.00, 10.00, 0.20],
  'kimi-k3': [3.00, 15.00, 0.30],
  'kimi-k2.7-code': [0.95, 4.00, 0.19],
  'qwen3.8-flash': [0.15, 0.47, 0.016],
  'qwen3.7-plus': [0.40, 1.60, 0.04],
  'qwen3.8-max': [2.00, 6.00, 0.25],
  'qwen4-max': [1.50, 4.50, 0.18],
  'gemini-4-argon': [2.00, 10.00, 0.10],
  'gemini-4-argon-contributor': [2.00, 10.00, 0.10],
  'grok-4.7': [2.00, 6.00, 0.50],
  'longcat-2.0': [0.30, 1.20, 0.06],
  'hy3': [0.30, 1.20, 0.06],
  'hy4-preview': [0.83, 2.50, 0.08],
  'hy4': [0.83, 2.50, 0.08],
  'step-5-preview': [1.00, 2.70, 0.10],
};
// Per-model $ allowances (monthly, per-5h, per-week) — blog limit tiers:
// 5h = monthly/5, weekly = monthly/2. KEEP IN SYNC with generate.py.
// Unknown models default to the $15 tier.
export const GO_ALLOWANCE = {
  'glm-5.3-flash': [60, 12, 30],
  'glm-5.3': [15, 3, 7.5],
  'glm-5.2': [60, 12, 30],
  'muse-spark-1.3-contributor': [60, 12, 30],
  'muse-spark-1.2-contributor': [60, 12, 30],
  'mimo-v2.6-flash': [60, 12, 30],
  'mimo-v2.5': [60, 12, 30],
  'mimo-v2.6-pro': [15, 3, 7.5],
  'mimo-v2.5-pro': [15, 3, 7.5],
  'gemini-4-argon': [30, 6, 15],
  'gemini-4-argon-contributor': [30, 6, 15],
  'kimi-k3.1-pro': [15, 3, 7.5],
  'kimi-k3': [15, 3, 7.5],
  'kimi-k2.7-code': [60, 12, 30],
  'deepseek-v4.1-flash': [100, 20, 50],
  'deepseek-v4-pro': [15, 3, 7.5],
  'minimax-m3.1-flash': [20, 4, 10],
  'minimax-m3': [60, 12, 30],
  'space-bunny': [20, 4, 10],
  'gpt-6-luna': [15, 3, 7.5],
  'gpt-5.6-luna': [15, 3, 7.5],
  'claude-haiku-5.5': [15, 3, 7.5],
  'qwen3.8-flash': [30, 6, 15],
  'qwen3.7-plus': [60, 12, 30],
  'qwen3.8-max': [15, 3, 7.5],
  'qwen4-max': [15, 3, 7.5],
  'grok-4.7': [15, 3, 7.5],
  'longcat-2.0': [60, 12, 30],
  'hy3': [60, 12, 30],
  'hy4-preview': [30, 6, 15],
  'hy4': [30, 6, 15],
  'step-5-preview': [15, 3, 7.5],
};
const ALLOW_IDX = { month: 0, rolling: 1, week: 2 };
// $ allowance for a model in a window ($15 tier default).
export const allowanceFor = (model, scope) =>
  (GO_ALLOWANCE[model] || [15, 3, 7.5])[ALLOW_IDX[scope] ?? 0];
// Token-estimated cost ($) for token counts; null when the model has no
// published price (caller falls back to recorded cost).
export function tokenUsdFor(model, tin, tout, tcr) {
  const pr = GO_PRICES[model];
  if (!pr) return null;
  return (N(tin) * pr[0] + N(tout) * pr[1] + N(tcr) * pr[2]) / 1e6;
}
// Estimate a single turn's cost from an event token payload (V2 zero-cost
// rows carry tokens but cost 0). Accepts several shapes; null if unusable.
export function estimateTurnUsd(model, tokens) {
  try {
    const t = tokens || {};
    const tin = t.input ?? t.inputTokens ?? t.promptTokens ?? 0;
    const tout = (t.output ?? t.outputTokens ?? t.completionTokens ?? 0)
      + (t.reasoning ?? t.reasoningTokens ?? 0);
    const cr = t.cache?.read ?? t.cacheRead ?? t.cachedTokens ?? 0;
    if (!tin && !tout && !cr) return null;
    return tokenUsdFor(model, tin, tout, cr);
  } catch { return null; }
}

// Free-tier model IDs never count toward Go quota (separate pool, own tighter
// limits). Matches `-free` suffix on the stored model id (both V1 modelID and
// V2 model.id shapes).
export const isFreeModel = (m) => /-free$/i.test(String(m || ''));

// Toast-worthy windows: all three calibrated windows (rolling included —
// its live pct warns before the 429 wall). cost-tracker.js keeps a copy in
// sync (its state stems from a schema-4 recompute, which always carries
// `calibrated`).
export function alertsFor(windows) {
  const a = [];
  for (const w of ['month', 'week', 'rolling']) {
    const win = windows?.[w];
    if (!win || win.calibrated === false) continue;
    const p = win.pct ?? 0;
    if (p >= CRIT_PCT) a.push(`${w}_90`);
    else if (p >= WARN_PCT) a.push(`${w}_70`);
  }
  return a;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = (ms) => { const d = new Date(ms); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
// Fixed billing month: the 19th 00:00 UTC containing `now`.
export function monthPeriod(nowMs) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const start = d.getUTCDate() >= 19 ? Date.UTC(y, m, 19) : Date.UTC(y, m - 1, 19);
  return { start, end: Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth() + 1, 19) };
}
// Fixed calendar week: Monday 00:00 UTC containing `now`.
export function weekPeriod(nowMs) {
  const d = new Date(nowMs);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const start = midnight - ((d.getUTCDay() + 6) % 7) * 86400e3;
  return { start, end: start + 7 * 86400e3 };
}

const N = (v) => (v === null || v === undefined || '' === v || 'NULL' === v ? 0 : parseFloat(v));

function q(db, sql, attempt = 0) {
  let out;
  try {
    // -readonly: opencode is a live writer; opening read-write risks "database
    // is locked" and (worst case) file creation on a path typo.
    out = execFileSync('sqlite3', ['-readonly', db, '-separator', '\t', sql], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  } catch (e) {
    // One write burst can hold the lock longer than our single-shot read —
    // retry with a small backoff before giving up (all three recompute paths
    // fail together otherwise, leaving the file stale for the next tick lottery).
    if (attempt >= 2) throw e;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250 * (attempt + 1));
    return q(db, sql, attempt + 1);
  }
  return out.trim() ? out.trim().split('\n').map((l) => l.split('\t')) : [];
}

function readAnchors(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}
function writeAnchors(p, anchors) {
  // Atomic write (tmp+rename): a torn anchors file silently reads as {} and
  // every window goes UNCALIBRATED until a manual re-anchor.
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(anchors, null, 1) + '\n');
  fs.renameSync(tmp, p);
}

// V2 moved message storage to `session_message` (type='assistant',
// data.model.{providerID,id}); V1 used `message` (role='assistant',
// data.providerID/modelID). A migrated DB has BOTH (the migration copies the
// old rows), so exactly one source must be queried or history double-counts.
// The table only exists once V2 has opened the DB, so its presence is the
// version probe. `id` stamps which source an anchor's dbCount was measured
// against — request deltas are only comparable within one source (the V2
// migration copies rows but not 1:1: ~45 fewer rows in the Oct 19–26 window,
// plus $3.93 less cost over the month, so a V1 dbCount must never be mixed
// with a V2 dbCount).
function msgSource(dbPath) {
  try {
    const has = q(dbPath, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='session_message';`);
    if (has.length && +has[0][0] > 0) {
      const t = q(dbPath, `SELECT COUNT(*) FROM session_message WHERE type='assistant';`);
      if (t.length && +t[0][0] > 0) {
        return {
          id: 'v2',
          from: `session_message WHERE type='assistant'`,
          provider: `COALESCE(json_extract(data,'$.model.providerID'),'?')`,
          model: `COALESCE(json_extract(data,'$.model.id'),'?')`,
        };
      }
      // Table exists but holds no assistant rows (e.g. fresh V2 DB) — still
      // v2-sourced so anchors stamp the right source; counts read 0.
      return {
        id: 'v2',
        from: `session_message WHERE type='assistant'`,
        provider: `COALESCE(json_extract(data,'$.model.providerID'),'?')`,
        model: `COALESCE(json_extract(data,'$.model.id'),'?')`,
      };
    }
  } catch {
    // Unreadable DB path — fall through to the V1 shape; the query will
    // surface the real error.
  }
  return {
    id: 'v1',
    from: `message WHERE json_extract(data,'$.role')='assistant'`,
    provider: `COALESCE(json_extract(data,'$.providerID'),'?')`,
    model: `COALESCE(json_extract(data,'$.modelID'),'?')`,
  };
}

function dbCountSince(dbPath, startMs, untilMs = null, basis = 'go') {
  const src = msgSource(dbPath);
  const until = untilMs != null ? ` AND time_created<=${untilMs}` : '';
  // Go quota counts completed Go-product requests only; rejected/errored rows
  // (e.g. the 429s at the cap) are recorded in the DB but never billed, and
  // `-free` rows sit in a separate free pool with their own limits.
  const filter = basis === 'all'
    ? ''
    : ` AND ${src.provider}='opencode-go' AND ${src.model} NOT LIKE '%-free' AND json_extract(data,'$.error') IS NULL`;
  const r = q(dbPath, `SELECT COUNT(*) FROM ${src.from} AND time_created>=${startMs}${until}${filter};`);
  return r.length ? (+r[0][0] || 0) : 0;
}

export function calcSR(dbPath = DEFAULT_DB, anchorsPath = DEFAULT_ANCHORS) {
  const now = Date.now();
  const DAY = 86400e3;
  const mp = monthPeriod(now), wp = weekPeriod(now);
  const src = msgSource(dbPath);

  // Latest successful Go-product request (any window): a block only stands
  // while no success follows it (Extra Usage / plan change unblocks). Free
  //-pool successes must not clear a Go block.
  let lastGoOkAt = 0;
  try {
    const r = q(dbPath, `SELECT MAX(time_created) FROM ${src.from} AND ${src.provider}='opencode-go' AND ${src.model} NOT LIKE '%-free' AND json_extract(data,'$.error') IS NULL;`);
    if (r.length) lastGoOkAt = +r[0][0] || 0;
  } catch { /* unreadable DB: block checks below fail safe (no block) */ }

  // 429 block rows: the provider's own retryAfterMs is ground truth for the
  // reset. The 5h/monthly windows share error type `provider.go-limit`, so
  // the structured `metadata.limitName` is the primary discriminator, with
  // the human message as fallback. Look back 2x the rolling width so an
  // expired 5h bucket still floors the new bucket's start after its 429 row
  // ages out of the trailing window.
  const blockQ = (where) => {
    try {
      return q(dbPath,
        `SELECT time_created, COALESCE(json_extract(data,'$.error.retryAfterMs'),0) ` +
        `FROM ${src.from} AND time_created>=${now - 2 * ROLL_MS} AND ${src.provider}='opencode-go' AND ${src.model} NOT LIKE '%-free' ` +
        `AND json_extract(data,'$.error.type')='provider.go-limit' AND (${where}) ` +
        `ORDER BY time_created DESC LIMIT 1;`);
    } catch { return []; }
  };
  const LIM5 = `(json_extract(json_extract(data,'$.error.response.body'),'$.metadata.limitName')='5 hour' ` +
    `OR json_extract(data,'$.error.message') LIKE '%5 hour usage limit%')`;
  const LIMMON = `(json_extract(json_extract(data,'$.error.response.body'),'$.metadata.limitName')='monthly' ` +
    `OR json_extract(data,'$.error.message') LIKE '%monthly usage limit%')`;
  const LIMWEEK = `(json_extract(json_extract(data,'$.error.response.body'),'$.metadata.limitName')='weekly' ` +
    `OR json_extract(data,'$.error.message') LIKE '%week%usage limit%')`;
  const blockInfo = (rows, fallbackMs) => {
    if (!rows.length) return { blocked: false, blockedAt: null, blockedUntil: null, _until: 0 };
    const at = +rows[0][0] || 0, retry = +rows[0][1] || 0;
    const until = at + (retry > 0 ? retry : fallbackMs);
    if (at > lastGoOkAt && now < until) {
      return { blocked: true, blockedAt: new Date(at).toISOString(), blockedUntil: new Date(until).toISOString(), _until: until };
    }
    return { blocked: false, blockedAt: null, blockedUntil: null, _until: until };
  };
  const b5 = blockInfo(blockQ(LIM5), ROLL_MS);
  const bM = blockInfo(blockQ(LIMMON), mp.end - mp.start);
  const bW = blockInfo(blockQ(LIMWEEK), wp.end - wp.start);

  // Expired 5h buckets reset: the new bucket starts at the last reset, so
  // pre-reset requests must not inflate it (seen 2026-11-23: 430 dead-bucket
  // requests lingered until 01:08Z while the live bucket was 107%).
  let tRoll = now - ROLL_MS;
  if (!b5.blocked && b5._until > tRoll && b5._until <= now) tRoll = b5._until;

  const costAll = (t) => `COALESCE(SUM(CASE WHEN time_created>=${t} THEN COALESCE(json_extract(data,'$.cost'),0) ELSE 0 END),0)`;
  const msgsAll = (t) => `SUM(CASE WHEN time_created>=${t} THEN 1 ELSE 0 END)`;
  const okN = (t) => `SUM(CASE WHEN time_created>=${t} AND json_extract(data,'$.error') IS NULL THEN 1 ELSE 0 END)`;
  const okCost = (t) => `COALESCE(SUM(CASE WHEN time_created>=${t} AND json_extract(data,'$.error') IS NULL THEN COALESCE(json_extract(data,'$.cost'),0) ELSE 0 END),0)`;
  const okTin = (t) => `COALESCE(SUM(CASE WHEN time_created>=${t} AND json_extract(data,'$.error') IS NULL THEN COALESCE(json_extract(data,'$.tokens.input'),0) ELSE 0 END),0)`;
  const okTout = (t) => `COALESCE(SUM(CASE WHEN time_created>=${t} AND json_extract(data,'$.error') IS NULL THEN COALESCE(json_extract(data,'$.tokens.output'),0)+COALESCE(json_extract(data,'$.tokens.reasoning'),0) ELSE 0 END),0)`;
  const okTcr = (t) => `COALESCE(SUM(CASE WHEN time_created>=${t} AND json_extract(data,'$.error') IS NULL THEN COALESCE(json_extract(data,'$.tokens.cache.read'),0) ELSE 0 END),0)`;
  const rows = q(dbPath,
    `SELECT ${src.provider}, ${src.model}, ` +
    `${costAll(mp.start)}, ${msgsAll(mp.start)}, ${costAll(wp.start)}, ${msgsAll(wp.start)}, ${costAll(tRoll)}, ${msgsAll(tRoll)}, ` +
    `${okN(mp.start)}, ${okN(wp.start)}, ${okN(tRoll)}, ` +
    `${okCost(mp.start)}, ${okCost(wp.start)}, ${okCost(tRoll)}, ` +
    `${okTin(mp.start)}, ${okTout(mp.start)}, ${okTcr(mp.start)}, ` +
    `${okTin(wp.start)}, ${okTout(wp.start)}, ${okTcr(wp.start)}, ` +
    `${okTin(tRoll)}, ${okTout(tRoll)}, ${okTcr(tRoll)}, ` +
    `MAX(time_created), MIN(CASE WHEN time_created>=${tRoll} THEN time_created END) ` +
    `FROM ${src.from} AND time_created>=${mp.start} GROUP BY 1,2;`);
  const isGoQuota = (r) => r.provider === 'opencode-go' && !isFreeModel(r.model);
  const perModel = rows.map((r) => {
    const provider = r[0], model = r[1];
    const n = { month: +r[3] || 0, week: +r[5] || 0, rolling: +r[7] || 0 };
    const nOk = { month: +r[8] || 0, week: +r[9] || 0, rolling: +r[10] || 0 };
    const rec = { month: N(r[11]), week: N(r[12]), rolling: N(r[13]) };
    const tok = {
      month: [+r[14] || 0, +r[15] || 0, +r[16] || 0],
      week: [+r[17] || 0, +r[18] || 0, +r[19] || 0],
      rolling: [+r[20] || 0, +r[21] || 0, +r[22] || 0],
    };
    // Priced cost = max(recorded, token-estimated): V2 rows carry cost 0
    // with tokens still flowing, so recorded $ is blind for recent days.
    const usd = {}, quotaPct = {};
    for (const s of ['month', 'week', 'rolling']) {
      const est = tokenUsdFor(model, ...tok[s]);
      const priced = Math.max(rec[s], est ?? rec[s]);
      usd[s] = +priced.toFixed(4);
      // Omit nulls: Swift decodes this map as [String: Double], where a
      // JSON null value fails the whole state (blank pill until next tick).
      if (isGoQuota({ provider, model })) quotaPct[s] = +(priced / allowanceFor(model, s) * 100).toFixed(3);
    }
    const basis = nOk.month >= 5 ? 'month' : (nOk.week >= 1 ? 'week' : (nOk.rolling >= 1 ? 'rolling' : null));
    return {
      model, provider,
      msgs: n, msgsOk: nOk, usd,
      usdRec: Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, +v.toFixed(4)])),
      quotaPct: Object.fromEntries(Object.entries(quotaPct).map(([k, v]) => [k, v == null ? null : +v.toFixed(3)])),
      costPerMsg: basis ? +(usd[basis] / Math.max(1, nOk[basis])).toFixed(5) : 0,
    };
  });
  const tot = (k) => perModel.reduce((a, r) => a + r.msgs[k], 0);
  const totOk = (k) => perModel.filter(isGoQuota).reduce((a, r) => a + r.msgsOk[k], 0);
  const totPriced = (k) => +perModel.filter(isGoQuota).reduce((a, r) => a + r.usd[k], 0).toFixed(4);
  const totQuota = (k) => perModel.filter(isGoQuota).reduce((a, r) => a + (r.quotaPct[k] || 0), 0);
  const dbCounts = { month: tot('month'), week: tot('week'), rolling: tot('rolling') };
  // Go quota basis: completed Go-product requests only (errors and `-free`
  // free-pool rows excluded).
  const goCounts = { month: totOk('month'), week: totOk('week'), rolling: totOk('rolling') };
  // Oldest Go request inside the (possibly floored) trailing bucket.
  const rollOldest = Math.min(...rows.filter((r) => r[0] === 'opencode-go' && !isFreeModel(r[1])).map((r) => +r[24] || Infinity).filter((x) => Number.isFinite(x)), Infinity);
  // Manual pct overrides from console sightings (formula is self-calibrating
  // ±1%; old count-based {usage,dbCount} anchors are ignored). Override wins
  // only for its period + message source.
  const anchors = readAnchors(anchorsPath);
  const pctOverride = (scope, periodStart) => {
    const a = anchors[scope];
    if (a && typeof a.pct === 'number' && Number.isFinite(a.pct)
      && a.periodStart === new Date(periodStart).toISOString()
      && (!a.source || a.source === src.id)) {
      return { pct: a.pct, note: a.note || null };
    }
    return null;
  };
  const mkWindow = (scope, period, o) => {
    const ov = pctOverride(scope, period.start);
    const pct = ov ? ov.pct : o.pct;
    const spanMs = scope === 'rolling' ? ROLL_MS : (period.end - period.start);
    return {
      label: scope === 'month' ? `Monthly · ${fmtD(period.start)} – ${fmtD(period.end)}`
        : scope === 'week' ? `Weekly · Mon ${fmtD(period.start)} – Mon ${fmtD(period.end)}`
        : 'Rolling · trailing 5h',
      periodStart: new Date(period.start).toISOString(),
      periodEnd: scope === 'rolling' ? null : new Date(period.end).toISOString(),
      usedReq: o.usedReq, usedUsd: o.usedUsd,
      allowedReq: null, capReq: null,
      pct,
      remainingPct: pct == null ? null : +Math.max(0, 100 - pct).toFixed(1),
      freesAt: o.freesAt != null ? new Date(o.freesAt).toISOString() : null,
      freesInSec: o.freesAt != null ? Math.max(0, Math.round((o.freesAt - now) / 1000)) : null,
      elapsedDays: +Math.max(1 / 24, (now - period.start) / DAY).toFixed(3),
      spanDays: +(spanMs / DAY).toFixed(3),
      calibrated: true, anchorNote: ov ? ov.note : null,
      dbCount: o.usedReq,
      blocked: o.blocked, blockedAt: o.blockedAt, blockedUntil: o.blockedUntil,
    };
  };
  const monthPct = totQuota('month'), weekPct = totQuota('week'), rollPct = totQuota('rolling');
  const windows = {
    month: mkWindow('month', mp, { usedReq: goCounts.month, usedUsd: totPriced('month'), pct: monthPct, freesAt: mp.end, blocked: bM.blocked, blockedAt: bM.blockedAt, blockedUntil: bM.blockedUntil }),
    week: mkWindow('week', wp, { usedReq: goCounts.week, usedUsd: totPriced('week'), pct: weekPct, freesAt: wp.end, blocked: bW.blocked, blockedAt: bW.blockedAt, blockedUntil: bW.blockedUntil }),
    rolling: mkWindow('rolling', { start: tRoll }, { usedReq: goCounts.rolling, usedUsd: totPriced('rolling'), pct: rollPct,
      freesAt: Number.isFinite(rollOldest) ? rollOldest + ROLL_MS : null, blocked: b5.blocked, blockedAt: b5.blockedAt, blockedUntil: b5.blockedUntil }),
  };
  // Model shares of the month. shareMonth = share of ALL assistant traffic
  // (all rows, as before); shareGo = share of successful Go-quota requests
  // (failed 429 retries never bill, so they must not take share); shareQuota
  // = share of the month's normalized quota burn (the cost driver).
  const mTot = dbCounts.month || 1;
  const gTot = goCounts.month || 1;
  const qTot = monthPct || 1;
  for (const r of perModel) {
    r.shareMonth = +(100 * r.msgs.month / mTot).toFixed(1);
    r.shareGo = isGoQuota(r) ? +(100 * r.msgsOk.month / gTot).toFixed(1) : null;
    r.shareQuota = isGoQuota(r) ? +((r.quotaPct.month || 0) / qTot * 100).toFixed(1) : null;
    // Flag free-pool rows so consumers never mistake them for quota usage.
    if (isFreeModel(r.model)) r.freePool = true;
  }
  // Daily spend for the last 30 UTC days (trend + pace). Go dollars are
  // token-priced (V2 cost fields read 0 with tokens still flowing); only
  // completed Go rows count toward the quota basis.
  const utcMidnight = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const byDay = new Map();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(utcMidnight - i * DAY).toISOString().slice(0, 10);
    byDay.set(d, { date: d, goMsgs: 0, otherMsgs: 0, goUsd: 0, otherUsd: 0 });
  }
  for (const r of q(dbPath,
    `SELECT strftime('%Y-%m-%d', time_created/1000, 'unixepoch'), ${src.provider}, ${src.model}, COUNT(*), ` +
    `COALESCE(SUM(COALESCE(json_extract(data,'$.cost'),0)),0), ` +
    `COALESCE(SUM(CASE WHEN json_extract(data,'$.error') IS NULL THEN COALESCE(json_extract(data,'$.tokens.input'),0) ELSE 0 END),0), ` +
    `COALESCE(SUM(CASE WHEN json_extract(data,'$.error') IS NULL THEN COALESCE(json_extract(data,'$.tokens.output'),0)+COALESCE(json_extract(data,'$.tokens.reasoning'),0) ELSE 0 END),0), ` +
    `COALESCE(SUM(CASE WHEN json_extract(data,'$.error') IS NULL THEN COALESCE(json_extract(data,'$.tokens.cache.read'),0) ELSE 0 END),0), ` +
    `SUM(CASE WHEN json_extract(data,'$.error') IS NULL THEN 1 ELSE 0 END) ` +
    `FROM ${src.from} AND time_created>=${now - 30 * DAY} GROUP BY 1,2,3;`)) {
    const e = byDay.get(r[0]);
    if (!e) continue;
    const n = +r[3] || 0, usd = +r[4] || 0;
    if (r[1] === 'opencode-go' && !isFreeModel(r[2])) {
      const est = tokenUsdFor(r[2], +r[5] || 0, +r[6] || 0, +r[7] || 0);
      e.goMsgs += (+r[8] || 0);
      e.goUsd += Math.max(usd, est ?? usd);
    }
    else { e.otherMsgs += n; e.otherUsd += usd; }
  }
  const daily = [...byDay.values()].map((e) => ({
    date: e.date, goMsgs: e.goMsgs, otherMsgs: e.otherMsgs,
    goUsd: +e.goUsd.toFixed(4), otherUsd: +e.otherUsd.toFixed(4),
  }));
  const elapsedDays = Math.max(1 / 24, (now - mp.start) / DAY);
  const paceReqPerDay = +(windows.month.usedReq / elapsedDays).toFixed(1);
  const pacePctPerDay = +(windows.month.pct / elapsedDays).toFixed(2);
  const lastActivity = rows.length ? Math.max(...rows.map((r) => +r[23] || 0)) : 0;
  const alerts = alertsFor(windows);
  // fullRecomputeAt is stamped HERE: every calcSR() result IS a full recompute
  // from DB ground truth, so CLI-written files are first-class.
  const nowIso = new Date().toISOString();
  return {
    schema: SCHEMA,
    generated_at: nowIso, fullRecomputeAt: nowIso,
    unit: 'tier-normalized Go token-dollars per fixed period (schema 4); windows carry live pct; blocks from provider 429 retryAfterMs',
    windows, perModel, alerts, daily, paceReqPerDay, pacePctPerDay,
    lastActivity: lastActivity ? new Date(lastActivity).toISOString() : null,
    db: dbPath,
  };
}

const invoked = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invoked) {
  const arg = (n, d) => {
    const i = process.argv.indexOf(n);
    return i === -1 ? d : (process.argv[i + 1] || (() => { throw new Error(n + ' needs a value'); })());
  };
  const has = (n) => process.argv.includes(n);
  if (has('--anchor')) {
    // node sr-calc.mjs --anchor <month|week|rolling> <pct> [--at ISO] [--note TEXT] [--db P] [--anchors P]
    // Records a manual console-% override for the period containing --at.
    // (The formula is self-calibrating ±1%; old count-based anchors ignored.)
    const scope = arg('--anchor', null);
    const pct = Number(process.argv[process.argv.indexOf('--anchor') + 2]);
    const atRaw = arg('--at', null);
    const atMs = atRaw ? Date.parse(atRaw) : Date.now();
    if (!['month', 'week', 'rolling'].includes(scope) || !Number.isFinite(pct) || pct < 0) {
      console.error('usage: sr-calc.mjs --anchor <month|week|rolling> <pct> [--at ISO] [--note TEXT]'); process.exit(1);
    }
    if (!Number.isFinite(atMs) || atMs > Date.now()) {
      console.error('--at needs a valid ISO timestamp that is not in the future'); process.exit(1);
    }
    const db = arg('--db', DEFAULT_DB);
    const ap = arg('--anchors', DEFAULT_ANCHORS);
    const period = scope === 'month' ? monthPeriod(atMs) : scope === 'week' ? weekPeriod(atMs) : { start: atMs - ROLL_MS };
    const anchors = readAnchors(ap);
    anchors[scope] = {
      periodStart: new Date(period.start).toISOString(),
      pct,
      source: msgSource(db).id,
      at: new Date(atMs).toISOString(), note: arg('--note', null),
    };
    writeAnchors(ap, anchors);
    console.log(`anchored ${scope}: pct=${pct} at=${anchors[scope].at} periodStart=${anchors[scope].periodStart}`);
  } else {
    const db = arg('--db', DEFAULT_DB);
    const out = arg('--json', null);
    const ap = arg('--anchors', DEFAULT_ANCHORS);
    const res = calcSR(db, ap);
    const text = JSON.stringify(res, null, 1);
    // Atomic write: two writers (this CLI, the bar's timer, the plugin) share
    // the file — a torn JSON read decodes to nil and blanks the pill.
    if (out) { const tmp = `${out}.tmp.${process.pid}`; fs.writeFileSync(tmp, text + '\n'); fs.renameSync(tmp, out); }
    else console.log(text);
  }
}
