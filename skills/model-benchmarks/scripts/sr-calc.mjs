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
  const rows = q(dbPath,
    `SELECT COALESCE(json_extract(data,'$.providerID'),'?'), COALESCE(json_extract(data,'$.modelID'),'?'), COUNT(*), ` +
    `${cost('h5')}, ${msgs('h5')}, ${cost('day')}, ${msgs('day')}, ${cost('d7')}, ${msgs('d7')}, ${cost('d30')}, ${msgs('d30')}, MAX(time_created) ` +
    `FROM message WHERE json_extract(data,'$.role')='assistant' AND time_created>=${t.d30} GROUP BY 1,2;`);
  const perModel = rows.map((r) => {
    const provider = r[0], model = r[1];
    const famName = fam(model);
    const cap = provider === 'opencode-go' ? (FAMILY_CAP[famName] ?? null) : null;
    const usd = { h5: N(r[3]), day: N(r[5]), d7: N(r[7]), d30: N(r[9]) };
    const n = { h5: +r[4] || 0, day: +r[6] || 0, d7: +r[8] || 0, d30: +r[10] || 0 };
    // cost/msg over the longest window with >=5 msgs (stable runway estimate)
    const basis = n.d7 >= 5 ? 'd7' : (n.d30 >= 5 ? 'd30' : (n.day >= 1 ? 'day' : null));
    const costPerMsg = basis ? usd[basis] / n[basis] : 0;
    return {
      model, provider, family: famName, cap,
      msgs: n, usd: Object.fromEntries(Object.entries(usd).map(([k, v]) => [k, +v.toFixed(4)])),
      costPerMsg: +costPerMsg.toFixed(5),
      allowedMsgs: cap != null && costPerMsg > 0 ? Math.floor(cap / costPerMsg) : null,
      usedSR: Object.fromEntries(Object.entries(usd).map(([k, v]) => [k, Math.round(v / SR)])),
    };
  });
  const goRows = perModel.filter((r) => r.provider === 'opencode-go' && r.cap != null);
  const windows = {};
  for (const [w, cfg] of Object.entries(WINDOWS)) {
    const usedUsd = +goRows.reduce((a, r) => a + r.usd[w], 0).toFixed(4);
    const used = Math.round(usedUsd / SR);
    windows[w] = {
      label: cfg.label, usedUsd, usedSR: used,
      allowedSR: cfg.capUsd != null ? Math.round(cfg.capUsd / SR) : null,
      pct: cfg.capUsd ? +(100 * usedUsd / cfg.capUsd).toFixed(1) : null,
    };
  }
  const lastActivity = rows.length ? Math.max(...rows.map((r) => +r[11] || 0)) : 0;
  const alerts = [];
  if (windows.h5.pct >= 90) alerts.push('h5_90');
  else if (windows.h5.pct >= 80) alerts.push('h5_80');
  else if (windows.h5.pct >= 50) alerts.push('h5_50');
  if (windows.d7.pct >= 80) alerts.push('d7_80');
  if (windows.d30.pct >= 80) alerts.push('d30_80');
  return {
    generated_at: new Date().toISOString(), unit: '$0.01 of model spend (~1 GLM-5.3-flash console-mix request)',
    windows, perModel, alerts,
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
