#!/usr/bin/env node
// aa_bench.test.mjs — tests for aa_bench.mjs. No network, no browser.
// Run: node ~/.config/opencode/skills/model-benchmarks/scripts/aa_bench.test.mjs
//
// Strategy: pure parsers are sliced out of aa_bench.mjs source (top-level
// declarations only — the slicer stops at the next column-0 statement, so
// keep function bodies indented) and evaluated with fixtures; CLI behavior
// (arg validation, exit codes, playwright-free inventory) is tested black-box
// by spawning the script.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'aa_bench.mjs');
const src = fs.readFileSync(SCRIPT, 'utf8');

let failures = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`ok   ${label}`);
  else { failures++; console.log(`FAIL ${label}\n  want ${e}\n  got  ${a}`); }
}
function ok(cond, label) {
  if (cond) console.log(`ok   ${label}`);
  else { failures++; console.log(`FAIL ${label}`); }
}

// --- slice top-level declarations ------------------------------------------
const TERMINATOR = /^(?:function |async function |const |let |var |if |for |result\.|emit\()/m;
function sliceDecl(startRe) {
  const m = startRe.exec(src);
  if (!m) throw new Error('decl not found: ' + startRe);
  const tail = src.slice(m.index).split('\n');
  const end = tail.slice(1).findIndex(l => TERMINATOR.test(l));
  const lines = end === -1 ? tail : tail.slice(0, end + 1);
  return lines.join('\n');
}

const WANT = [
  /^const HARNESSES =/m,
  /^function linesOf/m,
  /^function parseNameValueSection/m,
  /^function parseHighlights/m,
  /^function parseEngineering/m,
  /^function parseModelPage/m,
  /^function slugCandidates/m,
  /^function parseAgentChart/m,
  /^function parsePersonality/m,
  /^function parseArgs/m,
  /^function validateArgs/m,
  /^const norm =/m,
  /^function matchEng/m,
];

let lib = `import path from 'path';\nimport os from 'os';\nlet engByNorm = {};\nlet __failures = 0;\n`;
lib += `function eq(a, e, label) { const x = JSON.stringify(a), y = JSON.stringify(e); if (x === y) console.log('ok   ' + label); else { __failures++; console.log('FAIL ' + label + '\\n  want ' + y + '\\n  got  ' + x); } }\n`;
lib += `function ok(c, label) { if (c) console.log('ok   ' + label); else { __failures++; console.log('FAIL ' + label); } }\n`;
for (const re of WANT) lib += sliceDecl(re) + '\n';

// --- fixtures + assertions (appended to the sliced library) -----------------
lib += `
engByNorm = {
  deepseekv4pro0813max: { rank: 14, name: 'DeepSeek V4 Pro 0813 (max)', engineering: 37 },
  deepseekv4flash0731max: { rank: 16, name: 'DeepSeek V4 Flash 0731 (max)', engineering: 35 },
  deepseekv41flashmax: { rank: 12, name: 'DeepSeek V4.1 Flash (max)', engineering: 39 },
  glm53flash: { rank: 7, name: 'GLM-5.3-Flash', engineering: 44 },
};

// parseArgs
eq(parseArgs(['check', 'a', 'b']).slugs, ['a', 'b'], 'parseArgs slugs');
eq(parseArgs(['check', '--out']).errors, ['--out needs a value'], 'parseArgs trailing --out');
eq(parseArgs(['coding', '--bogus']).errors, ["unknown flag '--bogus'"], 'parseArgs unknown flag');
{
  const a = parseArgs(['check', 'x', '--out', 'f.json', '--config', 'd']);
  eq([a.out, a.config, a.configSet, a.errors], ['f.json', 'd', true, []], 'parseArgs values');
}

// validateArgs
{
  const base = { cmd: 'check', slugs: ['x'], out: null, config: 'c', configSet: false, errors: [] };
  eq(validateArgs({ ...base, slugs: [] }), ['check needs at least one slug'], 'validate check needs slug');
  eq(validateArgs({ ...base, cmd: 'coding', slugs: ['x'] }), ['coding takes no slugs'], 'validate coding rejects slugs');
  eq(validateArgs({ ...base, cmd: 'coding', slugs: [], configSet: true }), ['coding does not use --config'], 'validate coding rejects --config');
  eq(validateArgs({ ...base, cmd: 'frobnicate' }), ["unknown command 'frobnicate'"], 'validate unknown command');
  eq(validateArgs({ ...base, cmd: 'inventory' }), [], 'validate inventory clean');
}

// parseEngineering
eq(parseEngineering('nothing here'), null, 'parseEngineering anchor miss');
eq(parseEngineering('Artificial Analysis Engineering Index\\nno CTA line\\nFoo\\n1\\n2'), null, 'parseEngineering CTA miss');
{
  const t = ['Artificial Analysis Engineering Index', 'x', 'Add model from specific provider', 'Model A (max)', 'Model B (max)', '44', '39', 'Benchmarks'].join('\\n');
  eq(parseEngineering(t), [{ rank: 1, name: 'Model A (max)', engineering: 44 }, { rank: 2, name: 'Model B (max)', engineering: 39 }], 'parseEngineering rows');
}

// parseModelPage: single-line and wrapped pricing
{
  const line = 'Pricing for DeepSeek V4.1 Flash (Reasoning, Max Effort) is $0.30 per 1M input tokens and $1.20 per 1M output tokens. In total, it cost $476.89 to evaluate DeepSeek V4.1 Flash. DeepSeek V4.1 Flash (Reasoning, Max Effort) scores 40 on the Artificial Analysis Intelligence Index, placing it well above average. When evaluating the Intelligence Index, it generated 250M tokens, which is very verbose in comparison to the median of 140M.';
  const m = parseModelPage(['Cache Discount 98%', 'At 214 tokens per second', line].join('\\n'), 'deepseek-v4-1-flash');
  eq([m.input, m.output, m.eval_total_cost, m.speed_tps, m.cache_read, m.intelligence, m.eval_output_tokens_m, m.eval_median_m, m.verbosity], [0.3, 1.2, 476.89, 214, 0.01, 40, 250, 140, 'very verbose'], 'parseModelPage single-line');
  const wrapped = 'Pricing for DeepSeek V4.1 Flash (Reasoning, Max Effort) is $0.30 per 1M input tokens and\\n$1.20 per 1M output tokens. In total, it cost\\n$476.89 to evaluate.';
  const m2 = parseModelPage(wrapped, 'deepseek-v4-1-flash');
  eq([m2.input, m2.output, m2.eval_total_cost], [0.3, 1.2, 476.89], 'parseModelPage wrapped');
  eq(parseModelPage('no pricing here', 'x'), null, 'parseModelPage miss');
}

// slugCandidates
ok(slugCandidates('nvidia/deepseek-ai/deepseek-v4-pro-0813').includes('deepseek-v4-pro'), 'slugCandidates strips date pin');
ok(slugCandidates('opencode/muse-spark-1.3-contributor-free').includes('muse-spark-1-3'), 'slugCandidates strips contributor-free');
eq(slugCandidates('x/y'), ['y'], 'slugCandidates plain');

// matchEng: exact, fuzzy longest-prefix, no cross-family attach
eq(matchEng(engByNorm, 'DeepSeek V4 Pro 0813 (max)').engineering, 37, 'matchEng exact');
eq(matchEng(engByNorm, 'deepseek-v4-pro').name, 'DeepSeek V4 Pro 0813 (max)', 'matchEng fuzzy prefers 0813');
eq(matchEng(engByNorm, 'deepseek-v4-flash').name, 'DeepSeek V4 Flash 0731 (max)', 'matchEng flash not v41');
eq(matchEng(engByNorm, 'no-such-model-xyz'), null, 'matchEng miss');

// parseNameValueSection: time values must not be swallowed as names (regression)
{
  const L = ['Average agent wall time per task · Lower is better', 'Agent A (X)', 'Agent B (Y)', '11.7m', '1.0h', 'Cost per Task'];
  eq(parseNameValueSection(L, 'Average agent wall time per task · Lower is better', /^[\\d.]+[mh]$/),
    [{ name: 'Agent A (X)', value: '11.7m' }, { name: 'Agent B (Y)', value: '1.0h' }], 'parseNameValueSection time values');
}

// parseAgentChart: SWE-2 folds into Devin row; entries align with values
{
  const t = ['DeepSWE v1.1 Benchmark Score', 'Color by', '14 of 15 models',
    'Codex', 'Sol S (max)', 'Devin Fusion', 'Dev D', '(xhigh)', 'SWE-2', '(medium)',
    'Opencode', 'Glm G', '72', '67', '61'].join('\\n');
  eq(parseAgentChart(t, 'DeepSWE v1.1 Benchmark Score'), [
    { entry: 'Codex Sol S (max)', value: '72' },
    { entry: 'Devin Fusion Dev D (xhigh) SWE-2 (medium)', value: '67' },
    { entry: 'Opencode Glm G', value: '61' },
  ], 'parseAgentChart SWE-2 fold');
}

// parseAgentChart: 2026-10 layout — regex "N of M models" anchor, wrapped
// legend lines, Devin Fusion two-model entry, Mirror harness
{
  const t = ['Terminal-Bench 4.0 Benchmark Score', 'Color by', 'Model', 'Agent', '15 of 42 models',
    'Antigravity CLI', 'Gemini 4 Argon', 'Muse Code', 'Muse Wonder Full', '(max)',
    'Muse Code', 'Muse Wonder', '(max)', 'Grok Build', 'Grok 4.7', '(xhigh)',
    'Devin Fusion', 'Opus 5.5 Max', 'GPT-6 Luna High', 'Claude Code', 'Sonnet 5.5', '(max)',
    'Codex', 'GPT-6.1 Sol', '(max)', 'Kimi Code CLI', 'Kimi K3', 'Claude Code', 'Opus 5.5', '(max)',
    'Codex', 'GPT-6 Astra', '(max)', 'Claude Code', 'Fable 5.1', '(max)', '(with fallback)',
    'Opencode', 'GLM-5.3', 'Muse Code', 'Muse Spark Open', '(xhigh)', 'Claude Code', 'Haiku 5.5', '(max)',
    'Mirror', 'Beam 1.0',
    '58', '57', '56', '55', '54', '52', '51', '44', '43', '41', '38', '33', '30', '17', '15'].join('\\n');
  eq(parseAgentChart(t, 'Terminal-Bench 4.0 Benchmark Score'), [
    { entry: 'Antigravity CLI Gemini 4 Argon', value: '58' },
    { entry: 'Muse Code Muse Wonder Full (max)', value: '57' },
    { entry: 'Muse Code Muse Wonder (max)', value: '56' },
    { entry: 'Grok Build Grok 4.7 (xhigh)', value: '55' },
    { entry: 'Devin Fusion Opus 5.5 Max GPT-6 Luna High', value: '54' },
    { entry: 'Claude Code Sonnet 5.5 (max)', value: '52' },
    { entry: 'Codex GPT-6.1 Sol (max)', value: '51' },
    { entry: 'Kimi Code CLI Kimi K3', value: '44' },
    { entry: 'Claude Code Opus 5.5 (max)', value: '43' },
    { entry: 'Codex GPT-6 Astra (max)', value: '41' },
    { entry: 'Claude Code Fable 5.1 (max) (with fallback)', value: '38' },
    { entry: 'Opencode GLM-5.3', value: '33' },
    { entry: 'Muse Code Muse Spark Open (xhigh)', value: '30' },
    { entry: 'Claude Code Haiku 5.5 (max)', value: '17' },
    { entry: 'Mirror Beam 1.0', value: '15' },
  ], 'parseAgentChart 2026-10 layout (N-of-M anchor, Mirror, Devin two-model)');
}

// parsePersonality: values-then-names positional pairing (live layout 2026-10-21)
{
  const head = ['Slop Leaderboard', 'x', '2 of 38 models'];
  const t = [...head, '66', '60', 'Model A (max)', 'Model B', 'Component Traits'].join('\\n');
  eq(parsePersonality(t, 'slop'), [{ name: 'Model A (max)', value: 66 }, { name: 'Model B', value: 60 }], 'parsePersonality pairs');
  eq(parsePersonality('nothing here', 'slop'), null, 'parsePersonality anchor miss');
  eq(parsePersonality(['Slop Leaderboard', '1 of 38 models', '66', '60', 'Only One', 'Component Traits'].join('\\n'), 'slop'), null, 'parsePersonality length mismatch');
  eq(parsePersonality(['Slop Leaderboard', 'x', '1 of 38 models', 'Ninety-nine', 'Model A'].join('\\n'), 'slop'), null, 'parsePersonality needs ints');
}

if (__failures) { console.error(__failures + ' assertion(s) failed'); process.exitCode = 1; }
`;

const tmpFile = path.join(os.tmpdir(), `aa_bench_lib_${process.pid}.mjs`);
fs.writeFileSync(tmpFile, lib);
try {
  const r = spawnSync(process.execPath, [tmpFile], { encoding: 'utf8' });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  if (r.status !== 0) { failures++; console.log('FAIL pure-parser suite exited ' + r.status); }
} finally {
  fs.rmSync(tmpFile, { force: true });
}

// --- black-box CLI tests (no browser needed for these paths) ----------------
function cli(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...(env || {}) } });
}
{
  const r = cli(['frobnicate']);
  eq(r.status, 2, 'cli unknown command exits 2');
  ok(/unknown command/.test(r.stderr), 'cli unknown command message');
}
{
  const r = cli(['check']);
  eq(r.status, 2, 'cli check without slugs exits 2');
}
{
  const r = cli(['check', 'x', '--out']);
  eq(r.status, 2, 'cli trailing --out exits 2');
}
{
  const r = cli(['personality', 'extra-slug']);
  eq(r.status, 2, 'cli personality with slugs exits 2');
}
{
  const r = cli(['coding', 'extra-slug']);
  eq(r.status, 2, 'cli coding with slugs exits 2');
}
{
  // PW_CORE=/nonexistent proves inventory never touches playwright
  const r = cli(['inventory', 'opencode'], { PW_CORE: '/nonexistent-pw-core-xyz' });
  eq(r.status, 0, 'cli inventory exits 0 without playwright');
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* assert below */ }
  ok(j && j.providers && j.providers.opencode && j.providers.opencode.length >= 1,
    'cli inventory opencode lists models (free shelf churns — count not pinned)');
  ok(j && j.partial === false, 'cli inventory partial false');
}

if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exitCode = 1; }
else console.log('\nALL TESTS PASSED');
