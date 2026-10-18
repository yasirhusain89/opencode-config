import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = process.env.OPENCODE_BIN || '/Users/yasihusain/.opencode/bin/opencode';
const FROZEN_PROMPT = `You are a strict code reviewer for a personal-finance desktop app (Tauri 2 + React/TypeScript frontend, Rust backend). Review the git diff below.

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

const manifest = JSON.parse(readFileSync(join(HERE, 'corpus/manifest.json'), 'utf8'));
const keyPath = join(HERE, 'key.json');
if (!existsSync(keyPath)) {
  const codes = ['koda', 'lynx', 'onyx'];
  const models = [
    'openrouter/meta/muse-spark-1.3-contributor',
    'opencode/glm-5.3-flash-free',
    'opencode/space-bunny-free',
  ];
  // deterministic shuffle of code<->model assignment, seeded by date
  const seed = [...'2026-10-18'].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7);
  let s = seed;
  const pick = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const shuffled = [...models].sort(() => pick() - 0.5);
  writeFileSync(keyPath, JSON.stringify(Object.fromEntries(codes.map((c, i) => [c, shuffled[i]])), null, 1));
  console.error('wrote key.json (do not read until scoring is locked)');
}
const KEY = JSON.parse(readFileSync(keyPath, 'utf8'));
const only = process.argv[2]; // optional filter: code or diff id

let done = 0, failed = 0;
for (const [code, model] of Object.entries(KEY)) {
  if (only && only !== code && !only.startsWith('d')) continue;
  if (only && only.startsWith('d') && only !== code) { /* filter by diff: run all codes */ }
  for (const d of manifest.diffs) {
    if (only && only.startsWith('d') && d.id !== only) continue;
    const out = join(HERE, 'runs', `${code}-${d.id}.json`);
    if (existsSync(out)) { done++; continue; }
    const patch = readFileSync(join(HERE, 'corpus', d.file), 'utf8');
    const prompt = FROZEN_PROMPT + '```diff\n' + patch + '\n```';
    const t0 = Date.now();
    const r = spawnSync(BIN, ['run', '-m', model, '--format', 'json', prompt],
      { encoding: 'utf8', timeout: 420000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });
    const wall_ms = Date.now() - t0;
    const rec = { run_id: `${code}-${d.id}`, diff: d.id, contender: code, model,
      wall_ms, exit: r.status, killed: r.signal === 'SIGTERM', response: '', tokens: null, error: null };
    if (r.stdout) {
      let text = [], toks = null;
      for (const line of r.stdout.split('\n')) {
        if (!line.trim()) continue;
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'text' && e.part?.text) text.push(e.part.text);
        if (e.type === 'step_finish' && e.part?.tokens) toks = e.part.tokens;
        if (e.type === 'error' || e.type === 'session.error') rec.error = JSON.stringify(e).slice(0, 300);
      }
      rec.response = text.join('\n');
      rec.tokens = toks;
    }
    if (r.status !== 0 && !rec.response) rec.error = (rec.error || '') + ' stderr: ' + (r.stderr || '').slice(0, 300);
    writeFileSync(out, JSON.stringify(rec, null, 1));
    if (rec.response && !rec.error) done++; else failed++;
    console.error(`${rec.run_id}: ${rec.response ? 'ok' : 'FAIL'} wall=${(wall_ms/1000).toFixed(0)}s out=${rec.response.length}ch`);
  }
}
console.error(`DONE done=${done} failed=${failed}`);
