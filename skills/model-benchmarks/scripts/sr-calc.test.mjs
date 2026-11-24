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
import { fileURLToPath } from 'node:url';
import { calcSR, monthPeriod, weekPeriod, SCHEMA, MONTH_CAP, WEEK_CAP, alertsFor, allowanceFor, tokenUsdFor, estimateTurnUsd } from './sr-calc.mjs';

const calcPath = fileURLToPath(new URL('./sr-calc.mjs', import.meta.url));

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
// A: inside all three windows (max of the three starts, so robust when the
// month starts mid-week). B/C: inside month + maybe week/rolling —
// membership is computed from the period functions, never assumed. The
// nvidia rows are purposeful noise: the Go quota must ignore them. The
// `-free` Go rows are free-pool traffic: outside Go quota, own tighter
// limits, must also be ignored by the quota count. errRow is a failed (HTTP
// 500, non-limit) Go row in all windows: failures never bill, so quota
// counts and shares must exclude it while per-model msgs keeps it.
const tA = Math.max(mp.start, wp.start, now - 5 * H) + 30 * 60e3;
const tB = mp.start + 30 * 60e3;
const tC = wp.start + 30 * 60e3;
const tD = now - 40 * DAY; // outside everything
const inWin = (ts, start) => ts >= start;
const rows = [];
const add = (n, ts, provider, model) => { for (let i = 0; i < n; i++) rows.push([ts + i * 1000, provider, model]); };
add(5, tA, 'opencode-go', 'muse-spark-1.3-contributor');
add(1, tA, 'nvidia', 'z-ai/glm-5.3-flash'); // non-Go traffic in ALL windows, NOT Go quota usage
add(2, tA, 'opencode-go', 'glm-5.3-flash-free'); // free-pool traffic, NOT Go quota usage
add(3, tB, 'opencode-go', 'deepseek-v4.1-flash');
add(4, tC, 'nvidia', 'z-ai/glm-5.3-flash'); // non-Go traffic, NOT Go quota usage
add(2, tD, 'opencode-go', 'muse-spark-1.3-contributor');
const errRow = [tA + 500, 'opencode-go', 'muse-spark-1.3-contributor'];
const isFree = (m) => /-free$/i.test(String(m || ''));
const expAll = { month: 0, week: 0, rolling: 0 };
const expGo = { month: 0, week: 0, rolling: 0 };
for (const [ts, provider, model] of rows) {
  for (const [k, start] of [['month', mp.start], ['week', wp.start], ['rolling', now - 5 * H]]) {
    if (inWin(ts, start)) {
      expAll[k]++;
      if (provider === 'opencode-go' && !isFree(model)) expGo[k]++;
    }
  }
}
let sql = 'CREATE TABLE message (data TEXT, time_created INTEGER);\n';
for (const [ts, prov, model] of rows) {
  const data = JSON.stringify({ role: 'assistant', providerID: prov, modelID: model, cost: 0.01 }).replace(/'/g, "''");
  sql += `INSERT INTO message VALUES ('${data}', ${Math.round(ts)});\n`;
}
{ // the failed row: same shape + error (never billed)
  const data = JSON.stringify({ role: 'assistant', providerID: errRow[1], modelID: errRow[2], cost: 0, error: { type: 'other', message: 'boom', status: 500 } }).replace(/'/g, "''");
  sql += `INSERT INTO message VALUES ('${data}', ${Math.round(errRow[0])});\n`;
}
fs.writeFileSync(path.join(tmp, 'fixture.sql'), sql);
execFileSync('sqlite3', [db], { input: sql });

// ---- calcSR: tier-normalized quota, always calibrated ----
// Fixture rows carry cost 0.01 and no tokens → priced = recorded 0.01.
// Allowance tiers: muse-spark month/week/rolling = 60/12/30,
// deepseek-v4.1-flash = 100/20/50.
const ALLOW = { 'muse-spark-1.3-contributor': [60, 12, 30], 'deepseek-v4.1-flash': [100, 20, 50] };
const expPct = { month: 0, week: 0, rolling: 0 };
for (const [ts, provider, model] of rows) {
  if (provider !== 'opencode-go' || isFree(model)) continue;
  const allow = ALLOW[model];
  const wins = [['month', mp.start, 0], ['week', wp.start, 2], ['rolling', now - 5 * H, 1]];
  for (const [k, start, ai] of wins) if (inWin(ts, start)) expPct[k] += (0.01 / allow[ai]) * 100;
}
const j = calcSR(db, anchorsPath);
eq(j.schema, 4, 'output schema = 4');
eq(SCHEMA, 4, 'exported SCHEMA = 4');
const w = j.windows;
eq(w.month.usedReq, expGo.month, `month usedReq = Go count in period (${expGo.month})`);
eq(w.week.usedReq, expGo.week, `week usedReq = Go count in period (${expGo.week})`);
eq(w.rolling.usedReq, expGo.rolling, `rolling usedReq = Go count in 5h (${expGo.rolling})`);
eq(w.month.dbCount, expGo.month, 'month dbCount reports the Go basis count');
ok(expAll.month > expGo.month, 'fixture has non-Go month rows (must not count toward quota)');
eq(w.month.capReq, null, 'request caps retired: month capReq is null');
eq(w.week.capReq, null, 'request caps retired: week capReq is null');
eq(w.month.allowedReq, null, 'request caps retired: month allowedReq is null');
ok(Number.isFinite(w.rolling.pct), 'rolling has a live tier-normalized pct');
for (const k of ['month', 'week', 'rolling']) {
  // Per-model quotaPct rounds to 3 decimals, so the window sum carries ≤0.5e-3
  // rounding per model — tolerance covers it (pct displays at 1 decimal).
  ok(Math.abs(w[k].pct - expPct[k]) < 1e-3, `${k} pct = tier-normalized token dollars (${expPct[k].toFixed(4)}%)`);
  eq(w[k].calibrated, true, `${k} calibrated without anchors (formula is self-calibrating)`);
  eq(w[k].usedUsd, +(0.01 * expGo[k]).toFixed(4), `${k} usedUsd = priced Go dollars`);
}
eq(w.rolling.blocked, false, 'rolling not blocked without a 5h-limit 429');
eq(w.month.freesAt, new Date(mp.end).toISOString(), 'month freesAt = period end');
eq(w.week.freesAt, new Date(wp.end).toISOString(), 'week freesAt = period end');
// per-model: Go shares mirror the console panel; non-Go and free-pool rows are
// still reported per model but never enter the quota count. Failed rows never
// bill: msgs keeps them (traffic visibility) but msgsOk and shareGo exclude.
const pm = Object.fromEntries(j.perModel.map((m) => [m.provider + '/' + m.model, m]));
const goMonthOk = j.perModel.filter((m) => m.provider === 'opencode-go' && !/-free$/i.test(m.model)).reduce((a, m) => a + m.msgsOk.month, 0);
eq(goMonthOk, expGo.month, 'msgsOk sums successful Go rows only (failed 500 excluded)');
ok(Math.abs((pm['opencode-go/muse-spark-1.3-contributor'].shareGo || 0) -
  100 * pm['opencode-go/muse-spark-1.3-contributor'].msgsOk.month / goMonthOk) < 0.06,
  'shareGo = successful-Go-only share (failed retries excluded)');
eq(pm['opencode-go/muse-spark-1.3-contributor'].msgs.month, pm['opencode-go/muse-spark-1.3-contributor'].msgsOk.month + 1,
  'msgs keeps the failed row for visibility');
eq(pm['nvidia/z-ai/glm-5.3-flash'].shareGo, null, 'non-Go rows have no Go share');
ok((pm['nvidia/z-ai/glm-5.3-flash'].msgs.month || 0) > 0,
  'non-Go traffic still reported per model, excluded from quota');
eq(pm['opencode-go/glm-5.3-flash-free'].shareGo, null, 'free-pool Go rows have no Go share');
ok((pm['opencode-go/glm-5.3-flash-free'].msgs.month || 0) > 0,
  'free-pool traffic still reported per model, excluded from quota');
eq(pm['opencode-go/glm-5.3-flash-free'].freePool, true, 'free-pool rows flagged');
ok(pm['opencode-go/glm-5.3-flash-free'].quotaPct?.month == null, 'free-pool rows have no quota pct');
ok((pm['opencode-go/muse-spark-1.3-contributor'].shareQuota || 0) > 0, 'quota share present for Go models');

// ---- pct overrides: console % pins a window, everything else is formula ----
{
  const anchored = {
    month: { periodStart: new Date(mp.start).toISOString(), pct: 42, source: 'v1', at: new Date(now).toISOString(), note: 'console' },
    week: { periodStart: '2000-01-01T00:00:00.000Z', pct: 99, source: 'v1', at: new Date(now).toISOString(), note: 'stale period' },
  };
  fs.writeFileSync(anchorsPath, JSON.stringify(anchored));
  const j2 = calcSR(db, anchorsPath);
  eq(j2.windows.month.pct, 42, 'matching-period pct override wins over the formula');
  eq(j2.windows.month.calibrated, true, 'month calibrated with matching override');
  eq(j2.windows.month.usedReq, expGo.month, 'override changes pct only, not request counts');
  ok(Math.abs(j2.windows.week.pct - expPct.week) < 1e-3, 'stale-period override ignored, formula used');
  eq(j2.windows.week.calibrated, true, 'week calibrated by formula');
}

// ---- legacy count anchors are ignored (request-cap model retired) ----
{
  const legacy = {
    month: { periodStart: new Date(mp.start).toISOString(), usage: 9000, dbCount: expAll.month - 2, source: 'v1', at: new Date(now).toISOString(), note: 'legacy' },
  };
  fs.writeFileSync(anchorsPath, JSON.stringify(legacy));
  const jl = calcSR(db, anchorsPath);
  ok(Math.abs(jl.windows.month.pct - expPct.month) < 1e-3, 'legacy count anchor ignored, formula used');
  eq(jl.windows.month.calibrated, true, 'formula is calibrated without anchors');
}

// ---- --anchor records a console pct at the reading instant ----
{
  const atIso = new Date(tB + 3 * 1000).toISOString();
  execFileSync('node', [calcPath, '--anchor', 'month', '52.5', '--db', db, '--anchors', anchorsPath, '--at', atIso], { encoding: 'utf8' });
  const a = JSON.parse(fs.readFileSync(anchorsPath, 'utf8')).month;
  eq(a.pct, 52.5, '--anchor stores the console pct');
  eq(a.periodStart, new Date(mp.start).toISOString(), '--anchor stamps the containing period');
  eq(a.at, atIso, '--anchor records the reading timestamp, not command time');
  const jA = calcSR(db, anchorsPath);
  eq(jA.windows.month.pct, 52.5, 'override applies on the next calcSR');
}

// ---- anchor source mismatch is ignored ----
{
  const mismatched = {
    month: { periodStart: new Date(mp.start).toISOString(), pct: 1, source: 'v9', at: new Date(now).toISOString(), note: 'wrong source' },
  };
  fs.writeFileSync(anchorsPath, JSON.stringify(mismatched));
  const j3 = calcSR(db, anchorsPath);
  ok(Math.abs(j3.windows.month.pct - expPct.month) < 1e-3, 'source-mismatched override ignored');
}

// ---- 5h Go limit: the provider 429 marks the rolling window blocked ----
{
  const bdb = path.join(tmp, 'block.db');
  const bans = path.join(tmp, 'block-anchors.json');
  const mk = (blockRows) => {
    let s = 'CREATE TABLE message (data TEXT, time_created INTEGER);\n';
    for (const [ts, model, error] of blockRows) {
      const data = JSON.stringify({ role: 'assistant', providerID: 'opencode-go', modelID: model, cost: 0.01, ...(error ? { error } : {}) }).replace(/'/g, "''");
      s += `INSERT INTO message VALUES ('${data}', ${Math.round(ts)});\n`;
    }
    fs.rmSync(bdb, { force: true });
    execFileSync('sqlite3', [bdb], { input: s });
  };
  const limit = (msg, retryAfterMs) => ({ type: 'provider.go-limit', message: msg, status: 429, retryAfterMs });
  const structured = (limitName, retryAfterMs) => ({ type: 'provider.go-limit', message: 'OpenCode Go usage limit reached.', status: 429, retryAfterMs, response: { body: JSON.stringify({ metadata: { limitName } }) } });
  const fiveHour = 'OpenCode Go 5 hour usage limit reached. Switch to a free model, or turn on Extra Usage on the Go page in OpenCode Console to keep going.';
  const monthly = 'OpenCode Go monthly usage limit reached. Switch to a free model, or turn on Extra Usage on the Go page in OpenCode Console to keep going.';
  const okAt = now - 3 * H, blockAt = now - 2 * H;
  const model = 'muse-spark-1.3-contributor';

  mk([[okAt, model], [blockAt, model, limit(fiveHour, 3 * H)]]);
  let jb = calcSR(bdb, bans);
  eq(jb.windows.rolling.blocked, true, '5h-limit 429 marks rolling blocked');
  eq(jb.windows.rolling.blockedAt, new Date(blockAt).toISOString(), 'blockedAt = the provider 429 row time');
  eq(jb.windows.rolling.blockedUntil, new Date(blockAt + 3 * H).toISOString(), 'blockedUntil = 429 + retryAfterMs (provider reset)');
  eq(jb.windows.rolling.capReq, null, 'blocked rolling still has no request cap');
  ok(Number.isFinite(jb.windows.rolling.pct), 'blocked rolling still reports tier-normalized pct');
  eq(jb.windows.month.blocked, false, '5h-limit 429 does not block the month window');

  mk([[okAt, model], [blockAt, model, limit(fiveHour, 3 * H)], [now - 1 * H, model]]);
  jb = calcSR(bdb, bans);
  eq(jb.windows.rolling.blocked, false, 'a successful Go request after the 429 clears the block');

  mk([[okAt, model], [blockAt, model, limit(monthly, 3 * H)]]);
  jb = calcSR(bdb, bans);
  eq(jb.windows.rolling.blocked, false, 'monthly-limit 429 (same error type) does not block the 5h window');
  eq(jb.windows.month.blocked, true, 'monthly-limit 429 blocks the month window');
  eq(jb.windows.month.blockedUntil, new Date(blockAt + 3 * H).toISOString(), 'month blockedUntil = 429 + retryAfterMs');
  eq(jb.windows.week.blocked, false, 'monthly-limit 429 does not block the week window');

  mk([[okAt, model], [blockAt, model, structured('5 hour', 3 * H)]]);
  jb = calcSR(bdb, bans);
  eq(jb.windows.rolling.blocked, true, 'structured limitName=5 hour blocks without the message text');

  mk([[okAt, model], [blockAt, model, structured('monthly', 3 * H)]]);
  jb = calcSR(bdb, bans);
  eq(jb.windows.rolling.blocked, false, 'structured limitName=monthly does not block the 5h window');
  eq(jb.windows.month.blocked, true, 'structured limitName=monthly blocks the month window');

  mk([[okAt, model], [blockAt, model, limit(fiveHour, H)]]);
  jb = calcSR(bdb, bans);
  eq(jb.windows.rolling.blocked, false, 'expired provider reset clears the block');

  mk([[okAt, model], [blockAt, model, limit(fiveHour, undefined)]]);
  jb = calcSR(bdb, bans);
  eq(jb.windows.rolling.blocked, true, 'missing retryAfterMs still blocks');
  eq(jb.windows.rolling.blockedUntil, new Date(blockAt + 5 * H).toISOString(), 'fallback reset = 429 time + 5h');

  // Expired buckets reset: pre-reset requests leave the new bucket.
  {
    const preAt = now - 3 * H, resetBlockAt = now - 2 * H, postAt = now - 30 * 60e3;
    mk([[preAt, model], [resetBlockAt, model, limit(fiveHour, H)], [postAt, model]]);
    const je = calcSR(bdb, bans);
    eq(je.windows.rolling.blocked, false, 'expired 5h reset is not blocked');
    eq(je.windows.rolling.usedReq, 1, 'pre-reset requests are dropped from the fresh bucket');
  }
}

// ---- token pricing: recorded cost vs token estimate, max wins ----
{
  const tdb = path.join(tmp, 'price.db');
  const tans = path.join(tmp, 'price-anchors.json');
  const mkRow = (rows) => {
    let s = 'CREATE TABLE message (data TEXT, time_created INTEGER);\n';
    for (const [ts, model, extra] of rows) {
      const data = JSON.stringify({ role: 'assistant', providerID: 'opencode-go', modelID: model, cost: 0, ...extra }).replace(/'/g, "''");
      s += `INSERT INTO message VALUES ('${data}', ${Math.round(ts)});\n`;
    }
    fs.rmSync(tdb, { force: true });
    execFileSync('sqlite3', [tdb], { input: s });
  };
  const tok = (tin, tout, tcr) => ({ tokens: { input: tin, output: tout, reasoning: 0, cache: { read: tcr, write: 0 } } });
  // 1M input tokens of muse-spark @ $0.10 = $0.10 est, recorded 0 → priced 0.10.
  mkRow([[now - H, 'muse-spark-1.3-contributor', tok(1e6, 0, 0)]]);
  let jp = calcSR(tdb, tans);
  let mpm = jp.perModel.find((m) => m.model === 'muse-spark-1.3-contributor');
  eq(mpm.usd.month, 0.1, 'token estimate prices V2 zero-cost rows');
  ok(Math.abs(jp.windows.month.pct - (0.1 / 60) * 100) < 1e-3, 'window pct uses priced dollars');
  // Recorded cost wins when higher: est $0.10, recorded $5 → priced $5.
  mkRow([[now - H, 'muse-spark-1.3-contributor', { ...tok(1e6, 0, 0), cost: 5 }]]);
  jp = calcSR(tdb, tans);
  mpm = jp.perModel.find((m) => m.model === 'muse-spark-1.3-contributor');
  eq(mpm.usd.month, 5, 'recorded cost wins when higher than the estimate');
  // Unknown model: recorded fallback, $15-tier allowance.
  mkRow([[now - H, 'mystery-model-xyz', { cost: 1.5 }]]);
  jp = calcSR(tdb, tans);
  mpm = jp.perModel.find((m) => m.model === 'mystery-model-xyz');
  eq(mpm.usd.month, 1.5, 'unpriced model falls back to recorded cost');
  ok(Math.abs((mpm.quotaPct.month || 0) - (1.5 / 15) * 100) < 1e-9, 'unpriced model uses the $15 default tier');
}

// ---- pricing helpers ----
eq(allowanceFor('gemini-4-argon', 'month'), 30, 'allowanceFor month tier');
eq(allowanceFor('gemini-4-argon', 'rolling'), 6, 'allowanceFor 5h tier');
eq(allowanceFor('mystery-model-xyz', 'week'), 7.5, 'allowanceFor defaults to the $15 tier');
eq(tokenUsdFor('muse-spark-1.3-contributor', 1e6, 0, 0), 0.1, 'tokenUsdFor prices input tokens');
eq(tokenUsdFor('mystery-model-xyz', 1e6, 0, 0), null, 'tokenUsdFor is null without a published price');
eq(estimateTurnUsd('muse-spark-1.3-contributor', { input: 1e6, output: 0, cache: { read: 0 } }), 0.1, 'estimateTurnUsd reads event token shapes');
eq(estimateTurnUsd('muse-spark-1.3-contributor', null), null, 'estimateTurnUsd is null without tokens');

// ---- alerts: all calibrated windows alert, rolling included ----
eq(alertsFor({ month: { calibrated: true, pct: 91.7 }, week: { calibrated: false, pct: 99 }, rolling: { calibrated: true, pct: 10 } }),
  ['month_90'], 'uncalibrated week pct suppressed, calibrated month alerts');
eq(alertsFor({ month: { calibrated: false, pct: 99 }, week: { calibrated: true, pct: 40 } }),
  [], 'uncalibrated month pct suppressed, calibrated week below threshold');
eq(alertsFor({ month: { calibrated: true, pct: 75 }, week: { calibrated: true, pct: 71 } }),
  ['month_70', 'week_70'], 'calibrated warn-threshold windows alert');
eq(alertsFor({ month: { calibrated: true, pct: 99.9 }, week: { calibrated: true, pct: 95 } }),
  ['month_90', 'week_90'], 'calibrated crit windows alert (crit outranks warn)');
eq(alertsFor({ week: { calibrated: true, pct: 95 } }), ['week_90'], 'missing month window is skipped');
eq(alertsFor({ rolling: { calibrated: true, pct: 95 } }), ['rolling_90'], 'rolling alerts before the 429 wall');

fs.rmSync(tmp, { recursive: true, force: true });
if (failures) { console.log(`\n${failures} FAILURE(S) of ${ran}`); process.exit(1); }
console.log(`\nALL PASS (${ran} assertions)`);
