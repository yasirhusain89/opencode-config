#!/usr/bin/env node
// dashboard.test.mjs — black-box tests for dashboard.mjs. No network.
// Builds fixture config + access snapshot + sqlite DB + log in tmpdir,
// runs the script with explicit flags, asserts the JSON + --write-guide.
// Run: node ~/.config/opencode/skills/model-benchmarks/scripts/dashboard.test.mjs

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'dashboard.mjs');
let failures = 0;
function ok(cond, label) {
  if (cond) console.log('ok   ' + label);
  else { failures++; console.log('FAIL ' + label); }
}
function eq(a, b, label) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) console.log('ok   ' + label);
  else { failures++; console.log(`FAIL ${label}\n  want ${y}\n  got  ${x}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-test-'));
const cfgDir = path.join(tmp, 'config');
fs.mkdirSync(path.join(cfgDir, 'agent'), { recursive: true });
fs.writeFileSync(path.join(cfgDir, 'agent', 'reviewer.md'), '# r\nmodel: opencode/space-bunny-free\n');
fs.writeFileSync(path.join(cfgDir, 'agent', 'docs.md'), '# d\nmodel: opencode/dead-model-free\n');
fs.writeFileSync(path.join(cfgDir, 'opencode.jsonc'), `// e.g. {"model":"opencode/decoy-model","small_model":"opencode/decoy-model"}
{
  "agent": {
    "general": {"model": "opencode-go/minimax-m3.1-flash", "prompt": "https://example.test/*literal*/",},
    "explore": {"model": "opencode-go/glm-5.3-flash"}, // quick lookup
  },
  /* a block-comment decoy: "model": "opencode/decoy-model" */
  "model": "opencode/dead-model-free",
  "small_model": "opencode/beam-free", // trailing comma
}`);
const accessPath = path.join(tmp, 'access.json');
fs.writeFileSync(accessPath, JSON.stringify({ providers: {
  opencode: ['opencode/beam-free', 'opencode/space-bunny-free', 'opencode/glm-5.3-flash-free'],
  'opencode-go': ['opencode-go/glm-5.3-flash', 'opencode-go/minimax-m3.1-flash'],
} }));

const dbPath = path.join(tmp, 'test.db');
const T = (h, m) => Date.UTC(2026, 9, 18, h, m, 0);
function msg(model, provider, tin, tout, treas, tc, ts, o = {}) {
  const { cost = 0, durS = 60, finish = 'tool-calls' } = o;
  const data = { role: 'assistant', modelID: model, providerID: provider, cost, finish, time: { created: ts, completed: ts + durS * 1000 }, tokens: { total: tin + tout + treas + tc, input: tin, output: tout, reasoning: treas, cache: { read: tc, write: 0 } } };
  return `INSERT INTO message (time_created, data) VALUES (${ts}, '${JSON.stringify(data).replace(/'/g, "''")}');`;
}
const sql = `CREATE TABLE message (time_created INTEGER NOT NULL, data TEXT NOT NULL);
${msg('opencode/space-bunny-free', 'opencode', 1000, 10, 0, 5000, T(8, 0), { cost: 0, durS: 17 })}
${msg('opencode/space-bunny-free', 'opencode', 1000, 10, 0, 5000, T(8, 5), { cost: 0, durS: 19 })}
${msg('opencode/space-bunny-free', 'opencode', 1000, 10, 0, 5000, T(8, 10), { cost: 0, durS: 16 })}
${msg('nvidia/z-ai/glm-5.3-flash', 'nvidia', 30000, 700, 0, 91000, T(20, 0), { cost: 0, durS: 99 })}
${msg('nvidia/z-ai/glm-5.3-flash', 'nvidia', 30000, 700, 0, 91000, T(21, 30), { cost: 0, durS: 95 })}
${msg('opencode/glm-5.3-flash-free', 'opencode', 5000, 50, 0, 9000, T(5, 0), { cost: 0, durS: 41 })}
${msg('opencode-go/glm-5.3-flash', 'opencode-go', 900, 20, 0, 6500, T(9, 0), { cost: 0.35, durS: 23 })}
INSERT INTO message (time_created, data) VALUES (${T(9, 30)}, '{"role":"assistant","modelID":"opencode/space-bunny-free","providerID":"opencode","tokens":{"total":0,"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}}');`;
execFileSync('sqlite3', [dbPath], { input: sql, encoding: 'utf8' });

