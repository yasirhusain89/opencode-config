#!/usr/bin/env node
// mini_eval.mjs — 2-stage mini evaluation harness for new & stealth model launches.
//
// Why 2 stages (see EXPERIENCE.md §1/§4 & guide §16):
//   Stage 1 (`probe`): 4 deterministic, 100% auto-graded micro-tasks (~4 reqs,
//     ~60–120s/model, zero judge bias) that quantify stealth/unbenchmarked
//     launches (e.g. iceman, tidepool-alpha, big-pickle, flint-40b, hy4-flash,
//     longcat-2.5) across the 4 axes we care about for building software:
//       P1 coding    (35 pts) — synthesis + boundary/invariant unit tests (10 cases)
//       P2 bughunt   (35 pts) — 3 planted bugs (blocking/major/minor) + 1 clean decoy (FP trap)
//       P3 reasoning (15 pts) — multi-constraint dependency/rollback schedule (3 exact parts)
//       P4 agentic   (15 pts) — sandboxed read/grep root-cause hunt (tool discipline + file:line)
//     Plus operational telemetry from `--format json`: delivery %, p50 wall s,
//     effective tok/s, reasoning token share, and cache-read ratio.
//
//   Stage 2 (`corpus` + `score`): hardened §16 blind 10-diff reviewer eval on
//     the frozen MonArtha patch corpus (`snapshots/evals/2026-10-18/corpus/`).
//     Fixes all three 2026-10-18 incidents:
//       1. True blind sealing: `runs/<code-dXX>.json` NEVER stores `model` and
//          scrubs self-identifying strings; only `key.json` maps code -> model.
//       2. Zero tool-wander DNFs: standalone tasks run with tool-deny config in
//          `OPENCODE_CONFIG_CONTENT`, `--archived`, `--title`, and
//          `OPENCODE_MODEL_FALLBACK=off` (no silent fallback handoffs mid-eval,
//          no paid Go title-gen leakage when testing free routes).
//       3. Sequential stopping & DNF rules enforced: runs mandatory core-6 diffs
//          first (≥4 diff types), pauses any route after 2 consecutive DNFs,
//          drops only mathematically futile contenders after core-6, and never
//          stops the leader early.
//
// Usage:
//   node scripts/mini_eval.mjs probe <model...> [--date YYYY-MM-DD] [--out-dir DIR] [--timeout-ms 180000]
//   node scripts/mini_eval.mjs corpus <model...> --judge <judge-model-id> [--phase core6|all10] [--date YYYY-MM-DD] [--out-dir DIR]
//   node scripts/mini_eval.mjs score --dir <eval-dir>

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EVALS_ROOT = path.join(ROOT, 'snapshots', 'evals');
const CORPUS_DIR = path.join(EVALS_ROOT, '2026-10-18', 'corpus');
const DEFAULT_BIN = process.env.OPENCODE_BIN || '/Users/yasihusain/.opencode/bin/opencode';

// ---------------------------------------------------------------------------
// Stage 1 — Deterministic Probe Tasks (P1..P4)
// ---------------------------------------------------------------------------

