#!/usr/bin/env node
// sr-calc.mjs — shared standardized-request (SR) calculator for cost visibility.
// 1 SR = $0.01 of model spend (~1 GLM-5.3-flash console-mix request).
// Reads: opencode.db (read-only, assistant message rows). No network, stdlib only.
// Usage:
//   node sr-calc.mjs [--db PATH] [--json PATH]     # print JSON (default) / write file
// Import: import { calcSR } from './sr-calc.mjs'  # calcSR(dbPath) -> object
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const HOME = os.homedir();
const DEFAULT_DB = path.join(HOME, '.local/share/opencode/opencode.db');

// Go plan windows (verified against console 2026-10-20: 23 Argon reqs = $1.60
// moved weekly +6pp on the $30 cap and monthly +3pp on the $60 cap).
export const SR = 0.01;
export const SCHEMA = 2;
// Alert thresholds are shared with the pill (amber/red) so every surface
// agrees. 5h keeps its own 80/90 because it is a burst limit, not a budget.
export const WARN_PCT = 70;
export const CRIT_PCT = 90;
export const WINDOWS = {
  h5: { ms: 5 * 3600e3, capUsd: 12, label: '5h rolling' },
  day: { ms: null, capUsd: null, label: 'today (UTC)' }, // info only, no cap
  d7: { ms: 7 * 86400e3, capUsd: 30, label: '7d rolling' },
  d30: { ms: 30 * 86400e3, capUsd: 60, label: '30d rolling' },
};
// Per-family monthly caps on the Go plan (mirror of dashboard.mjs GO caps).
export const FAMILY_CAP = {
  'glm-5.3-flash': 60, 'glm-5.3': 15, 'muse-spark-1.3-contributor': 60,
  'deepseek-v4.1-flash': 80, 'deepseek-v4-pro': 15, 'gpt-6-luna': 15,
  'claude-haiku-5.5': 15, 'mimo-v2.6-pro': 15, 'mimo-v2.6-flash': 60,
  'step-5-preview': 60, 'space-bunny': 30, 'minimax-m3.1-flash': 30,
  'gemini-4-argon-contributor': 60, 'gpt-5.6-luna': 15, 'kimi-k2.7-code': 15,
  'qwen3.8-flash': 15, 'qwen3.7-plus': 15, 'minimax-m3': 15,
  'qwen3.8-max': 15, 'kimi-k3': 15,
};
export function fam(modelId) {
  let s = String(modelId || '').split('/').pop().toLowerCase();
  for (const suf of ['-contributor-free', '-free', '-nightly', '-exp']) {
    if (s.endsWith(suf)) s = s.slice(0, -suf.length);
  }
  const d = s.match(/^(.*)-\d{4}$/);
  if (d) s = d[1];
  return s;
}
const N = (v) => (v === null || v === undefined || v === '' || v === 'NULL' ? 0 : parseFloat(v));

