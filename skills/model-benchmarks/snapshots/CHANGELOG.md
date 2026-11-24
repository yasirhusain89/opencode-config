# model-benchmarks — changelog (run-log lives here, not in the guide)

## 2026-11-22 — 2-stage mini-eval funnel (`mini_eval.mjs`) + 10-model stealth/launch scorecard
- **Harness:** `scripts/mini_eval.mjs` + `scripts/mini_eval.test.mjs` (39/39 unit
  assertions) implement a 2-stage funnel:
  - **Stage 1 (`probe`, 0–100 deterministic composite, 4 tasks):** P1 Code
    Synthesis (35 pts, 10 unit test cases in `vm`), P2 BugHunt (35 pts, 3
    planted bugs + 1 clean decoy with −10 FP penalty), P3 Constraint Logic (15
    pts, exact lock schedule + peak write buffer), P4 Agentic Tool Discipline
    (15 pts, workspace-internal fixture `snapshots/evals/.p4-fixture/` to avoid
    headless `external_directory` auto-reject).
  - **Stage 2 (`corpus`, hardened §16 blind 10-diff reviewer eval):** strips
    `model` and identity tokens from `runs/*.json`, requires `--judge` in
    `key.json`, pauses routes after 2 consecutive DNFs, and enforces
    mathematical futility (`checkSequentialStopping`) after core-6 diffs.
  - **Isolation:** `OPENCODE_MODEL_FALLBACK=off`, `--archived --title`,
    `agents.title.model` pinned to candidate (zero paid-Go title leak on free
    routes), tool-deny config on standalone tasks P1–P3.
- **2026-11-22 live Stage 1 scorecard (`snapshots/evals/2026-11-22/probe-scorecard.md`):**
  1. `opencode/iceman-free`: **100/100** (Apex, 4/4, p50 43.3s, 55.6 tps, 91% reas)
  2. `opencode-go/glm-5.3-flash`: **100/100** (Apex, 4/4, p50 7.7s, 89.2 tps, 78% reas)
  3. `opencode/big-pickle`: **98/100** (Apex, 4/4, p50 28.3s, 90.4 tps, 93% reas)
  4. `opencode-go/iceman-contributor-free`: **96/100** (Apex, 4/4, p50 47.1s, 60 tps, 90% reas — matches `opencode/iceman-free`)
  5. `opencode/hy4-flash-free`: **96/100** (Apex, 4/4, p50 22.7s, 163.9 tps, 94% reas)
  6. `opencode-go/kimi-k3.1-pro`: **90/100** (Apex, 4/4, p50 23.3s, 89.9 tps, 90% reas; caught all 3 P2 bugs, −10 FP on decoy)
  7. `opencode/mimo-v2.6-flash-free`: **86/100** (Apex, 4/4, p50 23.7s, 94.5 tps, 86% reas)
  8. `opencode/flint-40b-free`: **72/100** (Workhorse, 3/4, p50 61.4s, 0% reas; P3 timeout, P4 41-step XML tool thrash)
  9. `opencode/longcat-2.5-free`: **71/100** (Workhorse, 3/4, p50 30.8s, 60.4 tps, 89% reas; P3 timeout)
  10. `opencode/tidepool-alpha-free`: **61/100** (Workhorse, 2/4, p50 76.4s, 130.2 tps, 96% reas; P1 35/35, P2 26/35, P3/P4 upstream stalls >120s)
- **Guide integration:** `guide_data.mjs` joins `probe-summary.json` into §1
  freshness, §4 free routes, §6 Go catalog (`Mini-eval ⇅` column + `EVAL`
  badges), and §16 live scorecard table (expanded by default, `Evaluated` filter
  pill in `Guide.svelte`).

## 2026-11-22 — P0–P4: quota-semantics fixes + guide UX overhaul (Gap/launch/catalog)
- **P0 quota semantics (user-corrected):** free endpoints (`opencode/*-free`,
  `opencode-go/*-free`) sit in a separate pool with tighter limits and never
  burn Go quota; NVIDIA is the slow last resort (per-model p50 ~37s vs ~7s Go).
  `sr-calc.mjs` excludes `-free` from Go windows/daily/shares (flags
  `freePool`), `dashboard.mjs` excludes `-free` from SR/cap pacing (free equiv
  = `$0 (free pool)`), `model-fallback.js` + `dashboard.mjs` route low-stakes
  through `opencode/mimo-v2.6-flash-free` first with NVIDIA-last chaining.
  Tests updated (free-exclusion fixtures, chain-advance test, Go-headroom paid-only).
