#!/usr/bin/env node
// mini_eval.test.mjs — deterministic unit tests for mini_eval.mjs (no network).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  gradeP1Coding,
  gradeP2Bughunt,
  gradeP3Reasoning,
  gradeP4Agentic,
  buildIsolatedConfig,
  scrubModelIdentity,
  createSealedKey,
  checkSequentialStopping,
  runProbeSuite,
  runCorpusStage,
} from './mini_eval.mjs';

let passed = 0;
let failed = 0;
function ok(cond, label) {
  if (cond) {
    passed++;
    console.log('ok   ' + label);
  } else {
    failed++;
    console.log('FAIL ' + label);
  }
}
function eq(a, b, label) {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x === y) {
    passed++;
    console.log('ok   ' + label);
  } else {
    failed++;
    console.log(`FAIL ${label}\n  want ${y}\n  got  ${x}`);
  }
}

// 1. P1 Coding grader — golden solution gets 35/35
const goldenP1 = `
\`\`\`js
export function summarizeWindow(events, nowMs, windowMs, cap) {
  const seen = new Set();
  const deduped = [];
  for (const ev of events || []) {
    if (!ev || typeof ev !== 'object') continue;
    if (typeof ev.id === 'string' && ev.id.length > 0) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
    }
    deduped.push(ev);
  }
  const minBound = nowMs - windowMs;
  const counts = new Map();
  let used = 0;
  let minTs = Infinity;
  for (const ev of deduped) {
    if (typeof ev.ts !== 'number' || !Number.isFinite(ev.ts)) continue;
    if (ev.ts < minBound || ev.ts > nowMs) continue;
    if (ev.provider !== 'opencode-go') continue;
    if (ev.error) continue;
    if (typeof ev.model !== 'string' || /-free$/i.test(ev.model)) continue;
    used++;
    if (ev.ts < minTs) minTs = ev.ts;
    const short = ev.model.replace(/^opencode-go\\//i, '').toLowerCase();
    counts.set(short, (counts.get(short) || 0) + 1);
  }
  const byModel = {};
  for (const k of [...counts.keys()].sort()) byModel[k] = counts.get(k);
  return {
    used,
    remaining: Math.max(0, cap - used),
    pct: Math.round((used / cap) * 1000) / 10,
    overCap: used > cap,
    oldestExpiresAt: used === 0 ? null : minTs + windowMs,
    byModel,
  };
}
\`\`\`
`;
const g1 = gradeP1Coding(goldenP1);
eq(g1.score, 35, 'P1 golden solution scores 35/35');
eq(g1.passed, 10, 'P1 golden solution passes all 10 unit test cases');

const badP1 = gradeP1Coding('```js\nfunction summarizeWindow() { return null; }\n```');
eq(badP1.score, 0, 'P1 broken implementation scores 0');

// 2. P2 BugHunt grader — golden vs false-positive decoy penalty
const goldenP2 = `\`\`\`json
{
  "findings": [
    {
      "severity": "blocking",
      "file": "src/importer.ts",
      "line": 17,
      "issue": "When doneReason === 'length', committing the transaction persists a truncated partial batch as completed.",
      "fix": "Roll back the transaction and surface a truncation error instead of committing."
    },
    {
      "severity": "major",
      "file": "src/query.ts",
      "line": 7,
      "issue": "String interpolation of accountId in SQL query introduces SQL injection when includeArchived is true.",
      "fix": "Use a parameterized query with '?' placeholder and pass [accountId]."
    },
    {
      "severity": "minor",
      "file": "src/importer.ts",
      "line": 27,
      "issue": "Error message appends 's' (seconds) to timeoutMs which is in milliseconds.",
      "fix": "Format as timeoutMs + 'ms' or divide by 1000."
    }
  ],
  "verdict": "FIX"
}
\`\`\``;
const g2 = gradeP2Bughunt(goldenP2);
eq(g2.score, 35, 'P2 golden findings score 35/35');
eq(g2.falsePositives, 0, 'P2 golden findings have 0 false positives');

