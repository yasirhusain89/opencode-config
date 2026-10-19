#!/usr/bin/env node
// generate.test.mjs — black-box tests for generate.py. No network.
// Builds a fixture opencode.db (sessions/messages/parts) + git repos in a
// fake HOME, runs generate.py with OCUD_HOME pointed at it, asserts the
// payload: subscriptions, active time, intent-aware landing, pending window,
// usage-derived in_use flags, featured selection, habits, landed-by-model.
// Run: PYTHON=/opt/homebrew/bin/python3 node generate.test.mjs
//      PYTHON=/usr/bin/python3 node generate.test.mjs

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.join(HERE, '..', 'generate.py');
const PY = process.env.PYTHON || 'python3';
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
function approx(a, b, tol, label) {
  if (Math.abs(a - b) <= tol) console.log('ok   ' + label);
  else { failures++; console.log(`FAIL ${label}\n  want ~${b}\n  got  ${a}`); }
}

// ---- fixture layout (times relative to build time) ----
// R1 git repo, one commit 2d ago. R2 git repo, no commits. R3 plain dir.
// S1  R1 spark-free   intent, ends 1h before commit      -> landed
// S2  R1 glm-free     intent, ends 5d ago                -> unlanded
// S3  R2 glm-free     intent, ends 5d ago                -> uncheckable
// S4  R3 spark-free   intent, ends 5d ago                -> uncheckable
// S5  R1 spark-free   read-only, ends 5d ago             -> no intent
// S6  R1 spark-free   intent, ends 1h ago                -> pending
// S7  R1 spark-free   intent, 10 turns + gap + err, 5d  -> unlanded
// S8  R1 go/spark     intent, ends 5d ago, cost 0.5      -> unlanded, covered
// S9-16 R1 spark-free 1 turn each, no tools              -> no intent
// S17 R1 spark-free   5 edit errors, tiny tokens         -> unlanded, featured via errors
// S18 R1 spark-free   9 turns, tiny tokens               -> no intent, featured via turns
const BUILD = `
import json, sqlite3, sys, time
tmp, r1, r2, r3, db = sys.argv[1:6]
T0 = int(time.time() * 1000)
D, H, M, S = 86400000, 3600000, 60000, 1000
COMMIT = T0 - 2 * D
def ago(ms): return T0 - ms
con = sqlite3.connect(db)
c = con.cursor()
c.execute("CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER, tokens_cache_read INTEGER, tokens_cache_write INTEGER, title TEXT, summary_additions INTEGER, summary_deletions INTEGER, summary_files INTEGER, agent TEXT, model TEXT, cost REAL)")
c.execute("CREATE TABLE message (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)")
c.execute("CREATE TABLE part (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, message_id INTEGER, time_created INTEGER, data TEXT)")
def add_asst(sid, ts, dur_s, prov, model, variant, tin, cost=0.0):
    d = {"role": "assistant", "providerID": prov, "modelID": model, "cost": cost, "finish": "stop",
         "time": {"created": ts, "completed": ts + dur_s * 1000},
         "tokens": {"input": tin, "output": 50, "reasoning": 0, "cache": {"read": 0, "write": 0}}}
    if variant is not None:
        d["variant"] = variant
    c.execute("INSERT INTO message (session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?)",
              (sid, ts, ts + dur_s * 1000, json.dumps(d)))
    return c.lastrowid
def add_user(sid, ts, text):
    d = {"role": "user", "time": {"created": ts, "completed": ts}}
    c.execute("INSERT INTO message (session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?)",
              (sid, ts, ts, json.dumps(d)))
    um = c.lastrowid
    c.execute("INSERT INTO part (session_id, message_id, time_created, data) VALUES (?, ?, ?, ?)",
              (sid, um, ts, json.dumps({"type": "text", "text": text})))
    return um
def add_tool(sid, amm, ts, tool, err=False, cmd=None, dur_s=5):
    st = {"status": ("error" if err else "ok"), "time": {"start": ts, "end": ts + dur_s * 1000}}
    if cmd is not None:
        st["input"] = {"command": cmd}
    c.execute("INSERT INTO part (session_id, message_id, time_created, data) VALUES (?, ?, ?, ?)",
              (sid, amm, ts, json.dumps({"type": "tool", "tool": tool, "state": st})))
def add_patch(sid, amm, ts, files):
    c.execute("INSERT INTO part (session_id, message_id, time_created, data) VALUES (?, ?, ?, ?)",
              (sid, amm, ts, json.dumps({"type": "patch", "files": files})))
def add_session(sid, directory, model, title, first, last, tin):
    c.execute("INSERT INTO session (id, project_id, directory, time_created, time_updated, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, title, summary_additions, summary_deletions, summary_files, agent, model, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              (sid, "p1", directory, first, last, tin, 50, 0, 0, 0, title, 0, 0, 0, "main", json.dumps(model), 0.0))
SPARK = {"id": "muse-spark-1.3-contributor-free", "providerID": "opencode", "variant": "xhigh"}
SPARK_NV = {"id": "muse-spark-1.3-contributor-free", "providerID": "opencode"}
GLM = {"id": "glm-5.3-flash-free", "providerID": "opencode"}
GOSPARK = {"id": "muse-spark-1.3-contributor", "providerID": "opencode-go", "variant": "xhigh"}
# S1: 110 asst (10s), 3 turns, edit+patch, ends 1h before commit
e1 = COMMIT - 3600000
u = [e1 - 900 * S, e1 - 600 * S, e1 - 300 * S]
for i, ts in enumerate(u):
    add_user("fixS01", ts, "z" * 100)
n = [37, 37, 36]
for i, ts in enumerate(u):
    for k in range(n[i]):
        m = add_asst("fixS01", ts + 5000 + k * 1000, 10, "opencode", SPARK["id"], "xhigh", 9090)
        if i == 0 and k == 0:
            add_tool("fixS01", m, ts + 6000, "edit")
            add_patch("fixS01", m, ts + 7000, ["a.py"])
add_session("fixS01", r1, SPARK, "s1 landed", u[0], e1, 1000000)
# S2: 8 glm asst, 2 turns, edit ok, ends 5d ago
e2 = ago(5 * D)
for i, ts in enumerate([e2 - 600 * S, e2 - 300 * S]):
    add_user("fixS02", ts, "z" * 100)
    for k in range(4):
        m = add_asst("fixS02", ts + 5000 + k * 1000, 10, "opencode", GLM["id"], None, 62500)
        if i == 0 and k == 0:
            add_tool("fixS02", m, ts + 6000, "edit")
add_session("fixS02", r1, GLM, "s2 missed", e2 - 600 * S, e2, 500000)
# S3/S4/S5/S6: 2 asst + 1 turn each
for sid, directory, model, prov, mid, tin, tc, title, tool in [
    ("fixS03", r2, GLM, "opencode", GLM["id"], 400000, ago(5 * D), "s3 nocommits", "edit"),
    ("fixS04", r3, SPARK_NV, "opencode", SPARK_NV["id"], 300000, ago(5 * D), "s4 nogit", "edit"),
    ("fixS05", r1, SPARK_NV, "opencode", SPARK_NV["id"], 200000, ago(5 * D), "s5 qna", "read"),
    ("fixS06", r1, SPARK_NV, "opencode", SPARK_NV["id"], 100000, ago(1 * H), "s6 recent", "edit"),
]:
    add_user(sid, tc - 60 * M, "z" * 100)
    for k in range(2):
        m = add_asst(sid, tc - 60 * M + 5000 + k * 1000, 10, prov, mid, None, tin // 2)
        if k == 0:
            add_tool(sid, m, tc - 60 * M + 6000, tool)
    add_session(sid, directory, model, title, tc - 60 * M, tc, tin)
# S7: 10 turns, 20min gap, 5000-char first prompt, 1 error + quick re-prompt
e7 = ago(6 * D)
ts = e7 - 10 * 300 * S
for i in range(10):
    if i == 2:
        ts += 15 * M
    t = "x" * 5000 if i == 0 else "z" * 100
    add_user("fixS07", ts, t)
    m = add_asst("fixS07", ts + 5000, 60, "opencode", SPARK["id"], "xhigh", 9000)
    if i == 0:
        add_tool("fixS07", m, ts + 6000, "edit")
        add_patch("fixS07", m, ts + 7000, ["b.py"])
    if i == 3:
        add_tool("fixS07", m, ts + 6000, "bash", err=True, cmd="pytest -x")
    ts += 60 * S if i == 3 else 300 * S
add_session("fixS07", r1, SPARK, "s7 churn", e7 - 10 * 300 * S, e7, 90000)
# S8: go usage, cost recorded (covered by plan)
e8 = ago(5 * D)
add_user("fixS08", e8 - 60 * M, "z" * 100)
for k in range(2):
    m = add_asst("fixS08", e8 - 60 * M + 5000 + k * 1000, 10, "opencode-go", GOSPARK["id"], "xhigh", 40000, cost=0.25)
    if k == 0:
        add_tool("fixS08", m, e8 - 60 * M + 6000, "edit")
add_session("fixS08", r1, GOSPARK, "s8 go", e8 - 60 * M, e8, 80000)
# S9-S16: 1 turn each, graduated tiny tokens, no tools
tins = [70000, 60000, 50000, 40000, 30000, 20000, 10000, 5000]
for i, tin in enumerate(tins):
    sid = "fixS%02d" % (9 + i)
    tc = ago(5 * D) - i * M
    add_user(sid, tc - 60 * M, "z" * 100)
    add_asst(sid, tc - 60 * M + 5000, 10, "opencode", SPARK_NV["id"], None, tin)
    add_session(sid, r1, SPARK_NV, "s%d quiet" % (9 + i), tc - 60 * M, tc, tin)
# S17: 5 edit errors, tiny tokens (featured via errors, not cost)
e17 = ago(5 * D)
add_user("fixS17", e17 - 60 * M, "z" * 100)
for k in range(5):
    m = add_asst("fixS17", e17 - 60 * M + 5000 + k * 1000, 10, "opencode", SPARK_NV["id"], None, 100)
    add_tool("fixS17", m, e17 - 60 * M + 6000, "edit", err=True)
add_session("fixS17", r1, SPARK_NV, "s17 errloop", e17 - 60 * M, e17, 500)
# S18: 9 turns, tiny tokens (featured via turns, not cost)
e18 = ago(5 * D)
ts = e18 - 9 * 300 * S
for i in range(9):
    add_user("fixS18", ts, ("y" * 9000 if i == 0 else "z" * 100))
    add_asst("fixS18", ts + 5000, 10, "opencode", SPARK_NV["id"], None, 44)
    ts += 300 * S
add_session("fixS18", r1, SPARK_NV, "s18 chatty", e18 - 9 * 300 * S, e18, 400)
con.commit()
print("fixture sessions: 18")
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocud-test-'));
const r1 = path.join(tmp, 'r1'), r2 = path.join(tmp, 'r2'), r3 = path.join(tmp, 'r3');
fs.mkdirSync(r1, { recursive: true }); fs.mkdirSync(r2, { recursive: true }); fs.mkdirSync(r3, { recursive: true });
execFileSync('git', ['init', '-q', r1]);
execFileSync('git', ['init', '-q', r2]);
fs.writeFileSync(path.join(r1, 'a.py'), 'x = 1\n');
const commitMs = Date.now() - 2 * 86400000;
const iso = new Date(commitMs).toISOString();
execFileSync('git', ['-C', r1, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', 'a.py']);
execFileSync('git', ['-C', r1, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fix'],
  { env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso } });
const dbPath = path.join(tmp, 'share', 'opencode.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
execFileSync(PY, ['-', tmp, r1, r2, r3, dbPath], { input: BUILD, encoding: 'utf8' });

// run generate.py against the fake HOME
const out = path.join(tmp, 'out');
fs.mkdirSync(path.join(out, '.local', 'share', 'opencode'), { recursive: true });
fs.copyFileSync(dbPath, path.join(out, '.local', 'share', 'opencode', 'opencode.db'));
// fixture log: 2 recent 429s + 1 stale (outside the 24h window)
const logDir = path.join(out, '.local', 'share', 'opencode', 'log');
fs.mkdirSync(logDir, { recursive: true });
const nowISO = () => new Date().toISOString();
const oldISO = new Date(Date.now() - 48 * 3600000).toISOString();
fs.writeFileSync(path.join(logDir, 'opencode.log'), [
  `timestamp=${nowISO()} level=ERROR message="stream error" providerID=nvidia modelID=z-ai/glm-5.3-flash error="AI_APICallError: Too Many Requests"`,
  `timestamp=${nowISO()} level=ERROR message="stream error" providerID=nvidia modelID=z-ai/glm-5.3-flash error="AI_APICallError: Too Many Requests"`,
  `timestamp=${oldISO} level=ERROR message="stream error" providerID=nvidia modelID=z-ai/glm-5.3-flash error="AI_APICallError: Too Many Requests"`,
].join('\n') + '\n');
// fixture Go quota snapshot (as scripts/go_quota.mjs would write it)
fs.mkdirSync(path.join(out, '.opencode', 'usage-dashboard'), { recursive: true });
fs.writeFileSync(path.join(out, '.opencode', 'usage-dashboard', 'quota.json'), JSON.stringify({
  fetched_at: nowISO(),
  rolling: { percent: 12.5, resetInSec: 3600 },
  weekly: { percent: 34, resetInSec: 86400 },
  monthly: { percent: 56.5, resetInSec: 604800 },
}));
// fixture provider credits (as scripts/provider_credits.mjs would write them)
fs.writeFileSync(path.join(out, '.opencode', 'usage-dashboard', 'credits.json'), JSON.stringify({
  fetched_at: nowISO(),
  providers: { openrouter: { label: 'test-key', usage: 0, budget_usd: 25, budget_spend_usd: 0, budget_remaining_usd: 25, free_daily: { used: 0, limit: 1000, remaining: 1000 } } },
}));
execFileSync(PY, [GEN], { env: { ...process.env, OCUD_HOME: out }, encoding: 'utf8' });
const raw = fs.readFileSync(path.join(out, '.opencode', 'usage-dashboard', 'data.js'), 'utf8');
const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
ok(fs.existsSync(path.join(out, '.opencode', 'usage-dashboard', 'history.jsonl')), 'history written');

// hero: subscriptions + active time
const nowYM = new Date().toISOString().slice(0, 7);
const [y1, m1] = ['2026', '10'].map(Number);
const [y2, m2] = nowYM.split('-').map(Number);
const months = (y2 - y1) * 12 + (m2 - m1) + 1;
eq(j.hero.sessions, 18, 'hero sessions');
eq(j.hero.actual, months * 10, 'paid = flat Go sub (metered covered, not added)');
eq(j.hero.metered_covered, 0.5, 'metered go usage recorded as covered');
approx(j.hero.active_min, 2100 / 60, 0.01, 'hero active minutes');
ok(j.hero.mix[0].name.includes('muse-spark-1.3-contributor-free'), 'mix top is spark-free');
approx(j.hero.mix[0].pct, 92.5, 0.05, 'mix top share');

// landing: 1 landed / 5 checkable / 10 no-intent / 1 pending
eq([j.landing.landed, j.landing.checkable, j.landing.no_intent, j.landing.pending, j.landing.total],
  [1, 5, 10, 1, 18], 'landing counts');
const byModel = Object.fromEntries(j.landing.by_model.map(r => [r.name, [r.landed, r.n]]));
eq(byModel['opencode / muse-spark-1.3-contributor-free'], [1, 3], 'spark landed rate');
eq(byModel['opencode / glm-5.3-flash-free'], [0, 1], 'glm landed rate');
eq(byModel['opencode-go / muse-spark-1.3-contributor'], [0, 1], 'go landed rate');
const byVar = Object.fromEntries(j.landing.by_variant.map(r => [r.name, [r.landed, r.n]]));
eq(byVar['xhigh'], [1, 3], 'xhigh landed rate');
eq(byVar['unset'], [0, 2], 'unset landed rate');

// usage-derived in_use flags (spark 148 msgs on, glm 10 off)
const cmp = Object.fromEntries(j.compare_opts.map(m => [m.name, m.in_use]));
eq(cmp['Muse Spark 1.3'], true, 'spark badged in use');
eq(cmp['GLM-5.3-Flash'], false, 'glm not badged (10 msgs)');
eq(cmp['Space Bunny'], false, 'space bunny not badged (0 msgs)');

// featured selection: 12 costliest + err-loop + chatty session
eq(j.sessions.length, 14, 'featured session count');
const ids = new Set(j.sessions.map(s => s.id8));
ok(ids.has('fixS17'), 'error-loop session featured');
ok(ids.has('fixS18'), 'chatty session featured');
ok(!ids.has('fixS15') && !ids.has('fixS16'), 'cheapest quiet sessions excluded');
const s17 = j.sessions.find(s => s.id8 === 'fixS17');
eq([s17.errors, s17.calls], [5, 5], 's17 error calls');

// habits aggregates
eq(j.habits.n, 18, 'habits session count');
eq([j.habits.turns_p50, j.habits.turns_p90], [1, 9], 'turns p50/p90');
eq([j.habits.gap_sessions, j.habits.gap_hours], [1, 0.3], 'idle gaps');
eq(j.habits.after_err_turns, 1, 'post-error re-prompts');
eq([j.habits.prompt_p50, j.habits.prompt_p90], [100, 5000], 'first-prompt sizes');
eq(j.habits.clean, 16, 'clean sessions');

// variants + reliability plumbing
eq(j.variants[0], { name: 'xhigh', msgs: 122, out: 6100 }, 'variant mix top');
eq(j.errors_by_tool.find(t => t.tool === 'edit').n >= 5, true, 'edit errors counted');
const hourTotal = j.hours.reduce((a, h) => a + h.sessions, 0);
eq(hourTotal, 18, 'hours cover all sessions');
eq(j.billing_flags, [], 'no billing flags on free/go traffic');
eq(j.rate429, { count: 2, by_model: [['z-ai/glm-5.3-flash', 2]] }, 'recent 429s counted, stale ignored');
eq(j.hero.quota.monthly, { percent: 56.5, resetInSec: 604800 }, 'quota snapshot passes through');
eq(j.credits.providers.openrouter.budget_remaining_usd, 25, 'credit snapshot passes through');

// micro-DB: non-free model on a key-authed provider must raise a billing flag
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ocud-test2-'));
const share2 = path.join(tmp2, 'out', '.local', 'share', 'opencode');
fs.mkdirSync(share2, { recursive: true });
const MICRO = `
import json, sqlite3, sys, time
db = sys.argv[1]
t0 = int(time.time() * 1000) - 5 * 86400000
con = sqlite3.connect(db)
c = con.cursor()
c.execute("CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER, tokens_cache_read INTEGER, tokens_cache_write INTEGER, title TEXT, summary_additions INTEGER, summary_deletions INTEGER, summary_files INTEGER, agent TEXT, model TEXT, cost REAL)")
c.execute("CREATE TABLE message (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)")
c.execute("CREATE TABLE part (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, message_id INTEGER, time_created INTEGER, data TEXT)")
c.execute("INSERT INTO session VALUES ('fixB0001', 'p1', '${r1}', %d, %d, 1000, 50, 0, 0, 0, 'b', 0, 0, 0, 'main', '%s', 0.0)" % (t0, t0 + 60000, json.dumps({"id": "paid-model-x", "providerID": "openrouter"})))
c.execute("INSERT INTO message (session_id, time_created, time_updated, data) VALUES ('fixB0001', %d, %d, '%s')" % (t0, t0, json.dumps({"role": "user", "time": {"created": t0, "completed": t0}})))
um = c.lastrowid
c.execute("INSERT INTO part (session_id, message_id, time_created, data) VALUES ('fixB0001', %d, %d, '%s')" % (um, t0, json.dumps({"type": "text", "text": "hi"})))
d = {"role": "assistant", "providerID": "openrouter", "modelID": "openrouter/paid-model-x", "cost": 0.0, "finish": "stop",
     "time": {"created": t0 + 5000, "completed": t0 + 15000},
     "tokens": {"input": 1000, "output": 50, "reasoning": 0, "cache": {"read": 0, "write": 0}}}