- **P1 freshness + launch diff:** `guide_data.mjs` joins newest + previous
  check/coding/access snapshots — §1 now leads with same-vintage Provider gap
  (Intel 65 vs Go 46, −19 · Eng 58 vs Go 55, −3), What's new (Go +5/−1, AA +7),
  and a freshness bar (Intel 11-22 partial · Eng 10-24 · CAI 11-21 partial).
- **P2 Go catalog:** §6 auto-built from the live `opencode-go` catalog — all 33
  routes tiered (Apex/Workhorse/Free pool) with Eng/Intel/agentic/Go $/1M/cap/
  pin/action; NEW + PINNED badges; nominal tiers, no dollar runways.
- **P3 master join:** §2 gains a live Available column (Go $10 / OC Free / NV /
  OR + PINNED/NEW) on family-key join with short-stem guards.
- **P4 declutter + dark theme:** 1-click provider pills (All/On Go/Free
  pool/Frontier/New/Pinned), 8 reference sections + §9b personality matrix in
  `<details>` drawers (17 h2 / 23 tables intact), theme-aware pill/chart vars.
  SSR 151K chars, 319 rows, check OK. Standalone preview re-opened.

## 2026-11-22 — guide rebuilt on 11-22 snapshots (eval dashboard live)
- **New snapshots:** `check-2026-11-22.json` (17 slugs, Intel/pricing fresh;
  engineering tab timed out 17/17 — Eng stays 10-24 vintage), 
  `coding-index-2026-11-21.json` (CAI v2.1 partial: DeepSWE/T-Bench tabs failed,
  SWE-Atlas-QnA only), `access-2026-11-22.json` (424 live routes: 33 Go, 11
  opencode, 20 nvidia, 3 ollama, 357 openrouter aliases; assembled from
  oc-models-live.txt — CLI inventory stays V2-broken).
- **Regenerated:** `dashboard-2026-11-22.json` + `routing-2026-11-22.json`
  (dashboard.mjs), `data.js` (guide_data.mjs, 17 sections / 283 rows),
  rebuilt app assets; `npm run check` SSR 143,749 chars, 23 tables / 306 rows.
- Known staleness: usage $/day in §1/§8 still reads the frozen V1 `message`
  table (V2 gap); Go §6 caps are the blog-verified 11-02 tiers (dashboard.mjs
  GO ↔ generate.py GO_ALLOWANCE 32/32 in sync).

## 2026-11-22 — Go price-table mirror resync to 11-02 blog + AA refresh in flight
- **Blog-verified caps:** `dashboard.mjs` GO + `generate.py` GO_PRICES/GO_ALLOWANCE
  resynced to atomicbot.ai/blog/opencode-go (checked 2026-11-02):
  DS V4.1 Flash 80→100, Argon(+contrib) 60→30, MiniMax-M3.1-Flash 30→20,
  space-bunny 30→20, K2.7-Code/Qwen3.7-Plus/MiniMax-M3 15→60 (were $15 defaults),
  Qwen3.8-Flash 15→30, Step-5-Preview 60→15. Added missing $60/$30/$15-tier
  members (glm-5.2, spark-1.2-contrib, mimo-v2.5, mimo-v2.5-pro, grok-4.7,
  longcat-2.0, hy3, hy4(+preview), qwen4-max unverified-default $15).
  Fixed mimo-v2.6-pro cached-read 0.0036→0.003625. Mirrors now 32/32 in sync;
  dashboard suite green (aa_bench inventory 2 pre-existing V2 failures unchanged).
- **AA refresh running:** `aa_bench.mjs check` 17 slugs (Go shortlist + Qwen4-Max,
  GLM-5.3, Grok-4.7, MiMo-Pro, DS-Flash, Qwen3.8-Max) → /tmp/aa_check_refresh.json;
  engineering tab failed 12/12 on 11-21 pull (locator.click timeout) so Eng stays
  10-24 vintage until the tab selector is fixed; Intel/pricing/highlights refresh
  from the new pull. Coding Index re-pull still pending (v2.1 partial 11-21).

## 2026-10-24 — §10 caveats + vintage labels + table a11y
- **§10 is now real:** six caveats (model×harness, per-section vintage,
  unverified Go caps, free-route privacy, lossy usage metrics, benchmark
  disagreement) and a copy-paste refresh runbook. Removed the empty list
  and the lone `open` command.
- **Vintage is labelled where it differs from the 10-24 snapshot:** §2
  (AA 10-24 · OR 10-18 · ‡ 09-16), §4 (free 10-24 · OR 10-18), §9b
  (AA 10-21), §11 (09-16), §12 (Oct-18 peak), §13 (BFCL 10-19 /
  verbosity 10-18), §16 (result 10-18), §17 (CAI 10-18).