export const PROBE_TASKS = {
  coding: {
    id: 'P1-coding',
    axis: 'Engineering / Code Synthesis',
    maxPts: 35,
    prompt: `Self-contained eval: do NOT call any tools. Reply with ONLY a single fenced \`\`\`js code block exporting or defining \`function summarizeWindow(events, nowMs, windowMs, cap)\`.

Specification:
Given an array of request event objects \`events\`, a current timestamp \`nowMs\` (number), a trailing window size \`windowMs\` (number > 0), and an integer request \`cap\` (number > 0), return an object summarizing quota usage in the trailing window \`[nowMs - windowMs, nowMs]\` (BOTH endpoints inclusive):

1. Count ONLY events that meet ALL of:
   - \`typeof ev.ts === 'number' && Number.isFinite(ev.ts)\` and \`ev.ts >= nowMs - windowMs && ev.ts <= nowMs\`
   - \`ev.provider === 'opencode-go'\`
   - \`!ev.error\` (truthy \`ev.error\` rows are rejected/unbilled and must be ignored)
   - \`typeof ev.model === 'string'\` and \`ev.model\` does NOT end with \`'-free'\` (case-insensitive; free-pool rows never burn Go quota)
2. Deduplicate by \`ev.id\`: if multiple events share the same non-empty string \`ev.id\`, process only the FIRST occurrence in array order (even if the first occurrence was outside the window or filtered out? NO: deduplicate raw events by non-empty string \`ev.id\` keeping the first occurrence in the input array, then apply the filter in step 1).Events without a non-empty string \`ev.id\` are never deduplicated.
3. Return:
   \`{ used, remaining, pct, overCap, oldestExpiresAt, byModel }\`
   where:
   - \`used\`: integer count of qualifying events
   - \`remaining\`: \`Math.max(0, cap - used)\`
   - \`pct\`: \`Math.round((used / cap) * 1000) / 10\` (percentage rounded to 1 decimal place)
   - \`overCap\`: boolean \`used > cap\`
   - \`oldestExpiresAt\`: if \`used === 0\`, \`null\`; otherwise \`minTs + windowMs\` where \`minTs\` is the smallest \`ev.ts\` among qualifying events
   - \`byModel\`: plain object mapping each qualifying event's normalized model short name (strip any leading \`'opencode-go/'\` prefix, lowercase) to its qualifying count, with keys sorted alphabetically.`,
  },

  bughunt: {
    id: 'P2-bughunt',
    axis: 'Reviewer / Bug & Security Hunt',
    maxPts: 35,
    prompt: `Self-contained eval: do NOT call any tools. You are a strict code reviewer. Review the git diff below.
Find real bugs and security issues only. Do NOT flag sound code.

Output ONLY a single fenced \`\`\`json block with this exact shape:
{
  "findings": [
    {
      "severity": "blocking" | "major" | "minor",
      "file": "src/importer.ts" | "src/query.ts" | "src/currency.ts",
      "line": <approximate new-file line number>,
      "issue": "<one concise sentence explaining the defect>",
      "fix": "<one concise sentence explaining the fix>"
    }
  ],
  "verdict": "SHIP" | "FIX"
}

\`\`\`diff
diff --git a/src/currency.ts b/src/currency.ts
index 1111111..2222222 100644
--- a/src/currency.ts
+++ b/src/currency.ts
@@ -1,4 +1,11 @@
+export function parseUsdToCents(raw: string): number {
+  const trimmed = raw.trim();
+  if (!/^-?\\d+(\\.\\d{1,2})?$/.test(trimmed)) {
+    throw new Error('Invalid USD amount format');
+  }
+  const cents = Math.round(Number(trimmed) * 100);
+  if (!Number.isSafeInteger(cents)) throw new Error('Amount overflow');
+  return cents;
+}
diff --git a/src/importer.ts b/src/importer.ts
index 3333333..4444444 100644
--- a/src/importer.ts
+++ b/src/importer.ts
@@ -10,13 +10,25 @@
+// Contract: atomic all-or-nothing batch import. Never commit partial/truncated LLM batches.
+// timeoutMs is the timeout budget in milliseconds (e.g. 15000).
+export async function importBatch(db: Db, batch: { rows: TxRow[]; doneReason: string }, timeoutMs = 15000) {
   await db.exec('BEGIN IMMEDIATE');
   try {
-    for (const r of batch.rows) {
+    for (const r of batch.rows) {
       await db.run('INSERT INTO tx (id, cents) VALUES (?, ?)', [r.id, r.cents]);
     }
+    if (batch.doneReason === 'length') {
+      await db.run("UPDATE imports SET status = 'completed', note = 'partial' WHERE id = 1");
+      await db.exec('COMMIT');
+      return { ok: true, truncated: true };
+    }
     await db.run("UPDATE imports SET status = 'completed' WHERE id = 1");
     await db.exec('COMMIT');
     return { ok: true, truncated: false };
   } catch (err: any) {
     await db.exec('ROLLBACK');
+    if (err?.code === 'ETIMEDOUT') {
+      throw new Error(\`Import timed out after \${timeoutMs}s\`);
+    }
     throw err;
   }
 }
diff --git a/src/query.ts b/src/query.ts
index 5555555..6666666 100644
--- a/src/query.ts
+++ b/src/query.ts
@@ -4,7 +4,13 @@ export async function listTransactions(db: Db, accountId: string, includeArchive
   if (!includeArchived) {
     return db.all('SELECT * FROM tx WHERE account_id = ? AND archived = 0', [accountId]);
   }
-  return db.all('SELECT * FROM tx WHERE account_id = ?', [accountId]);
+  const sql = \`SELECT * FROM tx WHERE account_id = '\${accountId}' ORDER BY id DESC\`;
+  return db.all(sql);
 }
\`\`\``,
  },

  reasoning: {
    id: 'P3-reasoning',
    axis: 'Intelligence / Constraint & Invariant Logic',
    maxPts: 15,
    prompt: `Self-contained eval: do NOT call any tools. Keep your internal reasoning concise (analyze the critical path A->C->E and B->E directly; do NOT brute-force all permutations). Solve this 3-part systems scheduling & invariant problem and return ONLY a single fenced \`\`\`json block:
{
  "minTotalSeconds": <integer>,
  "commitOrder": ["<job>", "<job>", "<job>", "<job>", "<job>"],
  "minWriteBufferKiB": <integer>
}

Problem:
Five migration jobs (A, B, C, D, E) must run on a node with 2 worker threads and 1 exclusive SQLite write lock.
- Each job has a CPU phase (can run in parallel with anything, uses 1 worker thread) followed immediately by a Commit phase (requires BOTH 1 worker thread AND the exclusive SQLite write lock).
- A job holds its worker thread continuously from the start of its CPU phase until the end of its Commit phase.
- Dependencies (a dependent job cannot start its CPU phase until its prerequisite finishes its Commit phase):
  - C depends on A
  - D depends on A
  - E depends on B and C
- Phase durations (seconds) and uncommitted write-buffer sizes held during the CPU+Commit lifetime of each job:
  - Job A: CPU = 4s, Commit = 2s, buffer = 120 KiB
  - Job B: CPU = 5s, Commit = 3s, buffer = 200 KiB
  - Job C: CPU = 3s, Commit = 2s, buffer = 150 KiB
  - Job D: CPU = 6s, Commit = 1s, buffer = 180 KiB
  - Job E: CPU = 2s, Commit = 2s, buffer = 90 KiB
- Tie-break rule for commit order: choose the schedule that achieves the strictly minimum total completion time (\`minTotalSeconds\`) from t=0 until all 5 commits finish.
- Report:
  1. \`minTotalSeconds\`: the minimum total seconds to finish all 5 jobs.
  2. \`commitOrder\`: the exact order in which the 5 jobs finish their Commit phase in that optimal schedule.
  3. \`minWriteBufferKiB\`: the peak simultaneous KiB of write-buffer held across active jobs (jobs between their CPU start and Commit end) at any instant in that optimal schedule.`,
  },

  agentic: {
    id: 'P4-agentic',
    axis: 'Agentic / Tool-Call & Grounding Discipline',
    maxPts: 15,
    prompt: `Inspect ONLY the fixture directory \`skills/model-benchmarks/snapshots/evals/.p4-fixture/src/\` (using \`read\` or \`grep\` on that path) to find the exact bug causing \`canAdmitRequest(1000, 1500, 500, 3, [1000, 1200])\` to wrongly reject a request when the oldest timestamp sits exactly on the trailing window expiry boundary (\`nowMs - windowMs\`).
Do NOT search outside \`skills/model-benchmarks/snapshots/evals/.p4-fixture/src/\`, do NOT edit any files, and do NOT run shell commands.
After reading \`skills/model-benchmarks/snapshots/evals/.p4-fixture/src/reconcile.mjs\`, reply with ONLY a single fenced \`\`\`json block:
{
  "file": "src/reconcile.mjs",
  "line": <exact 1-based line number of the defective if-statement in reconcile.mjs>,
  "defect": "<exact operator or expression that is wrong>",
  "fix": "<exact replacement expression>"
}`,
  },
};

