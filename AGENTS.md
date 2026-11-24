## Operating constitution

- Ground every claim in files you actually read: cite `file:line`, never state APIs or behavior from memory.
- Keep diffs surgical: no reformatting, no stylistic churn, no out-of-scope refactors.
- Plan before multi-file edits: for changes spanning >2 files, schema migrations, or public API changes, present a short plan and wait for confirmation.
- Verify before declaring done: run the relevant build, tests, or linters and report the result.
- Before changing model pins, plugins, eval protocol, or retrieval: check EXPERIENCE.md for prior incidents.
- Prefer editing existing files over creating new ones; never create docs unless asked.
- Keep the machine alive: one foreground check per bash call — `sleep` ≤120s,
  waits return within 5min (re-check next turn), never `watch`/`tail -f`,
  never detach (`nohup`/`setsid`/trailing `&`, `caffeinate`) except
  dev-server sessions with `OPENCODE_ALLOW_BG=1`, never launch GUI apps/URLs
  (`open` of files and `open -R` are fine). `plugins/exec-guard.ts` enforces
  this; bypass only per-session via its env overrides, and kill anything you
  detach.
- Locate code with native Grep/glob and GitNexus graph tools (`query`, `context`, `trace` via `execute` → `search("gitnexus")`); for meaning-based or unknown-vocabulary search in ANY project, run `uv run --with sqlite-vec python ~/.config/opencode/scripts/semantic_index.py query "<concept>" -k 5` (or `pnpm semantic:q "<concept>" -k 5` / `npm run semantic:q -- "<concept>" -k 5`; auto-builds `.semindex/index.db` if missing or >7d stale). Escalate to semantic search whenever ≥2 lexical greps return empty or before reading ≥4 candidate files.
- Keep session context lean: never re-read unmodified lines already loaded in the current compaction epoch; read targeted `offset`/`limit` slices around grep/semantic hits instead of paging >400-line files in main; delegate multi-file exploration (≥4 files) to `explore` or `researcher` so exploratory reads stay out of the main session's KV cache. Audit with `npm --prefix ~/.config/opencode run eval:context`.

## Specialist delegation (standing authorization: delegate automatically)

- Standing authorization: automatically use specialists when useful without
  asking approval for delegation; this keeps the main session context healthy.
- Respect explicit no-subagent / solo-work requests; ordinary scope and change
  approval gates still apply (plan confirmation, destructive actions, commits/PRs).
- Delegate broad searches, deep investigations, reviews, and independent bounded
  work; choose `explore` for quick lookups, `researcher` for architecture
  and data-flow evidence, `reviewer` for regressions, `security-reviewer` for
  security, `docs-writer` for documentation, `brainstorm` for design, and
  `domain-companion` for finance-domain questions.
- Parallelize only independent light tasks; avoid heavy concurrent sessions per
  machine safety. Do not delegate trivial known-file operations main can do directly.
- Main stays coordinator: integration decisions and final concise synthesis.
- Give each specialist a concrete, bounded prompt with owned files or read-only
  scope and expected evidence (file:line references, findings, or verification
  results); no duplicate work across specialists. Reuse returned evidence and
  agents when appropriate; avoid redundant readbacks.
- Specialists return concise findings only — file:line / test / results — and
  leave detailed raw logs in child context.
- Cancellation is not model failure. Check the reported error before retrying or
  requesting an availability fallback; a fallback is a next-prompt handoff, not
  automatic in-flight recovery or an escape from account-wide Go quota.

## Quota anchoring (Go cost bar / sr-calc, standing since 2026-10-26, re-based 2026-11-23)

- Go quota truth lives ONLY in the opencode.ai web console; never fetch it
  via API key. Quota basis is tier-normalized token dollars
  (`sr-calc.mjs` GO_PRICES/GO_ALLOWANCE) — flat request counts and request
  caps are retired, so never re-derive caps from a reading.
- When the user shares console quota % (monthly/weekly/rolling), record a
  pct override (the formula already matches console ±1%, so this is rarely
  needed):
  `node ~/.config/opencode/skills/model-benchmarks/scripts/sr-calc.mjs --anchor <month|week|rolling> <pct> --at <ISO reading time> --note "<date> console"`,
- Console "Most used" percentages are model SHARES, not cap usage.