- **Table UX/a11y:** sortable headers are keyboard-operable (Enter/Space)
  and expose `aria-sort`; the filter input and theme button have labels /
  `aria-pressed`; header tooltips open on focus, clamp to the first/last
  column that actually has a tip (not the first/last `<th>`), and cap at
  the viewport; ≤760px tables scroll inside their own box and disable
  sticky headers.
- Rebuilt `assets/app.js` + `app.css`, regenerated `data.js`; SSR check
  23 tables / 307 rows, dashboard + aa_bench suites green.

## 2026-10-24 — correctness refresh: live catalog, dead routes, prices

- **Access/free sections rebuilt from the live catalog.** §3 now says
  opencode is 16 = 7 free + 9 paid Zen (not a single "free shelf"), Go is
  30 routes (snapshot 29 + `iceman-contributor-free`), and nvidia is 38
  (58 → 38; `moonshotai/kimi-k3` gone). §4 pruned the four dead free
  routes (`minimax-m3.1-flash-free`, `nemotron-3-ultra-free`,
  `nemotron-3.5-lightning-free`, `longcat-2.5-preview-free`), added
  `flint-40b-free`, and split `big-pickle` out of the dead LongCat row.
  Fixed the MiMo **Flash** row (was carrying Pro's 46/46 + 48 tps) and
  the Gemma 26B/31B conflation.
- **Dead security pin found and fixed.** `agent/security-reviewer.md`
  used `opencode-go/claude-haiku-5.5`; the live ID is
  `claude-haiku-5-5`. The old dead-pin check only looked for `*-free`
  agent pins on the opencode shelf, so it missed this. `dashboard.mjs`
  now validates every pin against every provider catalog, reports
  `fallbackLive`, and computes `goTop` across all Go routes (the main
  model is Spark, not GLM-flash). GO/FAMILY_CAP gained aliases for the
  live `claude-haiku-5-5` and `kimi-k3.1-pro` IDs.
- **Numbers corrected against the 10-24 AA pull + CLI metadata.** DS V4.1
  Flash is Eng 45 / $0.26/task (was 38/0.49); Gemini 4 Argon bills at
  list $2/$10/$0.10 in Go (DB spend confirms it), so its loop cost is
  ~$58/day, not ~$118; Grok's cached-read rate is $0.50; Kimi K3.1's Go
  price is confirmed at $2/$10/$0.20. Removed the stale "2× counting
  cancels the 50% off" Argon promo claim.
- **Stale recommendations removed.** Reviewer/brainstorm fallbacks now
  point at the live paid `opencode-go/minimax-m3.1-flash`; the
  researcher "only Argon clears T-Bench" line is replaced with the
  K3.1-67-but-$15-cap economics; §16's 10-18 result is marked historical
  and no longer issues a current pin; §15's "cache-read 0" is replaced
  with the measured 81–97%; §8 labels the 10-18 peak separately from the
  10-24 table.
- **Volume basis fixed.** §12 is explicitly the Oct-18 peak-day ceiling;
  §7 self-host now compares 233M/day peak vs 7.3M/day on 10-24 and no
  longer claims "2% of our volume" for the current day.
- `weekly_report.mjs` gained `kimi-k3.1` before the `kimi-k3` substring
  rule and DS V4.1 Eng 45. Rebuilt `data.js`; dashboard + aa_bench suites
  green, SSR check 23 tables / 307 rows.

## 2026-10-24 — §6 Go-workload UX overhaul (user-reported poor UX)
- **Table 14 cols → 11, no horizontal scroll:** dropped Value (order still
  Value-desc), merged `$/1M in/out` + `Cached` into `Go $/1M` and both caps
  into `Cap (Go / Go+)`, replaced the 20–35-word Role prose with 1-line
  Verdicts, Model moved to column 1 with live-pin badges (reviewer /
  security / main). Removed the only `"scroll": 1` in the guide.
- **Sorting fixed (`DataTable.svelte`):** unpublished cells (—, ?) now sink
  to the bottom in both directions (were `-Infinity`, surfacing on first
  click); `∞` parses as +Infinity; `<N` sorts at half N; higher-is-better
  columns (Eng, Intel, tok/s, Days — new `dir: 'desc'` head field) sort
  descending on first click; active column shows ↑/↓ instead of ⇅.
- **CSS (`app.css`):** `table.scrollx` no longer `display:block` +
  `overflow-x:auto` (broke sticky thead, clipped 340px header tooltips);
  first/last-column tooltips clamp inside the viewport.
- **Prose trimmed:** 140-word intro + 4 trailing notes → 1 legend + 1
  footnote (stale free-shelf names and §9-duplicated pin advice removed).
- Rebuilt app assets (`npm run build`), regenerated `data.js`; SSR check
  (23 tables, 311 rows), both script suites green.

## 2026-10-24 — Kimi K3.1 Pro lands on Go + AA
- **`opencode-go/kimi-k3.1-pro` is live** (inventory 10-24; `access-2026-10-24.json`).
  Same sweep: Go renames `gemini-4-argon-contributor` → `gemini-4-argon` and
  `minimax-m3.1-flash-free` → `minimax-m3.1-flash`, `longcat-2.5-preview-free`
  removed from both shelves; opencode shelf gains `flint-40b-free` +
  `muse-wonder-1.0`; nvidia shrank 58 → 38 (`moonshotai/kimi-k3` gone,
  `minimaxai/minimax-m3.1-flash` added).
- **Fresh AA pull** (`check kimi-k3-1-pro`, `check-2026-10-24.json` = 23
  carried 10-20 models + K3.1 Pro): Intel 55, **Eng 55 (rank 6)**,
  $2/$10 in/out, 90% cache discount ($0.20), $2.11/task, 73 tps, 150M eval
  tokens (very verbose), 1M ctx, 2.8T/104B active. Weights not yet published
  (open-weights lead pending). Fresh Eng table drops Kimi K3 (43) and
  MiMo-V2.6-Flash (37) vs 10-20 — their model-page numbers are retained.
- **Go usage: 0 DB msgs ever for any kimi route** (7-day route mix is
  spark-contributor + free shelf). Go price assumed = AA first-party
  ($2/$10/$0.20, as kimi-k3) with the $15-tier default cap — **verify in the
  Go console**; `dashboard.mjs` GO map + `sr-calc.mjs` FAMILY_CAP each gained
  `kimi-k3-1-pro:15` and a `gemini-4-argon:60` alias for the renamed route.
  At our Oct-18 reviewer mix K3.1 Pro burns ~$65/loop-day → ~0.2 days on a
  $15 cap: single sessions only. Guide §2 + §6 carry the new rows
  (Value 26, between Argon 27 and GLM-5.3 22); §3 still owes a full refresh.
- **Coding pull degraded twice** (DeepSWE tab timeout, QnA 0 rows, empty
  index — same on retry): `coding-index-2026-10-18.json` stands. No CAI
  composite for K3.1 Pro yet; AA's 10-23 launch notes give GDPval-AA 1,846
  (3rd), T-Bench 4.0 67% (highest AA-tested), AutomationBench 73%, HLE 52%,
  CritPt 25%, SciCode 61%, Omniscience 30. Never pin unevaluated (§16).

## 2026-10-18 (evening) — scheduled updates hardened
- `weekly_pull.sh` is now the full unattended refresh: OR catalog +
  value report, provider inventory, dashboard regen + guide splice, AA
  index version check (`scripts/aa_version.mjs` vs
  snapshots/aa-index-version.txt), both test suites, CHANGELOG appends
  on findings. Idempotent via 7-day catalog staleness guard.
- Tested end-to-end in a fake-HOME sandbox (found + fixed: playwright
  browser path follows HOME; dedupe dead-pin changelog lines).
- launchd still Monday 06:00 only with NO catch-up — missed 10-05 and
  10-12 while the box slept. RunAtLoad entry still to add (needs a
  launchctl unload/load cycle); until then re-run by hand after boot.
- AA index pinned at v1.5 (`snapshots/aa-index-version.txt`); a version
  bump now pages the CHANGELOG automatically.
- launchd: added RunAtLoad catch-up (bootout/bootstrap 2026-10-18;
  verified firing with exit 0 via the staleness guard). The 10-05/10-12
  misses should not recur — a slept-through Monday now runs at next login.

## 2026-10-19 (evening) — critical-review follow-ups
- **BFCL verified live, guide corrected:** BenchLeader mirror shows 83
  live configs; zero direct entries for our October-wave finalists, only
  previous-gen relatives (GLM-4.6 72.4%, Kimi K2 59.1%, DS V3.2 56.7%,
  Grok 4.x, Qwen3 family, GPT-5.x). §13 now states this + re-check rule.
- **dashboard.mjs extended:** per-route reliability (msgs, fail % from
  zero-token/no-finish turns, p50 turn latency, actual $ from DB cost
  field), unmatched-AA-pin drift (newest check snapshot), snapshot ages,
  Go pacing (days to weekly sub-cap), metered-vs-projected Go spend,
  `routing-YYYY-MM-DD.json` (machine-readable primary/fallback pins).
  §8 usage table gained Fail % + p50 s columns (generated).
- **§16 eval protocol hardened:** judge pinning, sealed key, per-type
  scoreboard from the 10-18 scorecard (lynx 4+2 ties, onyx 1+2 ties,
  koda 0 merit wins), detectable-effect note (n=10 resolves tiers only),
  sequential stopping rule (min 6, futility-only drops, 2-DNF route pause,
  never stop the leader early).
- **Security grades + self-host breakeven** added to guide §15; global
  table filter input added to the guide header.
- Re-spliced live §1 + §8 tables from DB for 2026-10-18; both test suites green.

## 2026-10-19 — critical review, BFCL correction, dashboard generator
- **BFCL correction:** the guide claimed the Berkeley board was "void /
  stale (Apr 2026)". Wrong — V4 released 2026-04-12 (83 configs, agentic
  reweight, run-cost column, daily mirror). Verified 0 direct entries for
  our October-wave finalists; only previous-gen relatives (GLM-4.6 72.4%,
  Kimi K2 59.1%, DS V3.2 56.7%, Grok 4.x, Qwen3 family, GPT-5.x). Guide §13
  corrected; family signal favors GLM/Kimi, consistent with §16 eval.