function q(db, sql) {
  const out = execFileSync('sqlite3', [db, '-separator', '\t', sql], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return out.trim() ? out.trim().split('\n').map((l) => l.split('\t')) : [];
}

export function calcSR(dbPath = DEFAULT_DB) {
  const now = Date.now();
  const utcMidnight = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const t = { h5: now - WINDOWS.h5.ms, day: utcMidnight, d7: now - WINDOWS.d7.ms, d30: now - WINDOWS.d30.ms };
  const cost = (w) => `COALESCE(SUM(CASE WHEN time_created>=${t[w]} THEN COALESCE(json_extract(data,'$.cost'),0) ELSE 0 END),0)`;
  const msgs = (w) => `SUM(CASE WHEN time_created>=${t[w]} THEN 1 ELSE 0 END)`;
  // First (oldest) cost-bearing message inside a window: its timestamp + the
  // window length is when spend starts leaving the rolling window again.
  const first = (w) => `MIN(CASE WHEN time_created>=${t[w]} AND COALESCE(json_extract(data,'$.cost'),0)>0 THEN time_created END)`;
  const rows = q(dbPath,
    `SELECT COALESCE(json_extract(data,'$.providerID'),'?'), COALESCE(json_extract(data,'$.modelID'),'?'), COUNT(*), ` +
    `${cost('h5')}, ${msgs('h5')}, ${cost('day')}, ${msgs('day')}, ${cost('d7')}, ${msgs('d7')}, ${cost('d30')}, ${msgs('d30')}, MAX(time_created), ` +
    `${first('h5')}, ${first('d7')}, ${first('d30')} ` +
    `FROM message WHERE json_extract(data,'$.role')='assistant' AND time_created>=${t.d30} GROUP BY 1,2;`);
  const perModel = rows.map((r) => {
    const provider = r[0], model = r[1];
    const famName = fam(model);
    const cap = provider === 'opencode-go' ? (FAMILY_CAP[famName] ?? null) : null;
    const usd = { h5: N(r[3]), day: N(r[5]), d7: N(r[7]), d30: N(r[9]) };
    const n = { h5: +r[4] || 0, day: +r[6] || 0, d7: +r[8] || 0, d30: +r[10] || 0 };
    // Cost/msg over the monthly basis: per-model caps are monthly, so the
    // runway must be compared against 30d spend, not 7d (a 7d rate next to a
    // monthly cap overstated remaining messages).
    const basis = n.d30 >= 5 ? 'd30' : (n.d7 >= 5 ? 'd7' : (n.day >= 1 ? 'day' : null));
    const costPerMsg = basis ? usd[basis] / n[basis] : 0;
    return {
      model, provider, family: famName, cap,
      msgs: n, usd: Object.fromEntries(Object.entries(usd).map(([k, v]) => [k, +v.toFixed(4)])),
      costPerMsg: +costPerMsg.toFixed(5),
      allowedMsgs: cap != null && costPerMsg > 0 ? Math.floor(cap / costPerMsg) : null,
      remainingMsgs: cap != null && costPerMsg > 0 ? Math.max(0, Math.floor((cap - (usd.d30 || 0)) / costPerMsg)) : null,
      usedSR: Object.fromEntries(Object.entries(usd).map(([k, v]) => [k, Math.round(v / SR)])),
    };
  });
  // Window totals are ALL Go spend, independent of the per-family cap map: an
  // unmapped/new Go model must still count toward the shared quota, otherwise
  // the headline percentage silently under-reports.
  const goRows = perModel.filter((r) => r.provider === 'opencode-go');
  const goRaw = rows.filter((r) => r[0] === 'opencode-go');
  const firstTs = {};
  for (const [w, idx] of [['h5', 12], ['d7', 13], ['d30', 14]]) {
    const ts = goRaw.map((r) => +r[idx] || 0).filter((x) => x > 0);
    firstTs[w] = ts.length ? Math.min(...ts) : null;
  }
  const windows = {};
  for (const [w, cfg] of Object.entries(WINDOWS)) {
    const usedUsd = +goRows.reduce((a, r) => a + r.usd[w], 0).toFixed(4);
    const used = Math.round(usedUsd / SR);
    const pct = cfg.capUsd ? +(100 * usedUsd / cfg.capUsd).toFixed(1) : null;
    windows[w] = {
      label: cfg.label, usedUsd, usedSR: used,
      allowedSR: cfg.capUsd != null ? Math.round(cfg.capUsd / SR) : null,
      pct,
      remainingPct: pct == null ? null : +Math.max(0, 100 - pct).toFixed(1),
      // Rolling windows have no reset button: headroom returns when the oldest
      // spend inside the window ages out. Absolute `freesAt` is the primitive
      // (it stays correct while the file ages); freesInSec is a snapshot.
      freesAt: cfg.ms && firstTs[w] ? new Date(firstTs[w] + cfg.ms).toISOString() : null,
      freesInSec: cfg.ms && firstTs[w] ? Math.max(0, Math.round((firstTs[w] + cfg.ms - now) / 1000)) : null,
    };
  }
  // Daily Go spend for the last 30 UTC days (trend + pace). Zero-filled so a
  // sparkline has a stable x-axis on idle days.
  const DAY = 86400e3;
  const byDay = new Map();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(utcMidnight - i * DAY).toISOString().slice(0, 10);
    byDay.set(d, { date: d, goUsd: 0, goMsgs: 0, otherUsd: 0, otherMsgs: 0 });
  }
  for (const r of q(dbPath,
    `SELECT strftime('%Y-%m-%d', time_created/1000, 'unixepoch'), COALESCE(json_extract(data,'$.providerID'),'?'), COUNT(*), ` +
    `COALESCE(SUM(COALESCE(json_extract(data,'$.cost'),0)),0) ` +
    `FROM message WHERE json_extract(data,'$.role')='assistant' AND time_created>=${t.d30} GROUP BY 1,2;`)) {
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
  const paceUsdPerDay = +(windows.d7.usedUsd / 7).toFixed(4);
  const lastActivity = rows.length ? Math.max(...rows.map((r) => +r[11] || 0)) : 0;
  const alerts = [];
  if (windows.h5.pct >= CRIT_PCT) alerts.push('h5_90');
  else if (windows.h5.pct >= 80) alerts.push('h5_80');
  for (const w of ['d7', 'd30']) {
    const p = windows[w].pct;
    if (p >= CRIT_PCT) alerts.push(`${w}_90`);
    else if (p >= WARN_PCT) alerts.push(`${w}_70`);
  }
  return {
    schema: SCHEMA,
    generated_at: new Date().toISOString(), unit: '$0.01 of model spend (~1 GLM-5.3-flash console-mix request)',
    windows, perModel, alerts, daily, paceUsdPerDay,
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
  const db = arg('--db', DEFAULT_DB);
  const out = arg('--json', null);
  const res = calcSR(db);
  const text = JSON.stringify(res, null, 2);
  if (out) fs.writeFileSync(out, text + '\n');
  else console.log(text);
}