export function createAgenticFixture(baseDir = path.join(EVALS_ROOT, '.p4-fixture')) {
  const dir = baseDir;
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'index.mjs'),
    [
      '// Entry router for request admission.',
      '// NOTE: Historical comment claimed line 18 of policy.mjs had the boundary check,',
      '// but the active admission predicate moved to src/reconcile.mjs.',
      'import { canAdmitRequest } from "./reconcile.mjs";',
      '',
      'export function handleAdmission(ctx) {',
      '  return canAdmitRequest(ctx.oldest, ctx.now, ctx.windowMs, ctx.cap, ctx.history);',
      '}',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(dir, 'src', 'policy.mjs'),
    [
      '// Static tier constants.',
      'export const DEFAULT_WINDOW_MS = 500;',
      'export const DEFAULT_CAP = 3;',
      '// Line 4 is just a constant; nothing is evaluated here.',
      '',
    ].join('\n'),
  );
  // Put the actual bug on line 24 of src/reconcile.mjs
  fs.writeFileSync(
    path.join(dir, 'src', 'reconcile.mjs'),
    [
      '// Trailing-window admission reconciliation.',
      '// Policy: timestamps at (nowMs - windowMs) have ALREADY expired at nowMs',
      '// and must NOT count against the active window (strictly greater: ts > nowMs - windowMs).',
      '',
      'export function normalizeHistory(history) {',
      '  if (!Array.isArray(history)) return [];',
      '  return history.filter((x) => typeof x === "number" && Number.isFinite(x));',
      '}',
      '',
      'export function formatWindowDebug(nowMs, windowMs) {',
      '  const cutoff = nowMs - windowMs;',
      '  return `window=(${cutoff}, ${nowMs}]`;',
      '}',
      '',
      'export function canAdmitRequest(_oldestHint, nowMs, windowMs, cap, history) {',
      '  const clean = normalizeHistory(history);',
      '  const cutoff = nowMs - windowMs;',
      '  let active = 0;',
      '  for (const ts of clean) {',
      '    if (ts > nowMs) continue;',
      '    // BUG ON LINE 22 BELOW: uses >= cutoff instead of > cutoff, so a request',
      '    // that expired right at cutoff (e.g. ts=1000 when nowMs=1500, windowMs=500) is counted.',
      '    if (ts >= cutoff) active += 1;',
      '  }',
      '  return active < cap;',
      '}',
      '',
    ].join('\n'),
  );
  return dir;
}

// ---------------------------------------------------------------------------
// Auto-graders for P1..P4
// ---------------------------------------------------------------------------

function extractFenced(text, langHint = '') {
  const s = String(text || '');
  const re = langHint
    ? new RegExp('```(?:' + langHint + ')\\s*\\n([\\s\\S]*?)```', 'i')
    : /```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)```/;
  const m = s.match(re) || s.match(/```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)```/);
  return m ? m[1].trim() : s.trim();
}