- **Pin-reader bug (both scripts):** `readAgentModels` matched
  `{"model": ...}` examples inside `//` comment lines in opencode.jsonc,
  reporting comment decoys as the live pins (config showed spark-1.2 from
  a comment; real pins are spark-1.3 contributor-free ×2, both dead).
  Fixed by stripping full-line `//` comments before matching; locked with
  a comment-decoy fixture in `dashboard.test.mjs`.
- **New `scripts/dashboard.mjs`:** regenerates guide §1 + §8 tbodys from
  DB/log/pins/access snapshot (`--write-guide` with strict anchors).
  `dashboard-2026-10-18.json` committed. `dashboard.test.mjs` added;
  SKILL.md documents both suites.

## 2026-10-19 — guide restructure
- Reworked `model-selection-guide.html`: new §1 decision dashboard; merged
  §4+§5+§12 into one Free & cheap sourcing table; §5 Go plan + §6 Go
  workload ranking; §8 usage + §12 cost rebased on Oct-18 DB volumes
  (1,842 msgs/day, 86% cache-read); §9 recs Go-aware; section renumber.
- Removed in-page run-log (parser notes, launchd gaps, pin-application
  status) — that history lives here from now on.

## 2026-10-20 — space-bunny reveal, Go dashboard refresh with plan limits