c.execute("INSERT INTO message (session_id, time_created, time_updated, data) VALUES ('fixB0001', %d, %d, '%s')" % (t0 + 5000, t0 + 15000, json.dumps(d)))
am = c.lastrowid
c.execute("INSERT INTO part (session_id, message_id, time_created, data) VALUES ('fixB0001', ?, ?, ?)",
          (am, t0 + 6000, json.dumps({"type": "tool", "tool": "edit", "state": {"status": "ok", "time": {"start": t0 + 6000, "end": t0 + 11000}}})))
con.commit()
print("micro db ready")
`;
execFileSync(PY, ['-', path.join(share2, 'opencode.db')], { input: MICRO, encoding: 'utf8' });
execFileSync(PY, [GEN], { env: { ...process.env, OCUD_HOME: path.join(tmp2, 'out') }, encoding: 'utf8' });
const raw2 = fs.readFileSync(path.join(tmp2, 'out', '.opencode', 'usage-dashboard', 'data.js'), 'utf8');
const j2 = JSON.parse(raw2.slice(raw2.indexOf('{'), raw2.lastIndexOf('}') + 1));
eq(j2.billing_flags, [{ provider: 'openrouter', model: 'paid-model-x', msgs: 1 }], 'billing flag fires on key-authed non-free model');
eq([j2.landing.landed, j2.landing.checkable], [0, 1], 'micro landing counted');
eq(j2.rate429.count, 0, 'missing log tolerates to zero 429s');
eq(j2.hero.quota, null, 'missing quota snapshot is null');
eq(j2.credits, null, 'missing credits snapshot is null');

// quota-status script reads the same OUT dir (no network, exit 0)
const qs = execFileSync('node', [path.join(HERE, 'quota-status.mjs')],
  { env: { ...process.env, OCUD_OUT: path.join(out, '.opencode', 'usage-dashboard') }, encoding: 'utf8' });
ok(qs.includes('Go plan: rolling 13%'), 'quota-status shows Go rolling pct');
ok(qs.includes('OpenRouter key'), 'quota-status shows OR key line');
ok(qs.includes('Actually paid'), 'quota-status shows recorded spend');
ok(qs.includes('No billing flags'), 'quota-status reports clean flags');

if (failures) { console.error(`generate.test FAILED (${failures})`); process.exit(1); }
console.log('ALL GENERATE TESTS PASSED');