const fpP2 = gradeP2Bughunt(
  JSON.stringify({
    findings: [
      ...JSON.parse(goldenP2.replace(/```json|```/g, '')).findings,
      {
        severity: 'major',
        file: 'src/currency.ts',
        line: 6,
        issue: 'Floating point rounding issue',
        fix: 'Use BigInt',
      },
    ],
    verdict: 'FIX',
  }),
);
eq(fpP2.score, 25, 'P2 flagging the clean currency.ts decoy deducts 10 pts');

// 3. P3 Reasoning grader — exact schedule math (16s, A->B->C->E->D, 350 KiB)
const g3 = gradeP3Reasoning('```json\n{"minTotalSeconds": 16, "commitOrder": ["A","B","C","E","D"], "minWriteBufferKiB": 350}\n```');
eq(g3.score, 15, 'P3 exact optimal schedule scores 15/15');

const trapP3 = gradeP3Reasoning('```json\n{"minTotalSeconds": 19, "commitOrder": ["A","B","D","C","E"], "minWriteBufferKiB": 380}\n```');
eq(trapP3.score, 0, 'P3 greedy D-before-C schedule trap scores 0');

// 4. P4 Agentic grader — tool events + exact file:line
const g4 = gradeP4Agentic(
  '```json\n{"file": "src/reconcile.mjs", "line": 23, "defect": "ts >= cutoff", "fix": "ts > cutoff"}\n```',
  [{ type: 'tool', part: { type: 'tool', tool: 'read' } }],
);
eq(g4.score, 15, 'P4 read tool + exact file:line + defect scores 15/15');

const g4Forbidden = gradeP4Agentic(
  '```json\n{"file": "src/reconcile.mjs", "line": 23, "defect": "ts >= cutoff", "fix": "ts > cutoff"}\n```',
  [
    { type: 'tool', part: { type: 'tool', tool: 'read' } },
    { type: 'tool', part: { type: 'tool', tool: 'bash' } },
  ],
);
ok(g4Forbidden.score < 10, 'P4 calling forbidden bash tool loses tool-discipline points');

// 5. Isolation config & identity scrubbing
const standaloneCfg = JSON.parse(buildIsolatedConfig('opencode/iceman-free', 'standalone'));
eq(standaloneCfg.agents.title.model, 'opencode/iceman-free', 'title model rides candidate to prevent paid Go leakage');
ok(
  standaloneCfg.permissions.every((p) => p.effect === 'deny'),
  'standalone config denies all tools to prevent 2026-10-18 exploration rabbit holes',
);

const scrubbed = scrubModelIdentity('Hello from opencode/tidepool-alpha-free (tidepool-alpha)!', [
  'opencode/tidepool-alpha-free',
]);
ok(!scrubbed.includes('tidepool'), 'scrubModelIdentity strips model ID and stem');

// 6. Stage 2 sealed key + sequential stopping math
let threwNoJudge = false;
try {
  createSealedKey({ models: ['opencode/iceman-free'], judge: '', date: '2026-11-22' });
} catch {
  threwNoJudge = true;
}
ok(threwNoJudge, 'Stage 2 refuses to create key.json without a pinned judge');

const stop = checkSequentialStopping(
  { alpha: 30, bravo: 25, charlie: -10 },
  { alpha: 6, bravo: 6, charlie: 6 },
  10,
  9,
);
eq(stop.leader, 'alpha', 'sequential stopping identifies leader');
eq(stop.futile.map((f) => f.code), ['charlie'], 'charlie (-10 with 4 diffs left, max +26 < 30) dropped for mathematical futility');
eq(stop.continueCodes, ['alpha', 'bravo'], 'leader alpha and viable challenger bravo continue');