- **Space Bunny = MiniMax M3.1 Flash confirmed** (MiniMax blog 10-19:
  early build, 200T+ tokens). `space-bunny-free` gone from both CLI
  catalogs 10-20, replaced by `minimax-m3.1-flash-free` (opencode +
  opencode-go, $0, 1M/512K ctx, release 2026-10-19, canonical
  `minimax/MiniMax-M3.1-Flash`).
- **Fresh AA pull** (`check minimax-m3-1-flash`, `check-2026-10-20.json`,
  19 models): M3.1 Flash Intel 43, **Eng 43 (rank 18)**, $0.15/$0.60,
  90% cache discount ($0.015), $0.22/task, 105 tps, 180M eval tokens.
  Bonus: DS V4.1 Flash 1017 build now Eng 45 (old build 38).
  18 older model rows carried from 10-18 (noted in snapshot `_note`).
- **Go plan limits wired in** (Zen `/docs/zen/` pricing 10-20 +
  per-model caps; `*` caps assumed from $15 tier — verify in Go
  console): `dashboard.mjs` GO map gained minimax-m3.1-flash
  (0.15/0.60/0.015, $30), space-bunny cache corrected 0.03 → 0.015,
  gemini-4-argon-contributor (2.00/10.00/0.10, $60, 50%-off thru Nov 30),
  gpt-5.6-luna, kimi-k2.7-code, qwen3.8-flash, qwen3.7-plus, minimax-m3.
  Still no Go prices: hy3/hy4-preview, longcat-2.0, mimo-v2.5/pro,
  glm-5.2. Guide §5/§6 carry per-model Go + Go Plus caps; §6 ranks M3.1
  Flash at Value 195 (#2, ~$4.8/loop-day, 6 days on $30 cap).
- **Privacy upgrades (Zen docs):** M3.1 Flash Free, GLM-5.3-Flash Free,
  DS V4.1 Flash Free, LongCat 2.5 Preview Free are zero-retention
  (moved to grade B); Beam Free no-train/30-day safety; Big Pickle +
  MiMo frees may train (grade D). New free shelf faces: LL Alpha Free,
  Exo Free, MiMo-V2.5 Free (docs-only, not in CLI 10-20).
- **Missing data / action needed:** reviewer + security-reviewer agent
  files still pin dead `opencode/space-bunny-free` (dashboard §1 flags
  ×2, plus ×5 dead spark-frees); re-pin to
  `opencode/minimax-m3.1-flash-free` + restart opencode (routing.json +
  guide §9 already flipped). `dashboard.test.mjs` fallback fixture
  updated to the rename; both suites green.
- First `access-2026-10-20.json` WITH opencode-go (29 models);
  `dashboard-2026-10-20.json`: 1,635 msgs, all
  opencode-go/muse-spark-1.3-contributor, 99% cache-read, no 429s.
- **§5 full sweep (13 slugs, `check` into `check-2026-10-20.json`,
  now 23 models):** Haiku 5.5 HAS a full AA page — Intel 43, Eng 44,
  234 tps (fastest in §5), 440M eval tokens (most verbose yet);
  Qwen3.8 Max gains Intel 45 (40 tps); Spark 1.2 page exists (Intel 40,
  355 tps). Step 5 Preview has Eng 45 ONLY — its AA model page carries
  no pricing/Intel/speed rows (partial:true on that pull). Speed
  refreshes: glm-flash 78, glm-5.3 86, spark-1.3 133, ds-flash 241,
  ds-pro 107, mimo-pro 50, kimi-k3 42. Watch: DS V4.1 Flash **1017
  build** scores separately (Intel 45 / Eng 45 / $0.26 / 207 tps) —
  our Go route's build is unconfirmed.
- **Argon contributor usage limits (§5 row added):** no published
  msg/req caps — derived equivalents at promo prices: ~2,520 req/5h
  (2× promo; ~1,260 base), ~3,150/wk, ~6,300/mo on console mix;
  ~1 loop-day per $60 cap (~$58/day) at our mix, ~120 msgs per 5h
  window. 1M ctx / 64K out, low/med/high effort. Zero Argon msgs in
  our DB (training-flagged, avoided).
- **Console ground truth 10-20 (user screenshot): 23 Argon reqs
  (192K in / 2.9M cached / 12K out) billed $1.60 = full-rate
  equivalent — the 2× counting cancels the 50% off.** Per-req mix is
  light (8K in / 126K cached / 0.5K out); burn ≈ $6.40/hr, so the $60
  cap ≈ 9 hrs of Argon, weekly $30 ≈ under 5 hrs. The +6pp weekly /
  +3pp monthly jumps confirm the $60 monthly cap (verify flag
  removed).   Guide §5/§6 + GO map reverted to full-rate economics
  ($4/$20/$0.20, ~$118/loop-day, ~630 req/5h).
- **SR cost visibility ships (2 layers, 10-21).** Shared formula module
  `scripts/sr-calc.mjs` (importable `calcSR` + CLI; single GROUP BY over
  30d, seconds on ~1GB DB). L1: `plugins/cost-tracker.js` (`.js` so
  `node --check` verifies it; event hook, 60s throttle, never throws,
  rising-edge toasts) → `~/.local/share/opencode/sr-live.json`;
  `/quota` leads with live SR + per-model runway (≤90s staleness).
  L2: `tools/cost-bar/` Swift NSStatusItem pill (`--self-test` green).
  `tools/helpers/` re-wraps the 4 bash/python LaunchAgents as branded owl
  .app bundles (spawn-and-wait launcher); Login Items names fixed.
  Skill docs: `usage-dashboard/SKILL.md` /quota section, new
  `tools/README.md`, `EXPERIENCE.md` §7.
- **Pareto + personality charts absorbed (10-21).** AA Intel-vs-$/task:
  Haiku-max (43/@$0.13) and DS-V4.1-Flash-1017-max (45/@$0.26) ON frontier,
  GLM-flash (42/@$0.27) near, Spark-max (48/@$1.6) dominated off-frontier,
  Argon-high holds the top end (~52/@$1.8), Sol-max (51/@$0.7) value king
  but NOT on Go catalog. Personality radar (eyeball, SUPERSEDED — see
  personality-tables entry below): GLM tops
  Expressiveness/Imagination/Warmth/Informativeness. Routing deltas:
  brainstorm primary flipped minimax → GLM-flash-free (personality fit);
  DS-V4.1-Flash-Go recorded as reviewer challenger pending §16 mini-eval
  (never pin unevaluated); security fallback corrected to
  spark-1.3-contributor Go (paid `muse-spark-1.3` not in catalog).
  Recorded in guide §9/§9b; `dashboard.mjs` ROUTES updated (tests green).
- **Correction (10-21): AA $/task positions are at STANDARD rates — our
  Spark loop pays CONTRIBUTOR rates.** Spark-max's "$1.6/task, dominated"
  reading was wrong for us: at $0.10/$0.20/$0.002 (≈5–8% of the
  $1.25/$4.25 standard card) the same task volume costs ~$0.10–0.15 —
  Intel 48 at Haiku money, i.e. ON our-plan frontier, best Intel-per-dollar
  available. Guide §9b corrected with the contributor-adjusted row + a
  reference-rates caveat (all other Go rates ≈ AA reference, so only Spark
  needed adjusting). Net effect: benchmark value now AGREES with observed
  $/msg runway — the training terms are the sole remaining cost of the
  Spark loop, which sharpens the main-model decision to a pure
  privacy-vs-everything tradeoff.
- **§9b charts rendered as real SVG + ladder added (10-21).**
  `scripts/charts_9b.py` was the source of truth (coordinates = eyeball
  transcription, marked ~approximate): Pareto scatter (log $/task, dotted
  frontier, blue = our routes, separate Spark-std vs Spark-contrib markers)
  and GLM-vs-Spark personality radar. §9c escalation ladder table: Spark
  default, six leave-triggers (Argon/GML-reviewer/Haiku/Nemotron/GLM-free/
  DS-watchlist/GLM-fallback). Guide tests green (--write-guide anchors
  unaffected: no tbody inside the SVGs).
- **§9b visuals reverted to tables (10-21, user call).** Both SVGs removed;
  `charts_9b.py` deleted; personality data kept as an 8-axis GLM-vs-Spark
  table with per-axis reads. Pareto table unchanged (already tabular).
- **Personality done properly (10-21): `personality` mode + full trait tables.**
  New `aa_bench.mjs personality` scrapes all 8 AA-PersonalityBench index
  leaderboards (values-then-names positional parser, top 10 per index,
  focus-model fuzzy match; fixtures + validation tests green).
  `personality-2026-10-21.json` saved; weekly pull gains a non-fatal
  personality step. AA's own trait heatmaps transcribed in full to guide
  §9b (14 models × 30 traits — the ONLY source covering our exact variants
  like GLM-5.3-Flash and Spark 1.3 max). Corrections vs the earlier eyeball
  reads: GLM-Flash Informativeness is mid (not top), Spark Transparency is
  NOT ~100, and GLM Slop is low (30/33, not ~65). New operational findings:
  Spark Slop 79 + Sycophantic 87 + Admits-Uncertainty 28; Argon Slop 68 +
  Sycophantic 81 + Admits-Uncertainty 4; Haiku Slop 9 (lowest) +
  Evidence-Based 87 (security-pin vindicated); DS Sycophantic 9
  (challenger strengthened); Nemotron Structured/Scannable 95 (researcher
  vindicated); MiniMax Imagination 17/14 (fallback-only confirmed).
  Conflict note: trait snapshots disagree with index top-10s on some Spark
  cells (likely AA snapshot timing) — nothing routed rests on disputed cells.
  Follow-up: combined Index column added to all 8 trait tables (— = outside
  top 10, sorter ranks it lowest) and every column made sortable via the
  guide's existing data-sort handler (one-off transform script, diff-reviewed,
  deleted; tests green).
  Follow-up 2: transparent Score column (mean of shown traits, Sycophantic/
  Slop inverted) so every model sorts with no gaps — e.g. Expressiveness
  GLM-Flash 86.2 vs Spark 63.6, Slop Haiku 91.0 vs Argon 32.0. Same one-off
  script pattern (diff-reviewed, deleted; tests green).