const logPath = path.join(tmp, 'opencode.log');
fs.writeFileSync(logPath, [
  'timestamp=2026-10-18T21:36:57.425Z level=ERROR message="stream error" providerID=nvidia modelID=z-ai/glm-5.3-flash error.error="AI_APICallError: Too Many Requests"',
  'timestamp=2026-10-18T21:49:43.536Z level=ERROR message="stream error" providerID=nvidia modelID=z-ai/glm-5.3-flash error.error="AI_APICallError: Too Many Requests"',
  'timestamp=2026-10-17T10:00:00.000Z level=ERROR message="stream error" providerID=nvidia modelID=z-ai/glm-5.3-flash error.error="AI_APICallError: Too Many Requests"',
  'timestamp=2026-10-18T12:00:00.000Z level=INFO message=stream providerID=nvidia modelID=x ok',
].join('\n') + '\n');

const outPath = path.join(tmp, 'dashboard-2026-10-18.json');
const htmlPath = path.join(tmp, 'frag.html');
const checkPath = path.join(tmp, 'check-2026-10-18.json');
fs.writeFileSync(checkPath, JSON.stringify({ scraped_at: '2026-10-18', agents: [
  { agent: 'reviewer', model: 'opencode/space-bunny-free', aa_slug: null },
  { agent: 'researcher', model: 'opencode/glm-5.3-flash-free', aa_slug: 'glm-5-3-flash' },
] }));
let r = spawnSync(process.execPath, [SCRIPT, '--date', '2026-10-18', '--db', dbPath, '--log', logPath, '--config', cfgDir, '--access', accessPath, '--check', checkPath, '--out', outPath, '--html', htmlPath], { encoding: 'utf8' });
ok(r.status === 0, 'dashboard exits 0, stderr: ' + (r.stderr || '').slice(0, 200));
let j = null;
try { j = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch { /* assert below */ }
ok(!!j, 'dashboard writes JSON');
if (j) {
  eq(j.totals.msgs, 8, 'assistant messages counted (incl. 1 failed row)');
  eq(j.totals.inM, 0.1, 'input M summed'); // (3*1000 + 2*30000 + 5000 + 900)/1e6 = 0.0699 -> 0.1
  eq(j.deadPins.length, 2, 'two dead pins found');
  ok(j.deadPins.every(d => d.model === 'opencode/dead-model-free'), 'dead pin is dead-model-free');
  ok(!JSON.stringify(j.pins).includes('unresolvable'), 'pins listed');
  eq(j.errors429.count, 2, 'two 429s in window (17th excluded)');
  eq(j.errors429.models, ['z-ai/glm-5.3-flash'], '429 model attributed');
  eq(j.goHeadroom.family, 'glm-5.3-flash', 'go headroom family');
  eq(j.goHeadroom.msgs, 4, 'go headroom msgs (family incl. -free + Go route)');
  ok(j.goHeadroom.costPerDay > 0 && j.goHeadroom.cap === 60, 'go $/day + cap');
  eq(j.standardReq.routes.length, 1, 'standardReq covers the Go route');
  eq(j.standardReq.routes[0].usedSR, 35, 'standardReq usedSR = $0.35/$0.01');
  eq(j.standardReq.routes[0].allowedSR, 6000, 'standardReq allowedSR = $60/$0.01');
  eq(j.standardReq.routes[0].allowedMsgs, 171, 'standardReq runway = floor(60/0.35) own-mix msgs');
  eq(j.freeShelf.lastActivity.slice(0, 16), '2026-10-18 09:30', 'free shelf halt detected (failed 09:30 row included)');
  eq(j.peakHour, '2026-10-18 08', 'peak hour');
  ok(j.perRoute[0].model === 'opencode/space-bunny-free' && j.perRoute[0].msgs === 4, 'top route row');
  eq(j.perRoute[0].failPct, 25, 'fail rate on top route (1/4 zero-token)');
  eq(j.perRoute[0].p50s, 17, 'p50 latency on top route');
  eq(j.metered.goUsd, 0.35, 'metered Go $ from DB cost field');
  eq(j.unmatchedCheckPins, [{ where: 'reviewer', model: 'opencode/space-bunny-free' }], 'unmatched check pin flagged');
  eq(j.routing.reviewer.primary, 'opencode/space-bunny-free', 'routing primary comes from reviewer fixture, not a hardcoded Go pin');
  eq(j.routing.small_model.fallback, null, 'small-model bookkeeping has no session prompt handoff');
  eq(j.routing.reviewer.primaryLive, true, 'routing primary live');
  eq(j.routing.reviewer.fallback, null, 'unmapped primary has no invented fallback');
  eq(j.routing.reviewer.fallbackLive, null, 'unmapped fallback has no liveness claim');
  eq(j.routing.general?.primary, 'opencode-go/minimax-m3.1-flash', 'inline general pin included');
  eq(j.routing.explore?.primary, 'opencode-go/glm-5.3-flash', 'inline explore pin included');
  eq(j.routing.main?.primary, 'opencode/dead-model-free', 'top-level model is not confused with inline agent model');
  eq(j.routing.small_model?.primary, 'opencode/beam-free', 'small_model pin included');
  ok(!j.pins.includes('opencode/decoy-model'), 'JSONC comment decoys excluded');
  eq(j.routing.brainstorm, undefined, 'absent agents do not get stale fabricated routes');
  ok(j.goTop && j.goTop.family === 'glm-5.3-flash', 'goTop computed from Go routes');
  ok(j.pacing && j.pacing.daysToWeeklyCap > 0, 'pacing computed');
  ok(j.snapshotAges.check === '2026-10-18', 'snapshot age recorded');
}
const frag = fs.readFileSync(htmlPath, 'utf8');
ok(frag.includes('DASHBOARD-TBODY') && frag.includes('USAGE-TBODY'), 'html fragment markers');
ok(frag.includes('dead-model-free'), 'fragment names dead pin');
const usagePart = frag.split('USAGE-TBODY')[1] || '';
eq((usagePart.match(/<td/g) || []).length, 4 * 8, 'usage rows carry 8 cells (route/msgs/in/cached/equiv/fail/p50/role)');
const rjson = JSON.parse(fs.readFileSync(path.join(tmp, 'routing-2026-10-18.json'), 'utf8'));
eq(rjson.agents, j.routing, 'routing.json mirrors dashboard configured routes');

// All handoff lanes, including both live and historic Haiku spellings.
const handoffModels = {
  reviewer: 'opencode-go/glm-5.3-flash',
  researcher: 'opencode-go/minimax-m3.1-flash',
  'security-reviewer': 'opencode-go/claude-haiku-5-5',
  'legacy-haiku': 'opencode-go/claude-haiku-5.5',
  brainstorm: 'opencode-go/glm-5.3-flash',
  'docs-writer': 'opencode-go/minimax-m3.1-flash',
  'domain-companion': 'opencode-go/muse-spark-1.3-contributor',
  build: 'opencode-go/muse-spark-1.3-contributor',
};
for (const [agent, model] of Object.entries(handoffModels)) {
  fs.writeFileSync(path.join(cfgDir, 'agent', `${agent}.md`), `---\nmodel: ${model}\n---\n`);
}
const handoffPath = path.join(tmp, 'handoff.json');
const fixtureConfig = path.join(cfgDir, 'opencode.jsonc');
fs.writeFileSync(fixtureConfig, fs.readFileSync(fixtureConfig, 'utf8').replace('"opencode/beam-free"', '"opencode-go/glm-5.3-flash"'));
r = spawnSync(process.execPath, [SCRIPT, '--date', '2026-10-18', '--db', dbPath, '--log', logPath, '--config', cfgDir, '--access', accessPath, '--out', handoffPath], { encoding: 'utf8' });
eq(r.status, 0, 'handoff fixture exits 0');
const handoffs = JSON.parse(fs.readFileSync(handoffPath, 'utf8')).routing;
eq(handoffs.small_model.fallback, null, 'even a mapped Go small_model has no session prompt handoff');
for (const [agent, primary] of Object.entries(handoffModels)) {
  const lowStakes = ['brainstorm', 'docs-writer', 'domain-companion'].includes(agent);
  const fallback = lowStakes ? 'nvidia/z-ai/glm-5.3-flash'
    : primary === 'opencode-go/glm-5.3-flash' ? 'opencode-go/minimax-m3.1-flash' : 'opencode-go/glm-5.3-flash';
  eq(handoffs[agent]?.primary, primary, `${agent} primary follows configured pin`);
  eq(handoffs[agent]?.fallback, fallback, `${agent} availability fallback matches policy`);
  eq(handoffs[agent]?.fallbackMode, 'next-prompt-handoff', `${agent} handoff mode explicit`);
  ok(/next-prompt handoff/.test(handoffs[agent]?.why) && /availability-only/.test(handoffs[agent]?.why)
    && /not.*account-wide quota/.test(handoffs[agent]?.why), `${agent} reason explains handoff and quota limits`);
}

// --write-guide on a minimal fixture (same anchor shape as the real guide)
const guidePath = path.join(tmp, 'guide.html');
fs.writeFileSync(guidePath, '<html><body>\n<h2 id="dashboard">1. x</h2>\n<table>\n<tbody>\n<tr><td>OLD</td></tr>\n</tbody>\n</table>\n<h2 id="master">2.</h2>\n<h2 id="usage">8. y</h2>\n<table>\n<tbody>\n<tr><td>OLD2</td></tr>\n</tbody>\n</table>\n</body></html>');
r = spawnSync(process.execPath, [SCRIPT, '--date', '2026-10-18', '--db', dbPath, '--log', logPath, '--config', cfgDir, '--access', accessPath, '--out', path.join(tmp, 'd2.json'), '--write-guide', guidePath], { encoding: 'utf8' });
ok(r.status === 0, 'write-guide exits 0, stderr: ' + (r.stderr || '').slice(0, 200));
const g = fs.readFileSync(guidePath, 'utf8');
ok(!g.includes('OLD') && g.includes('space-bunny-free'), 'guide tbodys replaced');
ok(g.includes('do not hand-edit'), 'generated marker present in guide');
for (const t of ['table', 'tbody', 'tr', 'td']) {
  const oc = (g.match(new RegExp('<' + t + '[ >]', 'g')) || []).length, cc = (g.match(new RegExp('</' + t + '>', 'g')) || []).length;
  ok(oc === cc, `guide tags balanced <${t}>`);
}
// ambiguous anchor must abort, not mangle
const badPath = path.join(tmp, 'bad.html');
fs.writeFileSync(badPath, '<h2 id="dashboard">a</h2><tbody></tbody><h2 id="dashboard">b</h2><tbody></tbody>');
r = spawnSync(process.execPath, [SCRIPT, '--date', '2026-10-18', '--db', dbPath, '--log', logPath, '--config', cfgDir, '--access', accessPath, '--out', path.join(tmp, 'd3.json'), '--write-guide', badPath], { encoding: 'utf8' });
ok(r.status !== 0, 'ambiguous anchor aborts');

fs.rmSync(tmp, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exitCode = 1; }
else console.log('\nALL DASHBOARD TESTS PASSED');