function parseJsonLoose(text) {
  const raw = extractFenced(text, 'json');
  try {
    return JSON.parse(raw);
  } catch {
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(raw.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function gradeP1Coding(responseText) {
  const details = [];
  if (!responseText || !String(responseText).trim()) {
    return { score: 0, maxPts: 35, passed: 0, total: 10, details: ['empty response'] };
  }
  let code = extractFenced(responseText, 'js|javascript|mjs|ts');
  // Strip ESM export keywords so it evaluates cleanly in vm.Script
  code = code
    .replace(/\bexport\s+default\s+function\b/g, 'function')
    .replace(/\bexport\s+function\b/g, 'function')
    .replace(/\bexport\s+const\b/g, 'const')
    .replace(/\bexport\s+\{[^}]*\};?/g, '');

  const sandbox = { summarizeWindow: null, Math, Number, Object, Array, Set, Map, String, Boolean, isFinite };
  const ctx = vm.createContext(sandbox);
  try {
    const script = new vm.Script(
      `${code}\nif (typeof summarizeWindow === 'function') globalThis.summarizeWindow = summarizeWindow;`,
    );
    script.runInContext(ctx, { timeout: 1000 });
  } catch (e) {
    return { score: 0, maxPts: 35, passed: 0, total: 10, details: [`compile error: ${e.message}`] };
  }
  const fn = sandbox.summarizeWindow;
  if (typeof fn !== 'function') {
    return { score: 0, maxPts: 35, passed: 0, total: 10, details: ['summarizeWindow not defined as function'] };
  }

  const runCase = (name, args, checkFn) => {
    try {
      const callSandbox = { fn, args, out: null };
      vm.runInNewContext('out = fn(...args)', callSandbox, { timeout: 500 });
      const ok = checkFn(callSandbox.out);
      details.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
      return ok ? 1 : 0;
    } catch (e) {
      details.push(`ERR  ${name}: ${e.message}`);
      return 0;
    }
  };

  let passed = 0;
  const baseEvents = [
    { id: 'e1', ts: 1000, provider: 'opencode-go', model: 'opencode-go/glm-5.3-flash' },
    { id: 'e2', ts: 1200, provider: 'opencode-go', model: 'Kimi-K3.1-Pro' },
    { id: 'e3', ts: 1500, provider: 'opencode-go', model: 'opencode-go/glm-5.3-flash' },
  ];
  // 1. Inclusive window boundaries [now-win, now]
  passed += runCase('inclusive-bounds', [baseEvents, 1500, 500, 10], (r) => r && r.used === 3 && r.remaining === 7);
  // 2. Out-of-window exclusion (ts < now-win or ts > now)
  passed += runCase(
    'window-exclusion',
    [
      [
        ...baseEvents,
        { id: 'e0', ts: 999, provider: 'opencode-go', model: 'glm-5.3-flash' },
        { id: 'e4', ts: 1501, provider: 'opencode-go', model: 'glm-5.3-flash' },
      ],
      1500,
      500,
      10,
    ],
    (r) => r && r.used === 3 && r.oldestExpiresAt === 1500,
  );
  // 3. Free-pool (-free) and non-Go provider exclusion
  passed += runCase(
    'free-and-provider-filter',
    [
      [
        ...baseEvents,
        { id: 'f1', ts: 1100, provider: 'opencode-go', model: 'opencode-go/iceman-contributor-free' },
        { id: 'f2', ts: 1150, provider: 'opencode-go', model: 'HY4-FLASH-FREE' },
        { id: 'n1', ts: 1180, provider: 'nvidia', model: 'glm-5.3-flash' },
      ],
      1500,
      500,
      10,
    ],
    (r) => r && r.used === 3 && !('iceman-contributor-free' in (r.byModel || {})),
  );
  // 4. Error rows excluded
  passed += runCase(
    'error-exclusion',
    [
      [
        ...baseEvents,
        { id: 'err1', ts: 1250, provider: 'opencode-go', model: 'glm-5.3-flash', error: '429 rate limit' },
        { id: 'err2', ts: 1260, provider: 'opencode-go', model: 'glm-5.3-flash', error: true },
      ],
      1500,
      500,
      10,
    ],
    (r) => r && r.used === 3,
  );
  // 5. Deduplication by non-empty string id (first occurrence wins, even if first was invalid/out-of-window)
  passed += runCase(
    'dedup-first-wins',
    [
      [
        { id: 'dup1', ts: 500, provider: 'opencode-go', model: 'glm-5.3-flash' }, // out of window first occurrence
        { id: 'dup1', ts: 1300, provider: 'opencode-go', model: 'glm-5.3-flash' }, // must be ignored!
        { id: 'dup2', ts: 1350, provider: 'opencode-go', model: 'glm-5.3-flash' },
        { id: 'dup2', ts: 1400, provider: 'opencode-go', model: 'glm-5.3-flash' },
        { id: '', ts: 1410, provider: 'opencode-go', model: 'glm-5.3-flash' }, // empty id NOT deduped
        { id: '', ts: 1420, provider: 'opencode-go', model: 'glm-5.3-flash' },
      ],
      1500,
      500,
      10,
    ],
    (r) => r && r.used === 3,
  );
  // 6. pct rounding to 1 decimal place + overCap + remaining clamped at 0
  passed += runCase(
    'overcap-and-pct',
    [baseEvents, 1500, 500, 2],
    (r) => r && r.used === 3 && r.remaining === 0 && r.overCap === true && r.pct === 150,
  );
  // 7. fractional pct rounding (1 / 3 -> 33.3, 2 / 3 -> 66.7)
  passed += runCase(
    'fractional-pct',
    [[baseEvents[0], baseEvents[1]], 1500, 500, 3],
    (r) => r && r.pct === 66.7 && r.overCap === false,
  );
  // 8. Empty window -> oldestExpiresAt: null, used: 0, byModel: {}
  passed += runCase(
    'empty-window',
    [[{ id: 'x', ts: 100, provider: 'opencode-go', model: 'glm-5.3-flash' }], 1500, 500, 10],
    (r) =>
      r &&
      r.used === 0 &&
      r.remaining === 10 &&
      r.oldestExpiresAt === null &&
      r.overCap === false &&
      Object.keys(r.byModel || {}).length === 0,
  );
  // 9. oldestExpiresAt = minQualifyingTs + windowMs on out-of-order array
  passed += runCase(
    'oldest-expiry-unordered',
    [
      [
        { id: 'a', ts: 1400, provider: 'opencode-go', model: 'glm-5.3-flash' },
        { id: 'b', ts: 1050, provider: 'opencode-go', model: 'glm-5.3-flash' },
        { id: 'c', ts: 1200, provider: 'opencode-go', model: 'glm-5.3-flash' },
      ],
      1500,
      500,
      10,
    ],
    (r) => r && r.oldestExpiresAt === 1550,
  );
  // 10. byModel normalization (strip opencode-go/, lowercase, alphabetical key order)
  passed += runCase(
    'bymodel-sorted-normalized',
    [baseEvents, 1500, 500, 10],
    (r) =>
      r &&
      r.byModel &&
      JSON.stringify(Object.keys(r.byModel)) === JSON.stringify(['glm-5.3-flash', 'kimi-k3.1-pro']) &&
      r.byModel['glm-5.3-flash'] === 2 &&
      r.byModel['kimi-k3.1-pro'] === 1,
  );

  return {
    score: +(passed * 3.5).toFixed(1),
    maxPts: 35,
    passed,
    total: 10,
    details,
  };
}

export function gradeP2Bughunt(responseText) {
  const details = [];
  if (!responseText || !String(responseText).trim()) {
    return { score: 0, maxPts: 35, details: ['empty response'] };
  }
  const parsed = parseJsonLoose(responseText);
  const findings = Array.isArray(parsed?.findings) ? parsed.findings : [];
  const verdict = String(parsed?.verdict || '').toUpperCase();

  let pts = 0;
  // Format compliance (6 pts): valid JSON with findings array + verdict === 'FIX'
  if (parsed && Array.isArray(parsed.findings) && verdict === 'FIX') {
    const allShaped =
      findings.length > 0 &&
      findings.every(
        (f) =>
          /^(blocking|major|minor)$/i.test(String(f.severity || '')) &&
          typeof f.file === 'string' &&
          typeof f.issue === 'string' &&
          typeof f.fix === 'string',
      );
    if (allShaped) {
      pts += 6;
      details.push('PASS format-compliance (+6)');
    } else {
      pts += 3;
      details.push('PARTIAL format-compliance (+3)');
    }
  } else {
    details.push('FAIL format-compliance (0)');
  }

  const textOf = (f) => `${f.file || ''} ${f.severity || ''} ${f.issue || ''} ${f.fix || ''}`.toLowerCase();

  // Bug 1 (Blocking, 14 pts): importer.ts doneReason === 'length' commits truncated/partial batch
  const caughtBlocking = findings.find(
    (f) =>
      /importer/.test(String(f.file || '').toLowerCase()) &&
      /(length|truncat|partial|commit|rollback)/.test(textOf(f)) &&
      /^(blocking|major)$/i.test(String(f.severity || '')),
  );
  if (caughtBlocking) {
    const full = /^blocking$/i.test(String(caughtBlocking.severity || ''));
    pts += full ? 14 : 10;
    details.push(`PASS caught-truncation-commit (+${full ? 14 : 10})`);
  } else {
    details.push('MISS truncation-commit (0)');
  }

  // Bug 2 (Major, 10 pts): query.ts SQL injection via template literal '${accountId}'
  const caughtSqLi = findings.find(
    (f) =>
      /query/.test(String(f.file || '').toLowerCase()) &&
      /(sql|inject|interpolat|parameter|placeholder|accountid)/.test(textOf(f)),
  );
  if (caughtSqLi) {
    pts += 10;
    details.push('PASS caught-sql-injection (+10)');
  } else {
    details.push('MISS sql-injection (0)');
  }

  // Bug 3 (Minor, 5 pts): importer.ts timeoutMs logged with 's' suffix (ms vs seconds mismatch)
  const caughtTimeoutUnit = findings.find(
    (f) =>
      /importer/.test(String(f.file || '').toLowerCase()) &&
      /(timeoutms|millisecond|\bms\b|second|unit|1000)/.test(textOf(f)),
  );
  if (caughtTimeoutUnit) {
    pts += 5;
    details.push('PASS caught-timeout-unit-mismatch (+5)');
  } else {
    details.push('MISS timeout-unit-mismatch (0)');
  }

  // Clean decoy penalty (−10 pts per false alarm on src/currency.ts)
  const falseAlarms = findings.filter((f) => /currency/.test(String(f.file || '').toLowerCase()));
  if (falseAlarms.length > 0) {
    const penalty = falseAlarms.length * 10;
    pts = Math.max(0, pts - penalty);
    details.push(`FP   flagged-clean-currency-decoy x${falseAlarms.length} (-${penalty})`);
  } else {
    details.push('PASS zero-false-positives-on-decoy');
  }

  return {
    score: Math.max(0, Math.min(35, pts)),
    maxPts: 35,
    findingsCount: findings.length,
    falsePositives: falseAlarms.length,
    details,
  };
}

export function gradeP3Reasoning(responseText) {
  // Let's verify the exact math of the P3 scheduling puzzle:
  // Jobs:
  //   A: CPU 4, Commit 2 (total 6, buf 120). Prereq for C, D.
  //   B: CPU 5, Commit 3 (total 8, buf 200). Prereq for E.
  //   C: CPU 3, Commit 2 (total 5, buf 150). Depends on A; prereq for E.
  //   D: CPU 6, Commit 1 (total 7, buf 180). Depends on A.
  //   E: CPU 2, Commit 2 (total 4, buf 90).  Depends on B, C.
  // At t=0, only A and B are ready (2 workers):
  //   Worker 1 runs A: CPU [0,4], Commit [4,6] (holds lock [4,6]). A finishes at t=6.
  //   Worker 2 runs B: CPU [0,5]. At t=5, B needs the write lock, which A holds until t=6!
  //     So B waits holding Worker 2 from [5,6], then B Commits [6,9] (holds lock [6,9]). B finishes at t=9.
  // At t=6, A finishes and frees Worker 1. C and D are now unlocked!
  //   Which should Worker 1 run at t=6?
  //   Case 1 (optimal): Worker 1 runs C at t=6 (since E depends on C and B):
  //     C CPU [6,9]. At t=9, B finishes Commit (freeing lock + Worker 2), and C is ready to Commit!
  //     C Commits [9,11] on Worker 1 (lock [9,11]). C finishes at t=11!
  //     Meanwhile at t=9, Worker 2 starts D: D CPU [9,15], D Commit [15,16] (lock [15,16]). D finishes at t=16.
  //     At t=11, C finishes and frees Worker 1; both B (t=9) and C (t=11) are done, so E is unlocked!
  //     Worker 1 runs E: E CPU [11,13], E Commit [13,15] (lock [13,15], finishes right as D needs lock at t=15!).
  //     All 5 jobs finish at t=16!
  //     Commit completion order in Case 1:
  //       A (t=6) -> B (t=9) -> C (t=11) -> E (t=15) -> D (t=16).
  //     What if Worker 1 ran D at t=6 instead of C?
  //       D runs [6,13] (CPU [6,12], Commit [12,13]), C starts on Worker 2 at t=9: CPU [9,12], waits lock [12,13], Commit [13,15], then E runs [15,19] -> finishes at t=19 (slower!).
  //   Let's check peak simultaneous write-buffer KiB in the optimal t=16 schedule:
  //     [0,6]: A (120) + B (200) = 320 KiB
  //     (6,9]: B (200) + C (150) = 350 KiB
  //     (9,11]: C (150) + D (180) = 330 KiB
  //     (11,15]: E (90) + D (180) = 270 KiB
  //     (15,16]: D (180) = 180 KiB
  //     Note: only 2 worker threads exist and every active job holds 1 worker thread continuously,
  //     so at most 2 jobs are active at any non-boundary instant: max pair is B + C = 200 + 150 = 350 KiB.
  const details = [];
  const parsed = parseJsonLoose(responseText);
  if (!parsed) {
    return { score: 0, maxPts: 15, details: ['invalid or missing JSON'] };
  }
  let pts = 0;
  if (parsed.minTotalSeconds === 16) {
    pts += 5;
    details.push('PASS minTotalSeconds=16 (+5)');
  } else {
    details.push(`FAIL minTotalSeconds (got ${JSON.stringify(parsed.minTotalSeconds)}, want 16)`);
  }

  const order = Array.isArray(parsed.commitOrder) ? parsed.commitOrder.map((x) => String(x).trim().toUpperCase()) : [];
  if (JSON.stringify(order) === JSON.stringify(['A', 'B', 'C', 'E', 'D'])) {
    pts += 5;
    details.push('PASS commitOrder=A,B,C,E,D (+5)');
  } else if (order.slice(0, 3).join(',') === 'A,B,C') {
    pts += 2;
    details.push(`PARTIAL commitOrder prefix A,B,C (got ${order.join(',')}) (+2)`);
  } else {
    details.push(`FAIL commitOrder (got ${order.join(',')}, want A,B,C,E,D)`);
  }

  if (parsed.minWriteBufferKiB === 350) {
    pts += 5;
    details.push('PASS minWriteBufferKiB=350 (+5)');
  } else {
    details.push(`FAIL minWriteBufferKiB (got ${JSON.stringify(parsed.minWriteBufferKiB)}, want 350)`);
  }

  return { score: pts, maxPts: 15, details };
}

export function gradeP4Agentic(responseText, events = []) {
  const details = [];
  if (!responseText || !String(responseText).trim()) {
    return { score: 0, maxPts: 15, toolCalls: [], details: ['empty response / DNF'] };
  }
  const toolEvents = events.filter(
    (e) =>
      e.type === 'tool_use' ||
      e.type === 'tool' ||
      e.part?.type === 'tool' ||
      e.part?.type === 'tool-invocation' ||
      typeof e.part?.tool === 'string',
  );
  const toolNames = toolEvents.map((e) => String(e.part?.tool || e.tool || e.name || '').toLowerCase());
  const usedReadSearch = toolNames.some((t) => /^(read|grep|glob|list)$/.test(t));
  const usedForbidden = toolNames.some((t) => /^(edit|write|shell|bash|subagent|patch|execute)\b|<\/?arg_/i.test(t));

  let pts = 0;
  if (usedReadSearch && !usedForbidden) {
    pts += 5;
    details.push(`PASS used-read-search-tools (${toolNames.join(', ')}) (+5)`);
  } else if (usedForbidden) {
    details.push(`FAIL called-forbidden-or-malformed-tool (${toolNames.slice(0, 8).join(', ')}) (0)`);
  } else {
    details.push('FAIL no-read-or-grep-tool-recorded (0)');
  }

  const parsed = parseJsonLoose(responseText);
  if (parsed) {
    const fileOk = /src\/reconcile\.mjs$/i.test(String(parsed.file || '').trim());
    const lineNum = Number(parsed.line);
    // In createAgenticFixture, `if (ts >= cutoff) active += 1;` is line 23
    const lineOk = Number.isFinite(lineNum) && Math.abs(lineNum - 23) <= 2;
    const defectOk = />=/.test(String(parsed.defect || '')) && />/.test(String(parsed.fix || '')) && !/>=/.test(String(parsed.fix || ''));
    if (fileOk && lineOk && defectOk) {
      pts += 6;
      details.push(`PASS exact-root-cause (src/reconcile.mjs:${lineNum}, >= -> >) (+6)`);
    } else if (fileOk && defectOk) {
      pts += 4;
      details.push(`PARTIAL file+defect ok, line=${parsed.line} (want 23) (+4)`);
    } else {
      details.push(`FAIL root-cause mismatch (${JSON.stringify(parsed)}) (0)`);
    }
  } else {
    details.push('FAIL invalid JSON output (0)');
  }

  if (parsed && !usedForbidden && toolEvents.length >= 1 && toolEvents.length <= 6) {
    pts += 4;
    details.push(`PASS tool-discipline (${toolEvents.length} steps, clean JSON) (+4)`);
  } else if (parsed && !usedForbidden && toolEvents.length <= 12) {
    pts += 2;
    details.push(`PARTIAL tool-discipline (${toolEvents.length} steps) (+2)`);
  } else if (toolEvents.length > 12) {
    details.push(`FAIL tool-thrashing (${toolEvents.length} steps > 12) (0)`);
  }

  return { score: pts, maxPts: 15, toolCalls: toolNames, details };
}

export function classifyTier(composite, deliveredCount, attemptedCount) {
  if (deliveredCount === 0) return 'DNF / Dead';
  if (composite >= 78) return 'Apex';
  if (composite >= 58) return 'Workhorse';
  if (composite >= 38) return 'Flash / Lite';
  return 'Sub-par';
}

// ---------------------------------------------------------------------------
// Isolated OpenCode Runner (fixes 2026-10-18 tool-wander + title-quota leaks)
// ---------------------------------------------------------------------------

export function buildIsolatedConfig(model, mode = 'standalone', allowedDir = null) {
  const denyAllTools = [
    { action: 'read', resource: '*', effect: 'deny' },
    { action: 'edit', resource: '*', effect: 'deny' },
    { action: 'write', resource: '*', effect: 'deny' },
    { action: 'shell', resource: '*', effect: 'deny' },
    { action: 'glob', resource: '*', effect: 'deny' },
    { action: 'grep', resource: '*', effect: 'deny' },
    { action: 'subagent', resource: '*', effect: 'deny' },
    { action: 'webfetch', resource: '*', effect: 'deny' },
    { action: 'websearch', resource: '*', effect: 'deny' },
    { action: 'external_directory', resource: '*', effect: 'deny' },
  ];
  const agenticReadTools = [
    { action: 'edit', resource: '*', effect: 'deny' },
    { action: 'write', resource: '*', effect: 'deny' },
    { action: 'shell', resource: '*', effect: 'deny' },
    { action: 'subagent', resource: '*', effect: 'deny' },
    { action: 'webfetch', resource: '*', effect: 'deny' },
    { action: 'websearch', resource: '*', effect: 'deny' },
    { action: 'read', resource: '*', effect: 'allow' },
    { action: 'glob', resource: '*', effect: 'allow' },
    { action: 'grep', resource: '*', effect: 'allow' },
    ...(allowedDir
      ? [
          { action: 'external_directory', resource: allowedDir, effect: 'allow' },
          { action: 'external_directory', resource: `${allowedDir}/**`, effect: 'allow' },
        ]
      : []),
  ];
  return JSON.stringify({
    model,
    compaction: { auto: false },
    agents: {
      title: { model },
    },
    permissions: mode === 'agentic-read' ? agenticReadTools : denyAllTools,
  });
}

export function scrubModelIdentity(text, models = []) {
  let out = String(text || '');
  for (const m of models) {
    if (!m) continue;
    const short = String(m).split('/').pop();
    const stem = short.replace(/-(contributor-free|free|preview|pro|flash|max)$/i, '');
    for (const tok of [m, short, stem]) {
      if (tok && tok.length >= 4) {
        const escRe = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(escRe, 'gi'), '[REDACTED_MODEL]');
      }
    }
  }
  return out;
}

export function runOpencodePrompt({
  bin = DEFAULT_BIN,
  model,
  prompt,
  title = 'mini-eval',
  mode = 'standalone',
  cwd = process.cwd(),
  timeoutMs = 180000,
}) {
  const cfg = buildIsolatedConfig(model, mode, mode === 'agentic-read' ? cwd : null);
  const t0 = Date.now();
  const r = spawnSync(
    bin,
    ['run', '--archived', '--title', title, '-m', model, '--format', 'json', prompt],
    {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        NO_COLOR: '1',
        OPENCODE_MODEL_FALLBACK: 'off',
        OPENCODE_CONFIG_CONTENT: cfg,
      },
    },
  );
  const wall_ms = Date.now() - t0;
  const textParts = [];
  const events = [];
  let tokens = null;
  let error = null;

  if (r.stdout) {
    for (const line of r.stdout.split('\n')) {
      if (!line.trim()) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      events.push(e);
      if (e.type === 'text' && e.part?.text) textParts.push(e.part.text);
      if (e.type === 'step_finish' && e.part?.tokens) {
        // Accumulate or take latest step tokens
        if (!tokens) {
          tokens = structuredClone(e.part.tokens);
        } else {
          tokens.total = (tokens.total || 0) + (e.part.tokens.total || 0);
          tokens.input = (tokens.input || 0) + (e.part.tokens.input || 0);
          tokens.output = (tokens.output || 0) + (e.part.tokens.output || 0);
          tokens.reasoning = (tokens.reasoning || 0) + (e.part.tokens.reasoning || 0);
          if (e.part.tokens.cache) {
            tokens.cache = tokens.cache || { write: 0, read: 0 };
            tokens.cache.write = (tokens.cache.write || 0) + (e.part.tokens.cache.write || 0);
            tokens.cache.read = (tokens.cache.read || 0) + (e.part.tokens.cache.read || 0);
          }
        }
      }
      if (e.type === 'error' || e.type === 'session.error') {
        error = JSON.stringify(e).slice(0, 400);
      }
    }
  }
  const response = textParts.join('\n').trim();
  const killed = r.signal === 'SIGTERM' || r.error?.code === 'ETIMEDOUT';
  if ((r.status !== 0 || killed) && !response) {
    error = (error || '') + (killed ? ' TIMEOUT' : '') + ' stderr: ' + String(r.stderr || '').slice(0, 300);
  }
  return {
    wall_ms,
    exit: r.status,
    killed,
    response,
    tokens,
    events,
    error: error ? error.trim() : null,
  };
}