- **Full re-pin applied (10-21, user-approved).** reviewer →
  `opencode-go/glm-5.3-flash`, security-reviewer →
  `opencode-go/claude-haiku-5.5`, brainstorm/docs-writer/domain-companion →
  `opencode/glm-5.3-flash-free`, main+small →
  `opencode-go/muse-spark-1.3-contributor`; researcher unchanged.
  Fallbacks in agent bodies. `dashboard-2026-10-21.json`: `deadPins: []`,
  all six routes `primaryLive`. Restart opencode to load.
- **SR formula confirmed against console ground truth 10-20.**
  Overview "Today": $2.83 / 719 reqs / 171.1M tokens → 283 SR.
  Request-log CSV per-req means: spark ~$0.00070 (formula input
  $0.00069 DB / $0.00087 range), argon ~$0.08 (formula $0.0837 DB /
  $0.0696 range) — all within noise. Caveats: DB msgs ≠ console
  requests (turns vs API calls: 1,784 vs 719), windows differ, and
  argon $/req is heavy-tailed ($0.045–$0.37 over 27 rows), so the 716
  runway is a mean estimate — worst-case requests cost ~5× mean.
- **Standardized requests (`standardReq` in dashboard.mjs + snapshot):
  1 SR ≡ $0.01 model spend.** Per Go route: costPerMsg, allowedMsgs
  = cap/costPerMsg (runway in own-mix msgs), usedSR/allowedSR.
  Console range: 21,000 SR allowed (caps $210) / 678 used (3.2%) —
  runways: spark ~68.7k, argon ~862, glm-flash ~13.2k, bunny ~2.1k
  own-mix reqs. Note: console's 12% monthly uses the plan pool as
  denominator, not Σ sub-caps — different number, both true.

