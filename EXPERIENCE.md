# EXPERIENCE.md — harness lessons (Harness2-style)

Evidence-backed lessons for this harness (`~/.config/opencode`). Agents and
humans: check here before changing model pins, plugins, eval protocol, or
retrieval — prior incidents are recorded so they don't recur.

**Discipline:** append dated entries; never rewrite history. Supersede with a
new entry that cites the old one. Every lesson links its evidence
(file, snapshot, or commit). Run-log detail stays in
`skills/model-benchmarks/snapshots/CHANGELOG.md`; this file holds only the
distilled, still-true conclusions.

## 1. Model pins & routing

- **2026-10-18 — reviewer/security-reviewer → `opencode/space-bunny-free`
  (35/40 steps), researcher → `opencode/nemotron-3.5-super-vl-free` (40
  steps).** Mini-eval on 10 frozen monartha diffs: space-bunny net +32
  (8/10 delivery, ~31s/run), glm-5.3-flash +30 (6/10, 2×420s provider
  timeouts), nemotron +9 but 10/10 delivery. Space-bunny's ~20% wander rate
  is mitigated by a repo being present; treat its "blocking" claims as
  verify-first. Evidence: `skills/model-benchmarks/snapshots/evals/2026-10-18/scorecard.md`.
- **Spark-1.3-contributor via OpenRouter is dead under current privacy
  settings** (paid-training exclusion blocks the route), regardless of
  quality. Do not re-pin agents to it without re-running the eval.
  Evidence: scorecard §Decision; `agent-setup-review.md` pointer in `docs/`.
- **No automatic failover exists.** A dead quota surfaces as a session error;
  switch via `/models` or `OPENCODE_CONFIG_CONTENT` override — and the
  override MUST include `small_model` (title/summary calls hit the same
  quota). Fallback order: 1.2-contributor-free (same gateway) → Go plan
  (`opencode-go/...`, trains on prompts) → local `ollama/qwen3.8:latest`.
  Evidence: `opencode.jsonc:1-17`, `README.md` quota section.
- **Local Ollama needs `compaction: {auto:false}`** in the override (it
  rambles end-of-run summaries) and `qwen3.8` stays at 32k ctx — 262k
  forced a ~19GB KV reload stall. Evidence: `opencode.jsonc:27-39`.

## 2. Guardrails (plugins auto-load; permission block is backup, not primary)

- **2026-10 — disk-guard exists because a multi-GB download with <10GiB free
  poisoned /tmp mid-extraction** (Swift toolchain) and truncated cpio
  payloads silently. Heuristic: heavy download/extract verbs blocked below
  10GiB (`OPENCODE_MIN_FREE_GB`). Bypass only with `OPENCODE_DISK_GUARD=off`
  for one session. Evidence: `plugins/disk-guard.ts:1-14`.
- **2026-10-19 — disk-guard skips `/dev/*`: a device-node token
  (`/dev/disk4` in a compound smartctl command) resolved to devfs with 0
  available and false-blocked a legit brew install.** `targetPath` now
  ignores device nodes. Workaround until restart: keep download verbs and
  device-node references in separate bash calls. Evidence:
  `plugins/disk-guard.ts:targetPath`.
- **path-guard covers what permissions can't:** `~/Documents`/`~/Downloads`
  are denied even via relative paths, `..` traversal, symlinks, and bash
  (`$HOME` expansion). The `permission.external_directory` block only gates
  the outside-project boundary. Evidence: `plugins/path-guard.ts:1-18`.
- **2026-10-19 — exec-guard exists because sleep-poll + nohup pileup forced
  two hard reboots (17:05, 22:27).** Four concurrent sessions at ~22:00 held
  `sleep 55/90` waits and `while pgrep …; do sleep 25; done` polls (status
  `running` at hang time) while `nohup`'d Swift installs, `pnpm tauri dev`,
  and video encodes burned CPU underneath (load 90 two minutes after boot);
  the retried `engine-aarch64` video binary crashed twice (21:58/22:00) and an
  `rm -rf` on `/Volumes/YH-SanP2TB` stalled on the external drive. Fix:
  `plugins/exec-guard.ts` targets unbounded+unsupervised only — sleep>120s,
  `watch`/`tail -f`, detached execution (nohup/setsid/`&`/caffeinate, opt out
  per-session with `OPENCODE_ALLOW_BG=1` for dev-server work), GUI `open`
  (file previews and `open -R` still allowed), unbounded ping, pattern
  SIGKILLs (exact-PID `kill -9` still allowed), and `rm -rf` on `/`/`~`/
  unallowlisted `/Volumes` (see `OPENCODE_RM_VOLUMES`); wait-class commands
  get a 5min timeout ceiling, other work 30min — with coarse
  `permission.bash` backup denies and a one-foreground-check-per-turn rule in
  `AGENTS.md`. Do not run heavy sessions concurrently.
