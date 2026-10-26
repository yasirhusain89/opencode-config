#!/usr/bin/env node
// sr-calc.mjs — account-level Go allowance calculator (schema 4).
//
// Console structure (verified 2026-10-26 screenshot — the old rolling-7d/30d
// + per-model-cap model was WRONG, rebuilt from scratch):
//   month   fixed billing cycle: 19th 00:00 UTC → next 19th 00:00 UTC
//   week    fixed calendar week: Monday 00:00 UTC → Monday 00:00 UTC
//   rolling trailing 5h window (verified: console "resets in" == oldest+5h)
// Usage counts ALL assistant requests (any provider): console month total
// 9,334 ≈ DB all-provider 9,534 (2%) vs Go-only 8,154 (13%). Caps:
//   month 18,000  calibrated (console 9,334 = 52% on 2026-10-26)
//   week   8,000  PROVISIONAL (account blocked ~Oct 25 at ~7.8k; re-derive on
//                the next console weekly sighting: cap = week usage ÷ week %)
//   rolling — no known cap: usage + oldest-expiry only, NEVER a pct.
// Anchors (console sightings): sr-anchors.json {month:{...}, week:{...}} —
// usage = anchor.usage + (dbCount - anchor.dbCount) while the period matches.
// The DB undercounts the console (other devices, unlogged rows), so anchors
// are the only exact numbers; re-anchor on every console sighting:
//   node sr-calc.mjs --anchor month 9334 --note "console 2026-10-26"
// Reads: opencode.db (read-only). No network, stdlib only.
// Usage:
//   node sr-calc.mjs [--db PATH] [--json PATH] [--anchors PATH]
//   node sr-calc.mjs --anchor <month|week> <usage> [--note TEXT]
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
export const MONTH_CAP = 18000; // calibrated 2026-10-26: console 9,334 = 52%
export const WEEK_CAP = 8000; // PROVISIONAL: ~Oct-25 block at ~7.8k account reqs
export const ROLL_MS = 5 * 3600e3;

