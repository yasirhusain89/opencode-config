# model-benchmarks — changelog (run-log lives here, not in the guide)

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
