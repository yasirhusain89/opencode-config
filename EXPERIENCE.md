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
- **2026-10-21 — full re-pin: zero dead agent/config IDs.** reviewer →
  `opencode-go/glm-5.3-flash` (§16-evaluated, net +30), security-reviewer →
  `opencode-go/claude-haiku-5.5` (frontier cheapest-quality), researcher
  unchanged (nemotron free, 10/10 delivery), brainstorm/docs-writer/
  domain-companion → `opencode/glm-5.3-flash-free` (brainstorm on
  personality fit: top Imagination/Expressiveness/Warmth), main+small →
  `opencode-go/muse-spark-1.3-contributor` (training terms accepted;
  contributor-adjusted Pareto: Intel 48 @ ~$0.10–0.15/task, on-frontier).
  Fallbacks live in each agent body; paid `muse-spark-1.3` (non-contributor)
  is NOT in the catalog — never pin it. Verified via
  `dashboard-2026-10-21.json` (`deadPins: []`, all routes `primaryLive`).
  Researcher stays the only §16-frozen pin; brainstorm's GLM pick is
  personality-data-backed but not task-evaluated — re-evaluate if its
  decision pages degrade.
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

## 7. Cost visibility (SR layers)

- **2026-10-21 — SR cost visibility ships in two layers, both local-only.**
  L1 (in-app): `skills/model-benchmarks/scripts/sr-calc.mjs` is the single
  shared formula (1 SR = $0.01; caps 5h $12 / 7d $30 / 30d $60 verified vs
  console 2026-10-20); `plugins/cost-tracker.js` keeps
  `~/.local/share/opencode/sr-live.json` fresh via the `event` hook (60s
  full-recompute throttle, incremental patches between, never throws);
  `/quota` (`command/quota.md` + `quota-status.mjs`) prints live SR windows
  + per-model runway. L2 (macOS): `tools/cost-bar/` single-file Swift
  `NSStatusItem` pill (`~/Applications/OpenCodeCostBar.app`,
  `ai.opencode.costbar.plist`) — event-driven file watch, `--self-test`
  verifies parsing without launching GUI. Plugin is `.js` (not `.ts`) so
  `node --check` can verify it without a TS toolchain.
- **2026-10-21 — no Go API key on file** (`~/.local/share/opencode/.go-api-key`
  absent): official-quota refresh and the menu-bar "Refresh official Go quota"
  action report "no key" until one is created at opencode.ai dashboard →
  API keys. Local SR math is unaffected.
- **2026-10-21 — full-recompute cost is bounded:** sr-calc scans only the
  last 30d of assistant rows (single GROUP BY query); on a ~1GB DB it runs
  in seconds — cheap enough for /quota on demand and 60s plugin throttle,
  no background daemon needed.
- **2026-10-21 — Login Items names come from the executable, not the plist.**
  LaunchAgents that exec `/bin/bash` or `/usr/bin/python3` show up as
  "bash"/"python (unidentified developer)". Fix: `tools/helpers/` builds one
  shared Swift launcher into branded `~/Applications/OpenCode <Job>.app`
  bundles (owl icon copied from OpenCode.app, command in each bundle's
  `OPCommand` Info.plist key); plists exec the wrapper. Spawn-and-wait, NOT
  exec — exec would replace the image with the interpreter and the old name
  would come back. Evidence: `tools/helpers/build.sh`,
  `~/Applications/OpenCode DB Check.app`, repointed
  `~/Library/LaunchAgents/{com.opencode.db-*,ai.opencode.*}.plist`.

## 5. How to add a lesson
Append under the right section (or add one): `**YYYY-MM-DD — one-line
claim.**` 1–2 lines of context, then `Evidence: <file:line / snapshot /
commit>`. Claims without evidence go in the session chat, not here.

## 6. Session-DB housekeeping

- **2026-10-20 — OpenCode Desktop renderer stutter was session-DB bloat
  (938MB opencode.db), not system load.** Two mega-sessions (2710 + 1352
  msgs, ~2MB file-part events) spiked the Electron renderer to ~85% and
  WindowServer to ~40% on session switch; the Mac itself had 93% memory
  free, 0 swap, no thermal throttle. Fix: `scripts/opencode_db_housekeeping.sh`
  (report/maintain/vacuum/prune/costs/--check) + weekly-maintain and
  daily-check launchd agents. Prune only via `opencode export` archive +
  `opencode session delete` — never raw SQL (part.session_id and event rows
  have no FK cascade from session, so raw deletes orphan rows). VACUUM
  reclaims nothing while freelist is 0; space comes back only via prune.
  Export JSON keeps full review data (session info with model/agent/cost/
  tokens + all message parts), so pruned sessions stay reviewable for
  cost/effectiveness. Evidence: `scripts/opencode_db_housekeeping.sh:1-22`,
  `~/Library/LaunchAgents/com.opencode.db-maintain.plist`,
  `~/Library/LaunchAgents/com.opencode.db-check.plist`.
