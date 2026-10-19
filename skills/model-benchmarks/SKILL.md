---
name: model-benchmarks
description: Use when choosing, reviewing, or refreshing LLM model choices for opencode agents, commands, or config — compares Artificial Analysis benchmarks (Engineering index, Intelligence index, cost per task, speed, token pricing) against the models in agent definitions. Triggers: model comparison, new model launch, "which model should this agent use", benchmark cross-check, value-per-dollar analysis, pricing refresh.
---

# Model Benchmarks

Cross-check the models pinned in agent definitions against current
Artificial Analysis (AA) benchmark data, scraped live with playwright.
Source of truth for extraction is `scripts/aa_bench.mjs` — one browser
session pulls everything, so a refresh is a single command.

## Files

- `<skill dir>/scripts/aa_bench.mjs` — stdlib + playwright-core only.
  `check <slug>...` fetches homepage Highlights (Intelligence / Speed /
  Cost-per-Task), the Engineering capability-index table, per-slug pricing,
  and cross-checks `agent/*.md` + `opencode.jsonc` model pins.
  `coding` pulls the Coding Agent Index page: composite top-10, cost and
  time per task, plus per-benchmark charts (DeepSWE v1.1, Terminal-Bench
  4.0, SWE-Atlas-QnA) with harness-qualified entries
  (e.g. `Opencode GLM-5.3`, `Codex DeepSeek V4 Pro 0813 (max)`).
  `inventory [provider...]` (default: opencode nvidia ollama) dumps
  `opencode models <provider>` via `$OPENCODE_BIN`, else `which opencode`,
  else `~/.opencode/bin/opencode`.
- `<skill dir>/scripts/aa_bench.test.mjs` + `dashboard.test.mjs` —
  no-network/no-browser tests: parser fixtures (incl. the `11.7m`-as-name
  regression, the SWE-2 fold, and the 2026-10 "N of M models" chart
  layout), CLI exit codes, a playwright-free `inventory` run, and
  dashboard fixtures (comment-line pin decoys, 429 filtering, splice
  safety). Run both before commit; all green before commit.
- `<skill dir>/scripts/dashboard.mjs` — regenerates the guide's LIVE
  sections from ground truth (DB usage, log 429s, agent pins, newest
  access snapshot): `node scripts/dashboard.mjs [--date YYYY-MM-DD]
  --out snapshots/dashboard-$DATE.json [--html FILE]
  [--write-guide model-selection-guide.html]`. Stdlib + `sqlite3` CLI
  only. Splices the §1 dashboard + §8 usage tbodys (strict anchors,
  aborts on ambiguity). Emits per-route reliability (msgs, fail %,
  median turn latency, actual $), dead-pin + AA-coverage drift,
  Go pacing (days to weekly sub-cap), metered-vs-projected Go spend,
  and `snapshots/routing-YYYY-MM-DD.json` (machine-readable
  primary/fallback pins per agent for wrappers to consume).
  Run it on every refresh — never hand-edit those two tables (they carry
  a `generated` marker comment).
- `<skill dir>/snapshots/` — dated ground truth: `access-YYYY-MM-DD.json`
  (full provider catalogs), `coding-index-YYYY-MM-DD.json` (raw agentic
  scrape), `agentic-table-YYYY-MM-DD.md` (curated table + footnotes),
  `free-deals-YYYY-MM-DD.md` (free top-tier by provider + cheap deals +
  agent mapping). Snapshots rot — check the date, refresh if stale, and
  update the embedded tables below when you do.

## Refresh benchmarks

```bash
D=~/.config/opencode/skills/model-benchmarks/scripts
node $D/aa_bench.mjs check \
  deepseek-v4-pro deepseek-v4-1-flash deepseek-v4-flash glm-5-3-flash glm-5-3 \
  gemini-3-8-flash gemini-3-5-flash-lite claude-sonnet-5 kimi-k3 grok-4-6 muse-spark-1-3 \
  claude-opus-5-5 gemini-4-argon muse-wonder gpt-6-1-sol grok-4-7 mimo-v2-6-pro gpt-6-luna claude-sonnet-5-5 \
  --out /tmp/aa_bench.json
node $D/aa_bench.mjs coding --out /tmp/aa_coding.json
# provider catalogs (save dated snapshots, not /tmp)
S=~/.config/opencode/skills/model-benchmarks/snapshots
T=$(date +%F)
node $D/aa_bench.mjs inventory --out $S/access-$T.json
node $D/aa_bench.mjs coding --out $S/coding-index-$T.json
```

