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
- Locate code with native Grep/glob and GitNexus graph tools (`query`, `context`, `trace`); for meaning-based search use the project's `semantic:q` script when present; read the file before citing it.

<!-- semantic fallback: when GitNexus graph lookups come back empty/UNKNOWN, or -->
<!-- the question is "find code by meaning" (unknown vocabulary), use -->
<!-- `npm run semantic:q -- "concept"` (ollama + sqlite-vec over agent/, skills/, -->
<!-- docs/, plugins/, command/). Rebuild with `npm run index:semantic`. Needs -->
<!-- `ollama serve` + the nomic-embed-text model. Lexical fallback: native Grep. -->