## 2026-10-18 — pulls, parser fix, throttle incident
- Fresh snapshots: `check` (18 slugs + sonnet-5-5), `coding` (CAI top-8 +
  full DeepSWE/T-Bench/QnA charts), `access`, weekly OR catalog + report.
- **Parser fix** (`aa_bench.mjs`): AA redesigned the coding page —
  hardcoded `14/15 of 15 models` anchor broke chart parsing (0 rows).
  Replaced with `/^\d+ of \d+ models$/` regex; added `Antigravity CLI` +
  `Mirror` harnesses. Test suite: added 2026-10-layout fixture; relaxed
  free-shelf count assertion (7 → `>= 1`). All green.
- playwright-core in monartha upgraded → rebuilt browser
  (`npx playwright-core install chromium-headless-shell`).
- Weekly launchd pull missed 10-05 and 10-12 (machine asleep at Mon 06:00);
  ran `weekly_pull.sh` by hand. Consider moving the schedule.
- **Throttle incident:** NVIDIA trial 429s on `z-ai/glm-5.3-flash` from
  21:36 UTC after the 18:00–21:00 burst (~287 msgs / ~50M tokens in 3h);
  opencode fell back to `nvidia/nemotron-3.5-super-vl` 22:02, succeeding.
- Free shelf churn: `muse-spark-1.x-contributor-free` + `ling-*-fin-free`
  removed from opencode shelf (dead pins in 3 agents + config model);
  NVIDIA catalog shrank 102 → ~56 (DS V4 Pro/Flash, Qwen, MiniMax,
  StepFun, Inkling, GPT-OSS-120B removed).