Notes:

- Scraper needs playwright-core. Run from a dir that has it (e.g.
  `~/PycharmProjects/monartha`) or set `PW_CORE=/path/to/playwright-core/index.mjs`.
- `--config DIR` overrides the opencode config dir (default
  `~/.config/opencode`); reads `agent/*.md` (`agents/` too) `^model:` lines
  plus `"model"` / `"small_model"` from opencode.json(c).
- `check` is ~1 + N page loads, ~2-6 min depending on slug count;
  `coding` is 1 page + 3 tab clicks, ~2-3 min. No `--out` prints JSON to
  stdout. Sites occasionally block scrapers; on failure, retry once,
  then fall back to websearch excerpts.
- After any pull, update the dated snapshots, the guide's tables, and log
  operational notes (parser fixes, missed pulls, incidents) in
  `snapshots/CHANGELOG.md` — run-log does not belong in the guide.
- AA slugs: lowercase, dots become dashes
  (`DeepSeek V4.1 Flash (max)` → `deepseek-v4-1-flash`). Effort variants in
  parentheses are part of the display name only — the slug has no suffix.
  Dedup slugs with effort words stripped (one slug per family).

## Schedule (weekly pull + report)

- `scripts/weekly_pull.sh` — unattended full refresh: OR catalog snapshot,
  value report with deltas, provider `inventory`, dashboard regen + guide
  splice, AA index version check (`aa_version.mjs` vs
  `snapshots/aa-index-version.txt`), both test suites, and CHANGELOG
  appends on findings (dead pins, AA-coverage gaps, version drift).
  Idempotent: exits early when the newest catalog is < 7 days old, so it
  is safe on a login-time (RunAtLoad) catch-up as well as the Monday
  schedule, and safe to re-run by hand. Tested end-to-end in a fake-HOME
  sandbox (see CHANGELOG 2026-10-18).
- launchd `~/Library/LaunchAgents/ai.opencode.model-benchmarks.plist` —
  Mondays 06:00 local plus RunAtLoad catch-up (fires at login/boot when a
  Monday was missed; the script's 7-day staleness guard makes catch-up
  runs near-instant when there is nothing to do). Logs to
  `snapshots/reports/weekly.log`.
  Verify: `launchctl print gui/501/ai.opencode.model-benchmarks`.
  Reports land in `snapshots/reports/YYYY-MM-DD-value.md`.
- `scripts/or_catalog.mjs [--out FILE]` — standalone OR catalog pull
  (public API via playwright, no key).
- `scripts/weekly_report.mjs --catalog FILE [--prev FILE] [--coding FILE]
  [--out FILE]` — deterministic join of OR prices with the curated
  `AA_BENCH` map (Tier 1 benchmarked value / Tier 2 fliers / free routes
  + deltas). Refresh `AA_BENCH` from the skill snapshots + guide whenever
  AA publishes new numbers; family matching is substring rules
  (`FAMILY_RULES`, specific-first).
- AA benchmark pulls (`check` / `coding`), the BFCL cross-check (§13 of
  the guide), and this skill's embedded tables stay manual — refresh those
  snapshots and the guide tables on the same cadence when models launch.

## Version-watch policy (drift control)

Re-pull on ANY of: AA publishes a new Coding Agent Index version, a new
model wave lands on the benchmark pages, or 30 days since the last pull —
whichever comes first. Between pulls, `dashboard.mjs` surfaces drift for
free from local ground truth: dead agent pins (model IDs gone from the
newest access snapshot), check pins with `aa_slug: null` (no AA coverage),
snapshot ages vs today, and Go spend pacing vs caps. Re-verify Go console
monthly limits on the same cadence (promos change them).
Run-log lives in `snapshots/CHANGELOG.md`, never in the guide.

## Mini-eval runs (guide §16 protocol, hardened 2026-10-19)