// 7. End-to-end fake OPENCODE_BIN test for Stage 1 probe & Stage 2 blind corpus + 2-DNF pause
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-eval-test-'));
const fakeBin = path.join(tmp, 'fake-opencode');
fs.writeFileSync(
  fakeBin,
  `#!/usr/bin/env node
const args = process.argv.slice(2);
const mIdx = args.indexOf('-m');
const model = mIdx >= 0 ? args[mIdx + 1] : 'unknown';
const prompt = args[args.length - 1] || '';
if (process.env.OPENCODE_MODEL_FALLBACK !== 'off') {
  console.error('FALLBACK_NOT_DISABLED');
  process.exit(2);
}
if (model.includes('dead-route')) {
  console.log(JSON.stringify({ type: 'error', error: '429 rate limit' }));
  process.exit(1);
}
let text = 'VERDICT: FIX';
if (prompt.includes('summarizeWindow')) {
  text = ${JSON.stringify(goldenP1)};
} else if (prompt.includes('parseUsdToCents')) {
  text = ${JSON.stringify(goldenP2)};
} else if (prompt.includes('minTotalSeconds')) {
  text = '\`\`\`json\\n{"minTotalSeconds":16,"commitOrder":["A","B","C","E","D"],"minWriteBufferKiB":350}\\n\`\`\`';
} else if (prompt.includes('canAdmitRequest')) {
  console.log(JSON.stringify({ type: 'tool', part: { type: 'tool', tool: 'read' } }));
  text = '\`\`\`json\\n{"file":"src/reconcile.mjs","line":23,"defect":"ts >= cutoff","fix":"ts > cutoff"}\\n\`\`\`';
} else {
  text = 'Reviewed by ' + model + '\\n- SEVERITY: blocking\\n- WHERE: a.ts:1\\n- ISSUE: bug\\n- FIX: fix\\nVERDICT: FIX';
}
console.log(JSON.stringify({ type: 'text', part: { text } }));
console.log(JSON.stringify({ type: 'step_finish', part: { tokens: { total: 500, input: 300, output: 150, reasoning: 50 } } }));
`,
  { mode: 0o755 },
);

const probeSummary = runProbeSuite({
  models: ['opencode/iceman-free', 'opencode/dead-route-free'],
  date: '2026-11-22',
  outDir: path.join(tmp, 'eval-probe'),
  bin: fakeBin,
});
eq(probeSummary.models['opencode/iceman-free'].composite, 100, 'fake probe golden run scores 100/100');
eq(probeSummary.models['opencode/iceman-free'].tier, 'Apex', 'tier classified as Apex');
eq(probeSummary.models['opencode/dead-route-free'].delivered, 0, 'dead route records 0 delivered');
const skippedTask = probeSummary.models['opencode/dead-route-free'].tasks.reasoning;
ok(
  /Paused after 2 consecutive provider DNFs/.test(skippedTask.error || ''),
  'probe pauses route after 2 consecutive DNFs instead of burning remaining tasks',
);

const corpusOut = runCorpusStage({
  models: ['opencode/iceman-free', 'opencode/dead-route-free'],
  judge: 'opencode-go/gemini-4-argon',
  phase: 'core6',
  date: '2026-11-22',
  outDir: path.join(tmp, 'eval-corpus'),
  bin: fakeBin,
});
const runFiles = fs.readdirSync(path.join(tmp, 'eval-corpus', 'runs'));
ok(runFiles.length > 0, 'Stage 2 wrote blind run files');
for (const rf of runFiles) {
  const raw = fs.readFileSync(path.join(tmp, 'eval-corpus', 'runs', rf), 'utf8');
  const rec = JSON.parse(raw);
  ok(!('model' in rec), `blind run ${rf} omits model field`);
  ok(!raw.includes('iceman') && !raw.includes('dead-route'), `blind run ${rf} scrubs model name from response`);
}
const statuses = Object.values(corpusOut.statusByCode);
ok(
  statuses.some((s) => s.paused && s.attempted === 2),
  'Stage 2 pauses dead route after 2 consecutive DNFs',
);

fs.rmSync(tmp, { recursive: true, force: true });

if (failed > 0) {
  console.error(`\n${failed} FAILURE(S) out of ${passed + failed}`);
  process.exit(1);
}
console.log(`\nALL MINI-EVAL TESTS PASSED (${passed} assertions)`);