// ---------------------------------------------------------------------------
// Stage 1 Runner: `probe`
// ---------------------------------------------------------------------------

export function runProbeSuite({
  models,
  date = new Date().toISOString().slice(0, 10),
  outDir = path.join(EVALS_ROOT, date),
  bin = DEFAULT_BIN,
  timeoutMs = 180000,
}) {
  fs.mkdirSync(path.join(outDir, 'probes'), { recursive: true });
  const fixtureDir = createAgenticFixture(path.join(EVALS_ROOT, '.p4-fixture'));
  const summaryPath = path.join(outDir, 'probe-summary.json');
  const existing = fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, 'utf8')) : { models: {} };
  const resultsByModel = { ...(existing.models || {}) };

  try {
    for (const model of models) {
      const slug = model.replace(/[^a-zA-Z0-9._-]+/g, '__');
      const taskResults = {};
      const walls = [];
      let totalOutToks = 0;
      let totalReasToks = 0;
      let totalWallMs = 0;
      let delivered = 0;
      let attempted = 0;
      let consecDnf = 0;

      for (const [taskKey, task] of Object.entries(PROBE_TASKS)) {
        const outFile = path.join(outDir, 'probes', `${slug}__${task.id}.json`);
        let runRec;
        if (fs.existsSync(outFile)) {
          runRec = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        } else {
          if (consecDnf >= 2) {
            runRec = {
              model,
              task: task.id,
              skipped: 'ROUTE_PAUSED_2_DNF',
              wall_ms: 0,
              response: '',
              tokens: null,
              error: 'Paused after 2 consecutive provider DNFs',
              events: [],
            };
          } else {
            const isAgentic = taskKey === 'agentic';
            const res = runOpencodePrompt({
              bin,
              model,
              prompt: task.prompt,
              title: `probe-${task.id}`,
              mode: isAgentic ? 'agentic-read' : 'standalone',
              cwd: isAgentic ? fixtureDir : outDir,
              timeoutMs,
            });
            runRec = {
              model,
              task: task.id,
              wall_ms: res.wall_ms,
              exit: res.exit,
              killed: res.killed,
              response: res.response,
              tokens: res.tokens,
              error: res.error,
              events: res.events,
            };
            fs.writeFileSync(outFile, JSON.stringify(runRec, null, 2));
          }
        }

        attempted++;
        const ok = Boolean(runRec.response && !runRec.error);
        if (ok) {
          delivered++;
          consecDnf = 0;
          walls.push(runRec.wall_ms);
          totalWallMs += runRec.wall_ms;
          totalOutToks += (runRec.tokens?.output || 0) + (runRec.tokens?.reasoning || 0);
          totalReasToks += runRec.tokens?.reasoning || 0;
        } else if (!runRec.skipped) {
          consecDnf++;
        }

        const grade =
          taskKey === 'coding'
            ? gradeP1Coding(runRec.response)
            : taskKey === 'bughunt'
              ? gradeP2Bughunt(runRec.response)
              : taskKey === 'reasoning'
                ? gradeP3Reasoning(runRec.response)
                : gradeP4Agentic(runRec.response, runRec.events || []);

        taskResults[taskKey] = {
          id: task.id,
          score: grade.score,
          maxPts: task.maxPts,
          delivered: ok,
          wall_s: +(runRec.wall_ms / 1000).toFixed(1),
          error: runRec.error || null,
          details: grade.details,
        };
        console.error(
          `[probe] ${model} ${task.id}: ${grade.score}/${task.maxPts} (${ok ? 'ok' : 'DNF'}, ${(runRec.wall_ms / 1000).toFixed(1)}s)`,
        );
      }

      const composite = +(
        (taskResults.coding?.score || 0) +
        (taskResults.bughunt?.score || 0) +
        (taskResults.reasoning?.score || 0) +
        (taskResults.agentic?.score || 0)
      ).toFixed(1);
      const sortedWalls = [...walls].sort((a, b) => a - b);
      const p50_s = sortedWalls.length
        ? +(sortedWalls[Math.floor(sortedWalls.length / 2)] / 1000).toFixed(1)
        : null;
      const tok_per_s =
        totalWallMs > 0 && totalOutToks > 0 ? +((totalOutToks / totalWallMs) * 1000).toFixed(1) : null;
      const reasoning_share =
        totalOutToks > 0 ? +((totalReasToks / totalOutToks) * 100).toFixed(0) : 0;

      resultsByModel[model] = {
        model,
        evaluated_at: date,
        composite,
        tier: classifyTier(composite, delivered, attempted),
        delivered,
        attempted,
        p50_s,
        tok_per_s,
        reasoning_share_pct: reasoning_share,
        tasks: taskResults,
      };
    }
  } finally {
    try {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  const summary = {
    schema: 1,
    stage: 'probe',
    date,
    generated_at: new Date().toISOString(),
    models: resultsByModel,
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(outDir, 'probe-scorecard.md'), renderProbeMarkdown(summary));
  return summary;
}

export function renderProbeMarkdown(summary) {
  const rows = Object.values(summary.models || {}).sort((a, b) => b.composite - a.composite);
  const lines = [
    `# Stage 1 Mini-Eval Probe Scorecard — ${summary.date}`,
    '',
    'Protocol: 4 deterministic auto-graded micro-tasks (`P1 coding` 35 + `P2 bughunt` 35 + `P3 reasoning` 15 + `P4 agentic` 15 = 100 pts), isolated tool-deny config for P1–P3, sandboxed fixture read/grep for P4, `OPENCODE_MODEL_FALLBACK=off`.',
    '',
    '| Model | Composite | Tier | P1 Coding (35) | P2 BugHunt (35) | P3 Logic (15) | P4 Agentic (15) | Delivery | p50 s | tok/s | Reas % |',
    '|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const r of rows) {
    lines.push(
      `| \`${r.model}\` | **${r.composite}** | ${r.tier} | ${r.tasks.coding?.score ?? 0} | ${r.tasks.bughunt?.score ?? 0} | ${r.tasks.reasoning?.score ?? 0} | ${r.tasks.agentic?.score ?? 0} | ${r.delivered}/${r.attempted} | ${r.p50_s ?? '—'}s | ${r.tok_per_s ?? '—'} | ${r.reasoning_share_pct ?? 0}% |`,
    );
  }
  lines.push('', '## Per-Model Breakdown', '');
  for (const r of rows) {
    lines.push(`### \`${r.model}\` — ${r.composite}/100 (${r.tier})`);
    for (const t of Object.values(r.tasks || {})) {
      lines.push(`- **${t.id}** (${t.score}/${t.maxPts}, ${t.wall_s}s): ${(t.details || []).join('; ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Stage 2 — Hardened §16 Blind Diff-Corpus Eval + Sequential Stopping
// ---------------------------------------------------------------------------

// Core-6 mandatory diffs cover 5 distinct diff types before any stop check:
export const CORE6_DIFF_IDS = ['d01', 'd02', 'd03', 'd05', 'd06', 'd09'];
export const BLIND_CODES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

export const FROZEN_REVIEW_PROMPT = `Self-contained eval: do NOT call any tools, do NOT search for a repository, and do NOT mention your model name. Review the standalone git diff below as-is.
You are a strict code reviewer for a personal-finance desktop app (Tauri 2 + React/TypeScript frontend, Rust backend).

Look for: real bugs, security issues, regressions, API misuse, race conditions, missing error handling, missing tests for new behavior. Ignore style, formatting, and naming preferences.

For each finding output:
- SEVERITY: blocking | major | minor
- WHERE: file:line (approximate is fine)
- ISSUE: one sentence
- FIX: concrete suggested change (one or two sentences)

If the diff has no real problems, say "No significant issues found." and still end with the verdict line.
Finish with exactly one line: "VERDICT: SHIP" or "VERDICT: FIX".

Here is the diff:
`;

export function createSealedKey({ models, judge, date, seedStr = date }) {
  if (!judge || !String(judge).trim()) {
    throw new Error('Stage 2 requires a pinned --judge <model-id> before generating key.json (EXPERIENCE.md §4)');
  }
  let s = [...String(seedStr)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 17);
  const nextRand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const shuffled = [...models];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const assignment = {};
  for (let i = 0; i < shuffled.length; i++) {
    const code = BLIND_CODES[i] || `c${String(i + 1).padStart(2, '0')}`;
    assignment[code] = shuffled[i];
  }
  return {
    schema: 2,
    created_at: new Date().toISOString(),
    date,
    pinned_judge: judge,
    sealed: true,
    assignment,
  };
}

// Mathematical futility check after >= 6 diffs (guide §16):
// Never stops the leader early; drops a contender only if even a max-rubric
// sweep (+9 net pts per remaining diff) cannot catch the current leader's net.
export function checkSequentialStopping(netByCode, completedDiffsByCode, totalDiffs = 10, maxPtsPerDiff = 9) {
  const entries = Object.entries(netByCode);
  if (!entries.length) return { leader: null, futile: [], continueCodes: [] };
  entries.sort((a, b) => b[1] - a[1]);
  const [leaderCode, leaderNet] = entries[0];
  const futile = [];
  const continueCodes = [];
  for (const [code, net] of entries) {
    const done = completedDiffsByCode[code] || 0;
    const rem = Math.max(0, totalDiffs - done);
    if (code === leaderCode) {
      // Never stop the leader early
      continueCodes.push(code);
    } else if (done >= 6 && net + rem * maxPtsPerDiff < leaderNet) {
      futile.push({ code, net, remaining: rem, maxPossible: net + rem * maxPtsPerDiff, leaderNet });
    } else {
      continueCodes.push(code);
    }
  }
  return { leader: leaderCode, leaderNet, futile, continueCodes };
}

export function runCorpusStage({
  models,
  judge,
  phase = 'core6',
  date = new Date().toISOString().slice(0, 10),
  outDir = path.join(EVALS_ROOT, date),
  corpusDir = CORPUS_DIR,
  bin = DEFAULT_BIN,
  timeoutMs = 240000,
}) {
  fs.mkdirSync(path.join(outDir, 'runs'), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(corpusDir, 'manifest.json'), 'utf8'));
  const keyPath = path.join(outDir, 'key.json');
  let keyObj;
  if (fs.existsSync(keyPath)) {
    keyObj = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  } else {
    keyObj = createSealedKey({ models, judge, date });
    fs.writeFileSync(keyPath, JSON.stringify(keyObj, null, 2));
    console.error(`wrote sealed ${keyPath} (judge pinned: ${judge}; do not read until scoring is locked)`);
  }

  const targetDiffs =
    phase === 'core6' ? manifest.diffs.filter((d) => CORE6_DIFF_IDS.includes(d.id)) : manifest.diffs;
  const allModels = Object.values(keyObj.assignment);
  const statusByCode = {};

  for (const [code, model] of Object.entries(keyObj.assignment)) {
    let consecDnf = 0;
    let delivered = 0;
    let attempted = 0;
    let paused = false;

    for (const d of targetDiffs) {
      const runPath = path.join(outDir, 'runs', `${code}-${d.id}.json`);
      if (fs.existsSync(runPath)) {
        const prev = JSON.parse(fs.readFileSync(runPath, 'utf8'));
        attempted++;
        if (prev.response && !prev.error) {
          delivered++;
          consecDnf = 0;
        } else {
          consecDnf++;
          if (consecDnf >= 2) paused = true;
        }
        continue;
      }
      if (paused) break;

      const patch = fs.readFileSync(path.join(corpusDir, d.file), 'utf8');
      const prompt = FROZEN_REVIEW_PROMPT + '```diff\n' + patch + '\n```';
      const res = runOpencodePrompt({
        bin,
        model,
        prompt,
        title: `eval-${code}-${d.id}`,
        mode: 'standalone',
        cwd: outDir,
        timeoutMs,
      });

      // CRITICAL: NEVER write `model` into `runs/<code-dXX>.json` (fixes 2026-10-18 leak)
      const blindRec = {
        run_id: `${code}-${d.id}`,
        diff: d.id,
        diff_type: d.type,
        contender: code,
        wall_ms: res.wall_ms,
        exit: res.exit,
        killed: res.killed,
        response: scrubModelIdentity(res.response, allModels),
        tokens: res.tokens,
        error: res.error ? scrubModelIdentity(res.error, allModels) : null,
      };
      fs.writeFileSync(runPath, JSON.stringify(blindRec, null, 2));
      attempted++;
      if (blindRec.response && !blindRec.error) {
        delivered++;
        consecDnf = 0;
      } else {
        consecDnf++;
        if (consecDnf >= 2) {
          paused = true;
          console.error(`[corpus] ${code} paused after 2 consecutive DNFs at ${d.id}`);
        }
      }
    }
    statusByCode[code] = { delivered, attempted, paused };
  }
  return { phase, targetDiffs: targetDiffs.map((d) => d.id), statusByCode };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , sub, ...rest] = process.argv;
  const takeFlag = (name, def = null) => {
    const idx = rest.indexOf(name);
    if (idx === -1) return def;
    const val = rest[idx + 1];
    rest.splice(idx, 2);
    return val;
  };
  const date = takeFlag('--date', new Date().toISOString().slice(0, 10));
  const outDir = takeFlag('--out-dir', path.join(EVALS_ROOT, date));
  const timeoutMs = Number(takeFlag('--timeout-ms', '180000'));
  const judge = takeFlag('--judge', null);
  const phase = takeFlag('--phase', 'core6');

  if (sub === 'probe') {
    const models = rest.filter((x) => !x.startsWith('--'));
    if (!models.length) {
      console.error('Usage: node scripts/mini_eval.mjs probe <model...> [--date YYYY-MM-DD] [--out-dir DIR]');
      process.exit(1);
    }
    const summary = runProbeSuite({ models, date, outDir, timeoutMs });
    console.log(JSON.stringify(summary, null, 2));
  } else if (sub === 'corpus') {
    const models = rest.filter((x) => !x.startsWith('--'));
    if (!models.length || !judge) {
      console.error('Usage: node scripts/mini_eval.mjs corpus <model...> --judge <judge-model-id> [--phase core6|all10]');
      process.exit(1);
    }
    const out = runCorpusStage({ models, judge, phase, date, outDir, timeoutMs });
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.error('Commands: probe <model...> | corpus <model...> --judge <id>');
    process.exit(1);
  }
}
