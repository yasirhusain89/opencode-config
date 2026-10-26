#!/usr/bin/env node
// sr-calc.test.mjs — black-box tests for the schema-4 account model.
// Fixed periods (month 19th–19th, week Mon–Mon, trailing 5h), account-wide
// caps, console anchors. Fixture sqlite DB in tmpdir; timestamps are derived
// from the real period functions so the test holds on any weekday.
// Run: node ~/.config/opencode/skills/model-benchmarks/scripts/sr-calc.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { calcSR, monthPeriod, weekPeriod, SCHEMA, MONTH_CAP, WEEK_CAP, alertsFor } from './sr-calc.mjs';

let failures = 0;
let ran = 0;
function ok(cond, label) { ran++; if (cond) console.log('ok   ' + label); else { failures++; console.log('FAIL ' + label); } }
function eq(a, b, label) {
  ran++;
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) console.log('ok   ' + label);
  else { failures++; console.log(`FAIL ${label}\n  want ${y}\n  got  ${x}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srcalc-test-'));
const db = path.join(tmp, 'test.db');
const anchorsPath = path.join(tmp, 'anchors.json');
const H = 3600e3, DAY = 86400e3;
const now = Date.now();
const mp = monthPeriod(now), wp = weekPeriod(now);

// ---- fixed-period math on known dates (deterministic) ----
{
  const oct26 = Date.UTC(2026, 9, 26, 12); // a Monday
  const m = monthPeriod(oct26);
  eq(new Date(m.start).toISOString(), '2026-10-19T00:00:00.000Z', 'month of Oct 26 starts Oct 19');
  eq(new Date(m.end).toISOString(), '2026-11-19T00:00:00.000Z', 'month of Oct 26 ends Nov 19');
  const m2 = monthPeriod(Date.UTC(2026, 9, 18));
  eq(new Date(m2.start).toISOString(), '2026-09-19T00:00:00.000Z', 'month of Oct 18 starts Sep 19');
  const w = weekPeriod(oct26);
  eq(new Date(w.start).toISOString(), '2026-10-26T00:00:00.000Z', 'week of Mon Oct 26 starts Oct 26');
  eq(new Date(w.end).toISOString(), '2026-11-02T00:00:00.000Z', 'week of Mon Oct 26 ends Nov 2');
  const w2 = weekPeriod(Date.UTC(2026, 9, 25, 12)); // a Sunday
  eq(new Date(w2.start).toISOString(), '2026-10-19T00:00:00.000Z', 'week of Sun Oct 25 starts Mon Oct 19');
}

// ---- fixture: rows placed relative to the REAL current periods ----
// A: inside all three windows. B/C: inside month + maybe week/rolling —
// membership is computed from the period functions, never assumed.
const tA = Math.max(mp.start, wp.start, now - 5 * H) + 30 * 60e3;
const tB = mp.start + 30 * 60e3;
const tC = wp.start + 30 * 60e3;
const tD = now - 40 * DAY; // outside everything
const inWin = (ts, start) => ts >= start;
const rows = [];
const add = (n, ts, provider, model) => { for (let i = 0; i < n; i++) rows.push([ts + i * 1000, provider, model]); };
add(5, tA, 'opencode-go', 'muse-spark-1.3-contributor');
add(3, tB, 'opencode-go', 'deepseek-v4.1-flash');
add(4, tC, 'nvidia', 'z-ai/glm-5.3-flash'); // non-Go counts toward account usage
add(2, tD, 'opencode-go', 'muse-spark-1.3-contributor');
const exp = { month: 0, week: 0, rolling: 0 };
for (const [ts] of rows) {
  if (inWin(ts, mp.start)) exp.month++;
  if (inWin(ts, wp.start)) exp.week++;
  if (inWin(ts, now - 5 * H)) exp.rolling++;
}
let sql = 'CREATE TABLE message (data TEXT, time_created INTEGER);\n';
for (const [ts, prov, model] of rows) {
  const data = JSON.stringify({ role: 'assistant', providerID: prov, modelID: model, cost: 0.01 }).replace(/'/g, "''");
  sql += `INSERT INTO message VALUES ('${data}', ${Math.round(ts)});\n`;
}
fs.writeFileSync(path.join(tmp, 'fixture.sql'), sql);
execFileSync('sqlite3', [db], { input: sql });

// ---- calcSR without anchors: raw DB truth, uncalibrated ----
const j = calcSR(db, anchorsPath);
eq(j.schema, 4, 'output schema = 4');
eq(SCHEMA, 4, 'exported SCHEMA = 4');
const w = j.windows;
eq(w.month.usedReq, exp.month, `month usedReq = DB count in period (${exp.month})`);
eq(w.week.usedReq, exp.week, `week usedReq = DB count in period (${exp.week})`);
eq(w.rolling.usedReq, exp.rolling, `rolling usedReq = DB count in 5h (${exp.rolling})`);
eq(w.month.capReq, MONTH_CAP, 'month cap = 18,000 (calibrated)');
eq(w.week.capReq, WEEK_CAP, 'week cap = 8,000 (PROVISIONAL)');
eq(w.rolling.capReq, null, 'rolling has no cap');
eq(w.rolling.pct, null, 'rolling has no pct');
eq(w.month.freesAt, new Date(mp.end).toISOString(), 'month freesAt = period end');
eq(w.week.freesAt, new Date(wp.end).toISOString(), 'week freesAt = period end');
eq(w.month.calibrated, false, 'month uncalibrated without anchor');
eq(w.week.calibrated, false, 'week uncalibrated without anchor');
ok(Math.abs(w.month.pct - (exp.month / MONTH_CAP) * 100) < 1e-9, 'month pct = usage/cap');
eq(w.month.allowedReq, MONTH_CAP - exp.month, 'month allowedReq = cap - usage');
// per-model: Go shares mirror the console panel; non-Go rows counted in usage
const pm = Object.fromEntries(j.perModel.map((m) => [m.provider + '/' + m.model, m]));
const goMonth = j.perModel.filter((m) => m.provider === 'opencode-go').reduce((a, m) => a + m.msgs.month, 0);
ok(Math.abs((pm['opencode-go/muse-spark-1.3-contributor'].shareGo || 0) -
  100 * pm['opencode-go/muse-spark-1.3-contributor'].msgs.month / goMonth) < 0.06,
  'shareGo = Go-only share (console panel semantics)');
eq(pm['nvidia/z-ai/glm-5.3-flash'].shareGo, null, 'non-Go rows have no Go share');
ok((pm['nvidia/z-ai/glm-5.3-flash'].msgs.month || 0) > 0 || exp.month === goMonth,
  'non-Go usage counted in account total');

// ---- anchors: console truth + exact DB deltas ----
{
  const anchored = {
    month: { periodStart: new Date(mp.start).toISOString(), usage: 9000, dbCount: exp.month - 2, at: new Date(now).toISOString(), note: 'test' },
    week: { periodStart: '2000-01-01T00:00:00.000Z', usage: 5, dbCount: 0, at: new Date(now).toISOString(), note: 'stale period' },
  };
  fs.writeFileSync(anchorsPath, JSON.stringify(anchored));
  const j2 = calcSR(db, anchorsPath);
  eq(j2.windows.month.usedReq, 9002, 'anchored month usage = anchor + DB delta');
  eq(j2.windows.month.calibrated, true, 'month calibrated with matching anchor');
  eq(j2.windows.week.usedReq, exp.week, 'stale-period anchor ignored, DB truth used');
  eq(j2.windows.week.calibrated, false, 'week uncalibrated with stale anchor');
}

// ---- alerts: only CALIBRATED windows may alert; uncalibrated pct is unreliable ----
eq(alertsFor({ month: { calibrated: true, pct: 91.7 }, week: { calibrated: false, pct: 99 } }),
  ['month_90'], 'uncalibrated week pct suppressed, calibrated month alerts');
eq(alertsFor({ month: { calibrated: false, pct: 99 }, week: { calibrated: true, pct: 40 } }),
  [], 'uncalibrated month pct suppressed, calibrated week below threshold');
eq(alertsFor({ month: { calibrated: true, pct: 75 }, week: { calibrated: true, pct: 71 } }),
  ['month_70', 'week_70'], 'calibrated warn-threshold windows alert');
eq(alertsFor({ month: { calibrated: true, pct: 99.9 }, week: { calibrated: true, pct: 95 } }),
  ['month_90', 'week_90'], 'calibrated crit windows alert (crit outranks warn)');
eq(alertsFor({ week: { calibrated: true, pct: 95 } }), ['week_90'], 'missing month window is skipped');

fs.rmSync(tmp, { recursive: true, force: true });
if (failures) { console.log(`\n${failures} FAILURE(S) of ${ran}`); process.exit(1); }
console.log(`\nALL PASS (${ran} assertions)`);