- User is on OpenCode Go ($10/mo); `opencode-go/*` already in use
  (glm-5.3-flash, spark-1.3-contributor, space-bunny).
- Mini-eval run on monartha corpus (28/30): space-bunny > glm-5.3-flash >
  nemotron-super-vl. Scorecard: `snapshots/evals/2026-10-18/scorecard.md`.

## 2026-10-21 — guide ported to Svelte shell + data.js
- `model-selection-guide.html` is now a generated shell; all 17 sections
  render from `data.js` (`window.__MB__`), composed by `scripts/guide_data.mjs`
  from `content/guide.json` + the newest dashboard/routing snapshots.
- §1/§8/§9 table rows are live; the other 14 sections are curated content.
  A data refresh is `dashboard.mjs` + `guide_data.mjs` — no rebuild.
- Svelte source lives in `app/` (deps vendored, gitignored): `npm run build`
  emits shell + assets; `npm run check` SSR-asserts 17 sections / 23 tables.
  `--write-guide` is kept only for the existing splice-safety tests.

## 2026-11-02 — AA index version drift (weekly pull)
- Coding Agent Index version differs from pinned v1.5.
- Action: re-run `coding` pull, refresh guide §2/§17 + SKILL agentic table.

## 2026-11-02 — weekly pull findings
- No AA coverage: opencode/glm-5.3-flash-free, opencode/nemotron-3.5-super-vl-free, opencode-go/glm-5.3-flash, opencode-go/claude-haiku-5.5, opencode-go/muse-spark-1.3-contributor

## 2026-11-13 — AA index version drift (weekly pull)
- Coding Agent Index version differs from pinned v1.5.
- Action: re-run `coding` pull, refresh guide §2/§17 + SKILL agentic table.

## 2026-11-13 — weekly pull findings
- No AA coverage: opencode/glm-5.3-flash-free, opencode/nemotron-3.5-super-vl-free, opencode-go/glm-5.3-flash, opencode-go/claude-haiku-5.5, opencode-go/muse-spark-1.3-contributor