- **2026-10-19 follow-up — whole Moab folder quarantined, not just the known
  files.** All Moab files share Apr-2026 mtimes (bulk import, predates the
  crashes — not torn by our force reboots), SMART Verified, metadata healthy:
  localized media defect. `path-guard` defaults now block the folder for every
  tool + bash; fix also closed a tokenizer hole where quoted or
  backslash-escaped spaces (`"Moab 2026"`, `Moab\ 2026`) split into fragments
  that never matched. No need to identify every bad file by reading (reads are
  the wedge); folder-level block covers it. Override per-session via
  `OPENCODE_PATH_GUARD_BLOCK`. Evidence:
  `opencode.db` sessions `ses_eb26d6d…` (607 bash calls, 51 sleeps),
  `ses_eb1ca39…`, `ses_f5a5060…`;
  `~/Library/Logs/DiagnosticReports/engine-*-2026-10-18-2*.ips`.
- **secret-guard + github-safety overlap on git push --force etc. by design**
  (defense in depth). github-safety additionally blocks `gh variable set
  CI_MODE *off*` — the off brake silently disables CI; use `quick` and
  always delete the variable after. Evidence: `plugins/github-safety.ts`.

## 3. Retrieval (zvec removed 2026-10-19)

- **zvec-grep is gone** (stale 7.9M index deleted, MCP server + AGENTS block
  removed). Do not re-add daemon-based retrieval without an eval.
- **Per-project semantic index is the replacement** (ollama `nomic-embed-text`
  + sqlite-vec, localhost-only guard — source must never leave the machine
  without `SEMANTIC_ALLOW_REMOTE=1`): monartha `python/semantic_index.py`
  (`npm run semantic:q`), opencode-config + fotoflow
  `scripts/semantic_index.py` (`npm/pnpm run semantic:q`). Rebuild after big
  moves (`index:semantic`); `.semindex/` is gitignored. Evidence:
  `scripts/semantic_index.py:1-17`, `AGENTS.md` fallback comment.
- **pnpm forwards a bare `--` through to the script**, which breaks argparse
  option parsing (`pnpm semantic:q "text" -k 3`, never `-- "text"`). npm
  strips it, so the npm form keeps `--`. Evidence: fotoflow `AGENTS.md`.

## 4. Eval & benchmark hygiene

- **Eval protocol (§16): judge MUST be pinned** (model id + version + date in
  the scorecard); key stays sealed until scoring; disclose deviations
  (10-18 judge saw the key after a route failure). Minimum 6 diffs before any
  stop; drop only on mathematical futility; pause on 2 consecutive provider
  DNFs; never stop the leader early. n=10 resolves tier gaps only — report
  per-type wins, not just net score. Evidence: CHANGELOG 2026-10-19 entries.
- **Scraper parsers rot: pin with fixtures.** AA redesigned the coding page
  and a hardcoded `14/15 of 15 models` anchor returned 0 rows (fixed with a
  regex + layout fixture); `readAgentModels` matched `{"model": …}` inside
  `//` comment lines (fixed by stripping full-line comments + decoy
  fixture). Run both suites green before commit. Evidence: CHANGELOG
  2026-10-18/19 entries; `scripts/aa_bench.test.mjs`, `dashboard.test.mjs`.
- **Guide tables are generated, never hand-edited.** `dashboard.mjs`
  regenerates §1 + §8 from DB/logs/pins (`--write-guide`, strict anchors);
  run-log lives in CHANGELOG, never in the guide. Evidence: CHANGELOG
  2026-10-19 restructure entry.
- **Scheduled pulls need catch-up + idempotency.** Monday-06:00 launchd
  missed 10-05/10-12 while asleep; fixed with RunAtLoad + 7-day staleness
  guard (safe to re-run by hand). Sandbox-test launchd changes in fake-HOME
  first (playwright browser path follows HOME). Evidence: CHANGELOG
  2026-10-18 entries.
- **Cross-check benchmark claims live before citing.** The guide wrongly
  called BFCL "void/stale"; V4 (2026-04-12, 83 configs) verified live with 0
  direct entries for our finalists. Family signal favored GLM/Kimi,
  consistent with §16. Evidence: CHANGELOG 2026-10-19 entries.

## 5. How to add a lesson

Append under the right section (or add one): `**YYYY-MM-DD — one-line
claim.**` 1–2 lines of context, then `Evidence: <file:line / snapshot /
commit>`. Claims without evidence go in the session chat, not here.