// Toast-worthy windows: ONLY calibrated ones. An uncalibrated pct is a raw DB
// count divided by a cap — proven to diverge from the console (weekly DB count
// 612 vs console-equivalent ~80), so acting on it can fire toasts the account
// would never sanction. cost-tracker.js keeps a copy in sync (its state stems
// from a schema-4 recompute, which always carries `calibrated`).
export function alertsFor(windows) {
  const a = [];
  for (const w of ['month', 'week']) {
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

function dbCountSince(dbPath, startMs) {
  const r = q(dbPath, `SELECT COUNT(*) FROM message WHERE json_extract(data,'$.role')='assistant' AND time_created>=${startMs};`);
  return r.length ? (+r[0][0] || 0) : 0;
}

export function calcSR(dbPath = DEFAULT_DB, anchorsPath = DEFAULT_ANCHORS) {
  const now = Date.now();
  const mp = monthPeriod(now), wp = weekPeriod(now), tRoll = now - ROLL_MS;
  const cost = (t) => `COALESCE(SUM(CASE WHEN time_created>=${t} THEN COALESCE(json_extract(data,'$.cost'),0) ELSE 0 END),0)`;
  const msgs = (t) => `SUM(CASE WHEN time_created>=${t} THEN 1 ELSE 0 END)`;
  const rows = q(dbPath,
    `SELECT COALESCE(json_extract(data,'$.providerID'),'?'), COALESCE(json_extract(data,'$.modelID'),'?'), COUNT(*), ` +
    `${cost(mp.start)}, ${msgs(mp.start)}, ${cost(wp.start)}, ${msgs(wp.start)}, ${cost(tRoll)}, ${msgs(tRoll)}, ` +
    `MAX(time_created), MIN(CASE WHEN time_created>=${tRoll} THEN time_created END) ` +
    `FROM message WHERE json_extract(data,'$.role')='assistant' AND time_created>=${mp.start} GROUP BY 1,2;`);
  const perModel = rows.map((r) => {
    const provider = r[0], model = r[1];
    const n = { month: +r[4] || 0, week: +r[6] || 0, rolling: +r[8] || 0 };
    const usd = { month: N(r[3]), week: N(r[5]), rolling: N(r[7]) };
    const basis = n.month >= 5 ? 'month' : (n.week >= 1 ? 'week' : null);
    return {
      model, provider,
      msgs: n, usd: Object.fromEntries(Object.entries(usd).map(([k, v]) => [k, +v.toFixed(4)])),
      costPerMsg: basis ? +(usd[basis] / n[basis]).toFixed(5) : 0,
    };
  });
  const tot = (k) => perModel.reduce((a, r) => a + r.msgs[k], 0);
  const totUsd = (k) => +perModel.reduce((a, r) => a + r.usd[k], 0).toFixed(4);
  const dbCounts = { month: tot('month'), week: tot('week'), rolling: tot('rolling') };
  // Oldest request inside the trailing window: its expiry is the countdown.
  const rollOldest = Math.min(...rows.map((r) => +r[10] || Infinity).filter((x) => Number.isFinite(x)), Infinity);
  // Anchor math: console truth at sighting + exact DB deltas since.
  const anchors = readAnchors(anchorsPath);
  const applyAnchor = (scope, periodStart, cap) => {
    const a = anchors[scope];
    const dbCount = dbCounts[scope];
    if (a && a.periodStart === new Date(periodStart).toISOString() && a.dbCount != null && dbCount >= a.dbCount) {
      const usage = Math.max(0, Math.round(a.usage + (dbCount - a.dbCount)));
      return { usage, calibrated: true, note: a.note || null };
    }
    return { usage: dbCount, calibrated: false, note: null };
  };
  const mkWindow = (scope, period, cap, usage, calibrated, note, freesAt) => {
    const pct = cap != null ? (usage / cap) * 100 : null;
    return {
      label: scope === 'month' ? `Monthly · ${fmtD(period.start)} – ${fmtD(period.end)}`
        : scope === 'week' ? `Weekly · Mon ${fmtD(period.start)} – Mon ${fmtD(period.end)}`
        : 'Rolling · trailing 5h',
      periodStart: new Date(period.start).toISOString(),
      periodEnd: scope === 'rolling' ? null : new Date(period.end).toISOString(),
      usedReq: usage, usedUsd: scope === 'rolling' ? totUsd('rolling') : totUsd(scope),
      allowedReq: cap != null ? Math.max(0, Math.round(cap - usage)) : null,
      capReq: cap,
      pct,
      remainingPct: pct == null ? null : +Math.max(0, 100 - pct).toFixed(1),
      freesAt: freesAt != null ? new Date(freesAt).toISOString() : null,
      freesInSec: freesAt != null ? Math.max(0, Math.round((freesAt - now) / 1000)) : null,
      calibrated, anchorNote: note,
      dbCount: dbCounts[scope],
    };
  };
  const m = applyAnchor('month', mp.start, MONTH_CAP);
  const w = applyAnchor('week', wp.start, WEEK_CAP);
  const windows = {
    month: mkWindow('month', mp, MONTH_CAP, m.usage, m.calibrated, m.note, mp.end),
    week: mkWindow('week', wp, WEEK_CAP, w.usage, w.calibrated, w.note, wp.end),
    rolling: mkWindow('rolling', { start: tRoll }, null, dbCounts.rolling, false, null,
      Number.isFinite(rollOldest) ? rollOldest + ROLL_MS : null),
  };
  // Model shares of the month. shareMonth = share of ALL counted usage (the
  // cap denominator); shareGo = share of Go-only usage, which is what the
  // console's "most used this period" panel shows (94/3/1 on 2026-10-26).
  const mTot = dbCounts.month || 1;
  const gTot = perModel.filter((r) => r.provider === 'opencode-go').reduce((a, r) => a + r.msgs.month, 0) || 1;
  for (const r of perModel) {
    r.shareMonth = +(100 * r.msgs.month / mTot).toFixed(1);
    r.shareGo = r.provider === 'opencode-go' ? +(100 * r.msgs.month / gTot).toFixed(1) : null;
  }
  // Daily spend for the last 30 UTC days (trend + pace).
  const DAY = 86400e3;
  const utcMidnight = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const byDay = new Map();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(utcMidnight - i * DAY).toISOString().slice(0, 10);
    byDay.set(d, { date: d, goMsgs: 0, otherMsgs: 0, goUsd: 0, otherUsd: 0 });
  }
  for (const r of q(dbPath,
    `SELECT strftime('%Y-%m-%d', time_created/1000, 'unixepoch'), COALESCE(json_extract(data,'$.providerID'),'?'), COUNT(*), ` +
    `COALESCE(SUM(COALESCE(json_extract(data,'$.cost'),0)),0) ` +
    `FROM message WHERE json_extract(data,'$.role')='assistant' AND time_created>=${now - 30 * DAY} GROUP BY 1,2;`)) {
    const e = byDay.get(r[0]);
    if (!e) continue;
    const n = +r[2] || 0, usd = +r[3] || 0;
    if (r[1] === 'opencode-go') { e.goMsgs += n; e.goUsd += usd; }
    else { e.otherMsgs += n; e.otherUsd += usd; }
  }
  const daily = [...byDay.values()].map((e) => ({
    date: e.date, goMsgs: e.goMsgs, otherMsgs: e.otherMsgs,
    goUsd: +e.goUsd.toFixed(4), otherUsd: +e.otherUsd.toFixed(4),
  }));
  const elapsedDays = Math.max(1 / 24, (now - mp.start) / DAY);
  const paceReqPerDay = +(windows.month.usedReq / elapsedDays).toFixed(1);
  const lastActivity = rows.length ? Math.max(...rows.map((r) => +r[9] || 0)) : 0;
  const alerts = alertsFor(windows);
  // fullRecomputeAt is stamped HERE: every calcSR() result IS a full recompute
  // from DB ground truth, so CLI-written files are first-class.
  const nowIso = new Date().toISOString();
  return {
    schema: SCHEMA,
    generated_at: nowIso, fullRecomputeAt: nowIso,
    unit: 'account requests per fixed period (schema 4); weekly cap PROVISIONAL',
    windows, perModel, alerts, daily, paceReqPerDay,
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
    // node sr-calc.mjs --anchor <month|week> <usage> [--note TEXT] [--db P] [--anchors P]
    const scope = arg('--anchor', null);
    const usage = Number(process.argv[process.argv.indexOf('--anchor') + 2]);
    if (!['month', 'week'].includes(scope) || !Number.isFinite(usage)) {
      console.error('usage: sr-calc.mjs --anchor <month|week> <usage> [--note TEXT]'); process.exit(1);
    }
    const db = arg('--db', DEFAULT_DB);
    const ap = arg('--anchors', DEFAULT_ANCHORS);
    const now = Date.now();
    const period = scope === 'month' ? monthPeriod(now) : weekPeriod(now);
    const anchors = readAnchors(ap);
    anchors[scope] = {
      periodStart: new Date(period.start).toISOString(),
      usage, dbCount: dbCountSince(db, period.start),
      at: new Date(now).toISOString(), note: arg('--note', null),
    };
    writeAnchors(ap, anchors);
    console.log(`anchored ${scope}: usage=${usage} dbCount=${anchors[scope].dbCount} periodStart=${anchors[scope].periodStart}`);
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
