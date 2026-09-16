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
- `<skill dir>/scripts/aa_bench.test.mjs` — no-network/no-browser tests:
  parser fixtures (incl. the `11.7m`-as-name regression and the SWE-2
  fold), CLI exit codes, and a playwright-free `inventory` run. Run with
  `node <skill dir>/scripts/aa_bench.test.mjs`; all green before commit.
- `<skill dir>/snapshots/` — dated ground truth: `access-YYYY-MM-DD.json`
  (full provider catalogs), `coding-index-YYYY-MM-DD.json` (raw agentic
  scrape), `agentic-table-YYYY-MM-DD.md` (curated table + footnotes).
  Snapshots rot — check the date, refresh if stale, and update the
  embedded tables below when you do.

## Refresh benchmarks

```bash
D=~/.config/opencode/skills/model-benchmarks/scripts
node $D/aa_bench.mjs check deepseek-v4-pro deepseek-v4-1-flash deepseek-v4-flash \
  glm-5-3-flash glm-5-3 gemini-3-8-flash gemini-3-5-flash-lite \
  claude-sonnet-5 kimi-k3 grok-4-6 muse-spark-1-3 \
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
- `check` is ~1 + N page loads (~12 for the example command), ~2-4 min;
  `coding` is 1 page + 3 tab clicks, ~2-3 min. No `--out` prints JSON to
  stdout. Sites occasionally block scrapers; on failure, retry once,
  then fall back to websearch excerpts.
- AA slugs: lowercase, dots become dashes
  (`DeepSeek V4.1 Flash (max)` → `deepseek-v4-1-flash`). Effort variants in
  parentheses are part of the display name only — the slug has no suffix.
  Dedup slugs with effort words stripped (one slug per family).

## Access snapshot (2026-09-16)

From `snapshots/access-2026-09-16.json`: opencode 7 models, nvidia 102,
ollama 1. Agent-relevant subset (full lists in the snapshot):

- **opencode** (free shelf, all limited-time + data-use terms, see
  Free-tier sweep): `big-pickle`, `ling-3.0-flash-fin-free`,
  `mimo-v2.5-free`, `muse-spark-1.2-contributor-free`,
  `muse-spark-1.3-contributor-free`, `nemotron-3-ultra-free`,
  `nemotron-3.5-lightning-free`
- **nvidia** (trial credits via build.nvidia.com key): floating AND pinned
  snapshots — `deepseek-ai/deepseek-v4-pro` + `deepseek-v4-pro-0813`,
  `deepseek-v4-flash` + `deepseek-v4-flash-0731`; `qwen/qwen3-coder-480b-a35b-instruct`,
  `qwen3.5-122b-a10b`, `qwen3.5-397b-a17b`, `qwen2.5-coder-32b-instruct`;
  `minimaxai/minimax-m2.7`, `minimax-m3`; `moonshotai/kimi-k3`;
  `nvidia/nemotron-3-super-120b-a12b`, `nemotron-3-ultra-550b-a55b`,
  `nemotron-3.5-lightning-30b-a3b`; `openai/gpt-oss-120b`, `gpt-oss-20b`;
  `mistralai/mistral-large-3-675b-instruct-2512`;
  `stepfun-ai/step-3.5-flash`, `step-3.7-flash`;
  `thinkingmachines/inkling`; `meta/muse-glimmer-30b`
- **ollama** (local, free): `qwen3.8:latest`
- Not in CLI (separate methods): Zen paid shelf (billing + key, see
  `/docs/zen/` pricing), OpenRouter `:free` (playwright-fetch
  `/api/v1/models`, keep price-0 AND `tools` support), Groq free tier
  (no card, thin limits). Cerebras: NO permanent free tier — exclude.

## Agentic coding benchmarks (2026-09-16)

From `snapshots/agentic-table-2026-09-16.md` (raw:
`coding-index-2026-09-16.json`). Coding Agent Index v1.5, composite =
DeepSWE + Terminal-Bench 4.0 + SWE-Atlas-QnA. Scores are **model×harness**.

| Setup | Index | DeepSWE | T-Bench | QnA | $/task | time |
|---|---|---|---|---|---|---|
| Claude Code Fable 5.1 max | 62 | 64 | 58 | 65 | $12.40 | 34.8m |
| Codex GPT-6 Astra max | 62 | 68 | 56 | 62 | $7.47 | 29.4m |
| Claude Code Opus 5 max | 60 | 63 | 55 | 62 | $10.80 | 41.9m |
| Muse Code Spark 1.3 max | 54 | 72 | 32 | 59 | $3.98 | 18.4m |
| Opencode GLM-5.3 | 54 | 61 | 40 | 59 | $4.24 | 48.1m |
| Kimi K3 | 52 | 68 | 21 | 66 | $5.05 | 1.0h |
| Grok 4.6 xhigh | 47 | 65 | 18 | 58 | $3.57 | 19.5m |
| Qwen3.8 Max | 43 | 51 | 17 | 62 | $3.48 | 1.1h |
| Codex DS Pro 0813 max | 43 | 57 | 10 | 62 | $0.24 | 40.3m |
| Antigravity Gemini 3.8F high | 42 | 66 | 15 | 45 | $2.47 | 11.7m |
| Codex DS Flash 0731 max | ~39* | 54 | 11 | 51 | — | — |
| Codex GPT-5.6 Sol max | — | 72 | 37 | 54 | — | — |

`*` DS Flash composite ~39 inferred from chart rank order (value in
footnote only — never present it as measured). Missing entirely (no
agentic data): V4.1 Flash, GLM-5.3-Flash, Nemotron 3 Ultra/Super, Gemma 4,
Sonnet 5, GPT-5.6 Luna, Qwen3.5 Plus, MiniMax M3, Kimi K2.7. Role map:
DeepSWE ≈ reviewer, T-Bench ≈ researcher, QnA ≈ technical QA.

## Reading the output

- `highlights.intelligence / .speed_tps / .cost_per_task` — keyed by AA
  display name. These are **global leaders**, NOT filtered to your slugs.
  Cost per Task = weighted-average USD per Intelligence Index task (lower
  is better). Speed = output tok/s on the reference endpoint.
- `engineering[]` — top ~26 rows as observed 2026-09-16
  `{rank, name, engineering}`. Higher is better. Incorporates
  AA-Omniscience, HLE, CritPt, GDPval-AA v2, AA-Briefcase, Terminal-Bench
  v4.0. Models below the cutoff are off-chart: report as "no Engineering
  data", never as zero. `rank` is position in the scraped table.
- `models[]` — per slug: `input/output` ($/1M tokens, first-party),
  `cache_read` (derived from AA's rounded discount — verify before
  budgeting), `speed_tps`, `eval_total_cost` ("cost $X to evaluate" the full
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
  the free shelf). Zen free shelf (all limited-time, all train on or log
  your data — see Privacy section of `/docs/zen/`): `big-pickle`,
  `mimo-v2.5-free`, `ling-3.0-flash-fin-free`, `nemotron-3-ultra-free`,
  `nemotron-3.5-lightning-free`, `muse-spark-*-contributor-free`.
- Zen pricing page (`/docs/zen/` Pricing table) is the authority for paid
  cheap shelf (e.g. DeepSeek V4 Flash $0.14/$0.28 — far below first-party).
- NVIDIA provider exposes floating AND pinned snapshots separately
  (`deepseek-v4-pro` vs `deepseek-v4-pro-0813` — Eng 37 vs 32). Always
  prefer the pinned ID; build.nvidia.com access is trial-credit based.
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
  OR free) train on or log prompts. Keep reviewer/researcher diffs on
  zero-retention endpoints; free models are for trials and low-stakes
  agents (docs-writer, domain-companion) unless the user accepts the terms.
