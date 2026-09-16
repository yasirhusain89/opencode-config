---
name: usage-dashboard
description: Use when regenerating or extending the opencode usage dashboard (~/.opencode/usage-dashboard/), when new model launches/updates need fresh pricing, or when the user asks about usage cost comparisons. Examples "regenerate the dashboard", "update model pricing", "new model launched, add it".
---

# Usage Dashboard

Svelte-rendered dashboard of opencode usage, priced on multiple models.
Data and presentation are split:

- `generate.py` computes everything and emits **JSON data only**
  (`data.js` + `sessions/*.js`, as `window.__OCUD__` / `window.__OCUD_SESSION__`
  globals so pages work from `file://` with no fetch). Never generate HTML here.
- `app/src/` holds the **Svelte templates** (`Index`, `Session`, shared
  formatting in `lib/format.js`, improvement-tip rules in `lib/tips.js`).
  Build with `npm run build` in `app/`; verify with `npm run check`
  (SSR-renders both pages against the real generated data).

## Files

- `<skill dir>/generate.py` — stdlib-only generator (must stay
  python3.9-compatible: no f-strings with nested same-type quotes, use `%` or
  concat). Canonical copy lives here; `~/.opencode/usage-dashboard/generate.py`
  is a thin launcher shim so the old path + launchd keep working.
- `<skill dir>/app/` — Svelte sources + `package.json` (`svelte`, `esbuild`
  vendored under `app/node_modules`, git-ignored but required for rebuilds).
  `app/src/shells/` are the static page shells; `app/build.mjs` compiles +
  bundles to the output dir; `app/check.mjs` is the render smoke test.
- `~/.opencode/usage-dashboard/dashboard.html` + `session.html` — static
  shells (from `app/src/shells/`). Do not hand-edit; rebuild templates.
- `~/.opencode/usage-dashboard/assets/app.js|app.css` — compiled bundle.
  Do not hand-edit; rebuild templates.
- `~/.opencode/usage-dashboard/data.js` + `sessions/*.js` — generated data.
  Do not hand-edit; regenerate.
- `~/.opencode/usage-dashboard/history.jsonl` — daily snapshots (365 kept).
- `~/Library/LaunchAgents/ai.opencode.usage-dashboard.plist` — launchd, daily 08:00 + RunAtLoad.
- Source DB (read-only): `~/.local/share/opencode/opencode.db`. Tables: `session`
  (tokens/cost columns), `message` (JSON data: providerID, modelID, variant, tokens,
  time.created/completed in **ms**), `part` (tool calls, state.status,
  state.time.start/end in **ms** for the per-session tool-time split).
  Git commit timestamps are **seconds** — convert ms/s when joining (see `landed()`).

## Regenerate (data only; daily path)

```bash
python3 ~/.config/opencode/skills/usage-dashboard/generate.py
open ~/.opencode/usage-dashboard/dashboard.html
```

Verify under both pythons if generate.py changed:
`/opt/homebrew/bin/python3` and `/usr/bin/python3` (user id 501, launchctl gui/501).

## Change templates (layout, metrics display, tip rules)

```bash
cd ~/.config/opencode/skills/usage-dashboard/app
# edit src/*.svelte / src/lib/*.js, then:
npm run build    # must finish warning-free
npm run check    # SSR render test vs real data; must print check OK
```

Then regenerate data (above) and open both `dashboard.html` and a
`session.html#<id8>` page. Session subpages prune themselves: generate.py
rewrites `sessions/` to the current top 20 and deletes stale files.
Per-session tool-time bar: share of active tool-call time per category
(`state.time.start/end`), `sleep`-first bash counted as `Wait/idle`.

## Refresh model pricing (new launches / updates)

Pricing lives in `TOP_MODELS` / `COMPARE_MODELS` at the top of generate.py.
To refresh after a model launch or price change:

```bash
D=~/.config/opencode/skills/usage-dashboard/scripts
# 1. Top-20 leaderboard (intelligence index + cost/task) from artificialanalysis.ai
node $D/aa_model_info.mjs top20 --out /tmp/top20.json
# 2. Per-model token pricing for the base models you care about (dedup variants:
#    one slug per family, e.g. claude-fable-5-1 not ...-5-1-xhigh)
node $D/aa_model_info.mjs models claude-fable-5-1 gpt-6-astra claude-opus-5 \
     muse-spark-1-3 glm-5-3 glm-5-3-flash grok-4-6 kimi-k3 gpt-5-6-sol qwen3-8-max \
     --from /tmp/top20.json --out /tmp/models.json
# 3. Print a ready-to-paste Python literal
python3 $D/aa_snippet.py /tmp/models.json /tmp/top20.json
```

Paste the printed `TOP_MODELS = [...]` into generate.py (keep the existing
`IN_USE` mapping — it ties the models actually used in opencode to their paid
equivalents). Then regenerate.

Notes:

- Scraper needs playwright-core. Run from a dir that has it (e.g.
  `~/PycharmProjects/monartha`) or set `PW_CORE=/path/to/playwright-core/index.mjs`.
- `cache_read` is derived from AA's rounded cache discount; override wrong values
  in the `OVERRIDES` dict at the top of `aa_snippet.py` (keyed by slug).
- `cache_write` is rarely published — stays null; generate.py's cost function
  must tolerate None cache-write.
- Sites occasionally block scrapers; if a fetch fails, fall back to search
  excerpts (DuckDuckGo html endpoint works; Google blocks).
- AA slugs: spaces and dots become dashes, drop effort suffixes:
  `Claude Fable 5.1 (max ...)` → `claude-fable-5-1`, `GLM-5.3-Flash` → `glm-5-3-flash`.

## Conventions

- Reasoning tokens are billed as output everywhere.
- Signed amounts: expenses negative, income positive (MonArtha repo convention,
  unrelated but adjacent — don't sweep its files into commits).
- Dashboard is offline: no CDN, no fetch at runtime (data arrives via
  `<script src>` globals so `file://` works); all pricing baked in at
  generation time. Theme toggle persists via localStorage key `ocud-theme`.