Corpus: 10 frozen diffs covering bugfix / security / feature / dep-bump /
test-only / ops / refactor. Judge MUST be pinned (model id + version +
date in the scorecard); key stays sealed until scoring is done; disclose
deviations. Minimum 6 diffs before any stop; drop only on mathematical
futility; pause (don't score) on 2 consecutive provider DNFs and re-run on
a fallback route; never stop the leader early. With n=10 only tier gaps
resolve — report per-type wins, not just the net score.
- Other scoring sites (LMArena, Aider polyglot, SWE-bench, Vellum) are
  documented in the guide (§11) for hand cross-checks; only the Aider YAML
  (`aider/website/_data/polyglot_leaderboard.yml`) is pull-friendly today.

## Access snapshot (2026-10-18)

From `snapshots/access-2026-10-18.json`: opencode 10 free, nvidia ~56,
ollama 1. Agent-relevant subset (full lists in the snapshot):

- **opencode** (free shelf, limited-time + data-use terms):
  `beam-free`, `big-pickle`, `deepseek-v4.1-flash-free`,
  `glm-5.3-flash-free`, `longcat-2.5-preview-free`,
  `mimo-v2.6-flash-free`, `nemotron-3-ultra-free`,
  `nemotron-3.5-lightning-free`, `nemotron-3.5-super-vl-free`,
  `space-bunny-free` (muse-spark contributor + ling-fin REMOVED 10-18 —
  pins to those IDs are dead)
- **nvidia** (~56, trial credits; catalog shrank from 102 — DS V4 Pro/Flash,
  Qwen coder/3.5, MiniMax, StepFun, Inkling, GPT-OSS-120B removed):
  `deepseek-ai/deepseek-v4.1-flash`; `google/gemma-4-31b-it`;
  `moonshotai/kimi-k3`; `z-ai/glm-5.3`, `z-ai/glm-5.3-flash`;
  `nvidia/nemotron-3-ultra-550b-a55b`, `nemotron-3.5-lightning-30b-a3b`,
  `nemotron-3.5-super-vl-120b-a12b`; `openai/gpt-oss-20b`;
  `meta/muse-glimmer-30b`; `poolside/laguna-xs-2.1`
- **ollama** (local, free): `qwen3.8:latest`
- Not in CLI (separate methods): Zen paid shelf (billing + key, see
  `/docs/zen/` pricing), OpenRouter `:free` (playwright-fetch
  `/api/v1/models`, keep price-0 AND `tools` support), Groq free tier
  (no card, thin limits). Cerebras: NO permanent free tier — exclude.

## Agentic coding benchmarks (2026-10-18)

From `snapshots/coding-index-2026-10-18.json` (parser re-fixed for the
AA redesign — see CHANGELOG). Coding Agent Index v1.5, composite =
DeepSWE + Terminal-Bench 4.0 + SWE-Atlas-QnA. Scores are **model×harness**.

| Setup | Index | DeepSWE | T-Bench | QnA | $/task | time |
|---|---|---|---|---|---|---|
| Claude Code Sonnet 5.5 max | 68 | 72 | 66 | 67 | $14.19 | 1.5h |
| Claude Code Opus 5.5 max | 66 | 68 | 63 | 66 | $13.04 | 1.1h |
| Antigravity Gemini 4 Argon | 64 | 79 | 56 | 56 | $5.84 | 34.5m |
| Muse Code Muse Wonder max | 63 | 76 | 47 | 67 | $8.05 | 22.4m |
| Claude Code Fable 5.1 max | 62 | 64 | 58 | 65 | $12.39 | 34.8m |
| Codex GPT-6 Astra max | 62 | 68 | 56 | 62 | $7.47 | 29.4m |
| Codex GPT-6.1 Sol max | 60 | 70 | 53 | 58 | $1.55 | 24.4m |
| Grok Build Grok 4.7 xhigh | 56 | 73 | 33 | 63 | $8.82 | 39.2m |

Below the top-8 cutoff (fresh 10-18 component charts): Opencode GLM-5.3
(61/40/59), Kimi Code CLI Kimi K3 (68/21/66), Muse Code Muse Spark Open
(60/6/58), Claude Code Haiku 5.5 (46/30/34), Mirror Beam 1.0 (40/4/40).
Stale 09-16 composites (off current charts, not re-measured): Spark 1.3 54,
Gemini 3.8F 42, DS Pro 0813 43, DS Flash ~39*. Role map: DeepSWE ≈
reviewer, T-Bench ≈ researcher, QnA ≈ technical QA. Missing agentic data:
V4.1 Flash, GLM-5.3-Flash, Nemotron 3 Ultra/Super VL, Gemma 4, Sonnet 5,
Qwen3.5 Plus, MiniMax M3, GPT-6 Luna, Step 5, Qwen3.8 family.

## Free top-tier by provider + good deals (2026-10-18)

From `snapshots/reports/2026-10-18-value.md`. Free tiers change fastest of
all — re-verify no-card/no-expiry claims every sweep.

Free: opencode `space-bunny-free` (§17 winner), `glm-5.3-flash-free`
(Intel 42/Eng 43), `nemotron-3.5-super-vl-free` (Eng 28),
`nemotron-3-ultra-free` (Intel ~48), `deepseek-v4.1-flash-free`,
`beam-free`, `mimo-v2.6-flash-free`; NVIDIA trial (`deepseek-v4.1-flash`,
`kimi-k3`, `glm-5.3`+flash, `gemma-4-31b`, nemotron trio, `gpt-oss-20b`
— DS V4 Pro/Flash REMOVED 10-18); OpenRouter `:free` (nemotrons +
`gemma-4-31b` Intel 39.2 + `inkling-small` Eng 29; require `tools`
support); Z.ai direct `GLM-4.7-Flash` (permanent $0, ~1 req/s);
Groq (`gpt-oss-120b`, ~8K TPM); Google AI Studio (trains); GitHub Models
(150 RPD); Ollama local. Excluded: Cerebras, Hugging Face.

Deals (Oct-18 OR): DS V4 Flash 0731 $0.007/$0.45 (retiring); GLM-5.3-Flash
$0.048/$0.20 (3× below FP); DS V4.1 Flash $0.061/$0.144; Luna $0.10/$0.50
(price cut); Haiku 5.5 $0.10/$0.50 (DS 46/TB 30); Spark contributor
$0.10/$0.20 (trains Meta); paid Spark 1.3 $1.25/$4.25 (zero-retention);
Z.ai Coding Plan ~$18/mo. Go plan caps our loop: GLM-flash $60/mo
(review loop ≈ $5.9/day), DS V4.1 $80/mo, Spark contrib $60/mo.

## Reading the output

- `highlights.intelligence / .speed_tps / .cost_per_task` — keyed by AA
  display name. These are **global leaders**, NOT filtered to your slugs.
  Cost per Task = weighted-average USD per Intelligence Index task (lower
  is better). Speed = output tok/s on the reference endpoint.
- `engineering[]` — top ~28 rows as observed 2026-10-18
  `{rank, name, engineering}`. Higher is better. Incorporates
  AA-Omniscience, HLE, CritPt, GDPval-AA v2, AA-Briefcase, Terminal-Bench
  v4.0. Models below the cutoff are off-chart: report as "no Engineering
  data", never as zero. `rank` is position in the scraped table.
- `models[]` — per slug: `input/output` ($/1M tokens, first-party),
  `cache_read` (derived from AA's rounded discount — verify before
  budgeting), `speed_tps`, `intelligence` (page-summary score — covers
  models outside the homepage top-11; `display_name` carries the served
  effort config, e.g. max/high), `eval_total_cost` ("cost $X to evaluate" the full
  Intelligence Index — useful cost proxy when per-task is missing; ratio it
  against a model that has both).
- `check` cross-checks `agent/*.md` (`agents/` too) plus `"model"` /
  `"small_model"` from `opencode.json(c)` — each pin mapped to `aa_slug`,
  `aa_match`, `engineering`. `aa_slug: null` means no fetched slug matched:
  check the mapping (provider prefixes like `nvidia/`, `-free` suffixes,
  and `-NNNN` date pins like `-0813` are stripped automatically; anything
  else needs a manual alias or its own slug fetch).
- `coding` output — `index` / `cost_per_task` / `time_per_task` keyed by
  harness-qualified display name (top-10 highlights); `benchmarks` holds
  the three component charts as `{entry, value}` rows (entry =
  `"<Harness> <Model> (<effort>)"`, value = pass@1 %). A trailing
  `SWE-2 (medium)` is folded into the Devin row above. Scores are
  model×harness — see checklist step 3.
- `inventory` output — `{scraped_at, bin, providers: {<name>: [<model-id>]
  | {error}}}`. Curated extras (Zen paid shelf, OR `:free`, Groq) are NOT
  in CLI output — use their documented methods and record results in the
  snapshot's place (or the Access section above).

## Review checklist (apply critically, not mechanically)

1. **Coverage first:** every agent-pinned model must resolve to an AA entry.
   Unmatched = unreviewed. The benchmarked variant is usually `(max)` effort —
   agents served a default-effort variant will score lower in practice.
2. **Dominance:** flag any pinned model strictly beaten on Engineering,
   Intelligence, $/task, speed, AND $/1M by one alternative — that's a free
   switch (modulo provider availability).
3. **Role fit:** reviewer/researcher/security-reviewer are engineering-heavy
   (weight Engineering + speed for 15-25-step loops); docs-writer /
   domain-companion are latency/price-heavy (Engineering barely matters).
   For agentic coding roles, the Coding Agent Index outranks everything:
   DeepSWE v1.1 ≈ reviewer work (real SWE tasks), Terminal-Bench 4.0 ≈
   researcher work (agentic terminal use), SWE-Atlas-QnA ≈ technical QA.
   **Harness confound:** every coding-agent score is model×harness
   (`Opencode GLM-5.3` vs `Codex DeepSeek V4 Pro 0813`) — a score earned
   on another harness only approximately transfers to opencode agents.
4. **Endpoint caveat:** AA benchmarks reference/first-party endpoints.
   Agents run via opencode providers (nvidia, ollama, etc.) — snapshot,
   effort, quantization, and price all differ. Verify with `opencode models`
   (or the provider's model list) that a recommended slug is actually
   served, with tool-call support, before editing agent files.
5. **Volume math:** reviewer/researcher run constantly — $/task dominates.
   security-reviewer runs rarely — quality dominates. Say which axis decided.
6. After changing any agent `model:`, remind the user to quit and restart
   opencode (config is loaded once at startup).

## Free-tier sweep (expanding options at $0)

Free endpoints change fast — re-verify each sweep, never trust memory:

- `opencode models <provider>` lists the local catalog (needs no key for
  the free shelf). Zen/Go free shelf (all limited-time, all train on or
  log your data — see Privacy section of `/docs/zen/`): `beam-free`,
  `big-pickle`, `deepseek-v4.1-flash-free`, `glm-5.3-flash-free`,
  `longcat-2.5-preview-free`, `mimo-v2.6-flash-free`,
  `nemotron-3-ultra-free`, `nemotron-3.5-lightning-free`,
  `nemotron-3.5-super-vl-free`, `space-bunny-free`. Per-model daily caps
  (~200/day observed on glm-5.3-flash 10-18) — volume loops need Go or
  trial/direct keys.
- `opencode-go/*` routes (Go $10/mo) carry monthly dollar caps per model
  (GLM-5.3-Flash $60, DS V4.1 Flash $80, Spark contributor $60); measure
  the loop's $/day from the DB before pinning a loop on one.
- NVIDIA provider exposes floating AND pinned snapshots separately —
  but the trial catalog shrank 10-18 (DS V4 Pro/Flash, Qwen, MiniMax,
  StepFun, Inkling, GPT-OSS-120B removed): always re-list with
  `inventory` and prefer pinned IDs; build.nvidia.com access is
  trial-credit based and throttles hard (~429s observed 10-18).
- OpenRouter `:free` set: in a playwright page on openrouter.ai, run
  `fetch('/api/v1/models')`, keep `pricing.prompt == 0 &&
  pricing.completion == 0`, and require `supported_parameters` to include
  `tools` — tool-less endpoints (e.g. `z-ai/glm-5.2:free`, 32K ctx) are
  dead for agents. OR free = rate-limited, routed, variable ZDR.
- Groq free tier is ongoing/no-card but thin (e.g. ~8K TPM) — low-volume
  agents only. Cerebras has NO permanent free tier ($5/30-day trial +
  card required) — exclude from free sweeps.
- Privacy gate for proprietary code: contributor/trial/free models
  (Spark contributor, Big Pickle, MiMo/Ling free, Nemotron trial,
  OR free, Space Bunny) train on or log prompts. Keep reviewer/researcher
  diffs on zero-retention endpoints (Go GLM family, paid Spark,
  Groq+ZDR, Z.ai API); free models are for trials and low-stakes
  agents (docs-writer, domain-companion) unless the user accepts the terms.
