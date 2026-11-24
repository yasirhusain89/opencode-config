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
  override MUST include `agents.title.model` (was `small_model`; title/summary
  calls hit the same quota). Fallback order: 1.2-contributor-free (same gateway) → Go plan
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
- **2026-10-24 — exec-guard blocks process-spawning runtimes (Wine/GPTK,
  app-bundle executables): direct `wine64 --version` probes spawned
  wineservers + Dock icons, and `wineserver -k` on the shared SteamHeroic
  prefix killed the user's live MW5 game.** Quote-aware segment parser
  inspects the executable token (peeling env vars, `for var in ...` loop
  bindings, and wrappers like `env`/`arch`/`xargs`/`timeout`, plus recursing
  into `sh -c` and `find -exec`) and blocks Wine/GPTK/Proton binaries and
  direct `*/Contents/MacOS/<bin>` launches (except non-Wine `--self-test`
  helpers), plus `osascript` `tell application ... to activate/launch` and
  tight `cmd1&cmd2` backgrounding. Read-only inspection (`pgrep`/`ps`, `ls`,
  `otool`, `codesign`, log greps, `find -name`, Read/Glob/Grep) and
  `osascript ... to quit` stay allowed. Opt-in via `OPENCODE_ALLOW_WINE=1`
  (session env or inline prefix gated by `"*OPENCODE_ALLOW_WINE=1*": "ask"` in
  `opencode.jsonc` so the user is always prompted). Evidence:
  `plugins/exec-guard.ts:52-395` (WINE segment guard),
  `plugins/exec-guard.ts:432-502` (tight `&` + `osascript`),
  `plugins/exec-guard.ts:596-626` (hook), `opencode.jsonc:104-117` (bash
  `"ask"` backups).

- **2026-10-26 — automatic model failover exists: `plugins/model-fallback.js`
  (supersedes the 2026-10-21 "No automatic failover exists" lesson in §1).**
  Agent `model:` is a single string (config schema has no fallback list) and
  the `chat.params` hook cannot change models, so the old `> Routing
  fallback:` prompt lines were inert — a subagent cannot switch its own
  model, and 429s just rode the runner's exponential backoff
  (`session.next.retried`) and died. The plugin records each session's model
  via `chat.params`, and on the first 429/quota error switches the session
  via `POST /api/session/{id}/model` (v2 `switchModel`), so the in-flight
  backoff's next attempt runs on the mapped Go fallback; every switch fires a
  toast + `app.log`. Guards: once per session (a fallback that also 429s
  rides normal backoff, then an exhaustion toast), 429/quota only (never
  auth/context errors), Go→Go map only (unmapped models log, never switch),
  never throws, kill switch `OPENCODE_MODEL_FALLBACK=off`. Privacy: haiku →
  glm (zero-retention); spark-contributor is NEVER an automatic target (trains
  Meta). Agent files now point at the plugin instead of self-switch text.
  Evidence: `plugins/model-fallback.js`, 13-assert fake-event smoke test
  (`node --check` + retry/auth/unmapped/v1-shape/exhaustion/kill-switch
  cases), `agent/*.md` notes.

- **2026-10-26 follow-up — free failover lane via NVIDIA (single-hop,
  agent-gated).** The opencode free shelf is dead (dashboard-2026-10-24: free
  routes 100% fail), but NVIDIA trial endpoints work — slow (DS v4.1-flash p50
  ~93s vs spark 2.9s) and throttling-prone, with the only local proof being
  DS v4.1-flash's 31 turns at 3% fail. `model-fallback.js` now checks the
  session agent (recorded via `chat.params`): `brainstorm`/`docs-writer`/
  `domain-companion` fail straight to `nvidia/deepseek-ai/deepseek-v4.1-flash`
  (no Go middle hop, no chains); everything else — code agents, main session,
  unknown — stays Go→Go (zero-retention). Privacy holds by construction:
  once-per-session latch means a reviewer on glm→minimax can never chain onto
  the training/logging NVIDIA endpoint. GLM-flash and minimax-m3.1-flash also
  exist on the NVIDIA shelf (verified live `opencode models nvidia`) but are
  unproven through that endpoint — DS stays the terminal target until usage
  says otherwise. Evidence: `plugins/model-fallback.js` (`GO_FALLBACK` /
  `FREE_FALLBACK` / `LOW_STAKES`), 18-assert smoke test (agent-gating +
  no-leak latch cases).

- **2026-10-26 audit correction — quota recovery is a next-prompt handoff,
  not an in-flight model switch.** Supersedes both automatic-failover entries
  above: real legacy sessions emit `session.status` retry events and retain
  their request model during backoff. The old unauthenticated switch endpoint
  and event-only mocks did not establish recovery. `model-fallback.js` now
  arms one fallback and mutates the next `chat.message` model; stop the retry
  and resume the same session/Task. State is process-local. Private roles stay
  on Go availability fallbacks; detected account-wide Go exhaustion prompts
  waiting/manual selection rather than bouncing between shared-quota models.
  Only brainstorm/docs/domain may hand off to `nvidia/z-ai/glm-5.3-flash`.
  Manual role/model changes cancel handoff, exhausted fallbacks stop being
  forced, and title/summary bookkeeping cannot replace task identity.
  Evidence: `scripts/model-fallback.test.mjs` (12 passing tests) and
  `scripts/model-fallback.runtime.test.mjs` (installed CLI 1.19.3, real local
  HTTP 429 → retry event → explicit user-stop simulation → next prompt model
  persisted → fallback HTTP/SSE completion, both Go and NVIDIA lanes). Fixture
  uses dummy auth and OS-enforced loopback-only networking, not live providers;
  Task-tool resumption and Desktop 1.19.4 remain outside that runtime test.
- **2026-10-26 audit correction — measure NVIDIA routes independently.**
  The earlier "only DS has local proof", "free shelf is dead", and blanket
  NVIDIA training/trial claims above were too broad. The Oct-26 usage snapshot
  contains substantial NVIDIA GLM traffic (136 turns, p50 35.2s) and MiniMax
  traffic (26 turns, p50 30s), supporting GLM as the approved free standby.
  Endpoint availability/terms must be checked independently; usage success is
  not proof of data-retention terms. Go account quota is shared across models.
  Dashboard primaries now derive from config/agent definitions rather than
  stale hardcoded free IDs. Evidence: `dashboard-2026-10-26.json`,
  `routing-2026-10-26.json`, `scripts/dashboard.test.mjs` under this skill.
- **2026-10-26 — permission ordering and plugin export shape need regression
  checks.** Native rules use the last match: broad external-directory ask
  belongs first, trusted exact roots/descendants next, sensitive denies last.
  Both `~/projects` and `~/Projects` occur in runtime paths. Agent overrides
  must restore Plan/Explore edit restrictions after global allows. Root-level
  docs need `*.md`, not only `**/*.md`. Plugin entry modules must export only
  plugin factories: exported guard helpers were invoked with plugin context
  and produced `command.replace/trim is not a function` startup errors. Remove
  helper exports and test the real hooks. Evidence:
  `scripts/harness-permissions.test.mjs` (24 passing cases, including fresh
  installed-runtime resolution of Plan, Explore, General, and docs-writer).
  Restart OpenCode after config/plugin/agent changes.

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
- **2026-11-23 — universal semantic index + session-context eval
  (`scripts/context_eval.mjs`, SCOS/NCR).** `scripts/semantic_index.py` is now
  project-agnostic (git-root auto-detect, `--root`, `ensure --gitnexus
  --index-only --name`, auto-build on query when missing/>7d stale,
  per-project overrides in `<repo>/.semindex/config.json`, localhost-only
  guard retained); fotoflow `scripts/semantic_index.py` and monartha
  `python/semantic_index.py` are thin delegates to it (existing
  `semantic:q`/`index:semantic` wrappers keep working). `.semindex/.gitignore`
  now ignores only `index.db*` so a committed `config.json` stays visible;
  GraphRAG writes use `--index-only` (no AGENTS.md/`.claude/skills`
  injection — delete stale Oct-20 fotoflow skill files on sight).
  `context_eval.mjs` (`eval:context`) scores 220 multi-turn sessions
  deterministically (0 LLM calls): mean SCOS 71.5/100, byte-weighted NCR
  42.2%, 33% of read lines are unmodified duplicates, semantic/graph search
  used in only 13% of the 82 sessions that needed it. Embedding-rescue cosine
  thresholds (0.58 dead-file / 0.62 slice-tail) are bootstrap priors, NOT
  tuned constants: `--ollama-embed` appends raw cosine observations to local
  `context-eval-calibration.jsonl`, `--suggest-thresholds` prints the
  empirical rescue-rate elbow — re-derive monthly or after ~50 enriched
  sessions. Evidence: `scripts/context_eval.mjs` (`--self-test` green),
  `scripts/semantic_index.py:load_scan_config`, 4 fresh indexes
  (mw5-advisor 922 chunks, opencode 796, fotoflow 587, monartha 699).

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
- **Guide tables are generated, never hand-edited.** `dashboard.mjs` +
  `guide_data.mjs` regenerate §1/§8/§9 from DB/logs/pins into `data.js`
  (the Svelte shell reads it; refresh needs no rebuild; `--write-guide`
  is legacy test-only). Editorial prose lives in `content/guide.json`.
  Run-log lives in CHANGELOG, never in the guide. Evidence: CHANGELOG
  2026-10-19 restructure; 2026-10-21 Svelte port.
- **Scheduled pulls need catch-up + idempotency.** Monday-06:00 launchd
  missed 10-05/10-12 while asleep; fixed with RunAtLoad + 7-day staleness
  guard (safe to re-run by hand). Sandbox-test launchd changes in fake-HOME
  first (playwright browser path follows HOME). Evidence: CHANGELOG
  2026-10-18 entries.
- **Cross-check benchmark claims live before citing.** The guide wrongly
  called BFCL "void/stale"; V4 (2026-04-12, 83 configs) verified live with 0
  direct entries for our finalists. Family signal favored GLM/Kimi,
  consistent with §16. Evidence: CHANGELOG 2026-10-19 entries.
- **2026-11-22 — Two-stage mini-eval isolation rules (`scripts/mini_eval.mjs`).**
  Headless `opencode run` evals MUST set `OPENCODE_MODEL_FALLBACK=off` (so a
  429 never silently hands off to a fallback model mid-eval), pass `--archived
  --title`, and override `OPENCODE_CONFIG_CONTENT` with `agents.title.model`
  pinned to the candidate (otherwise background title gen burns paid Go quota
  even when testing free models) plus `compaction:{auto:false}` and all tools
  denied on standalone tasks (eliminating the 2026-10-18 exploration-wander
  DNFs). For tool-calling probes (P4), the fixture directory MUST live inside
  the workspace (`snapshots/evals/.p4-fixture/`), not `os.tmpdir()`, because
  headless `opencode run` auto-rejects `external_directory` prompts on
  `/private/var/folders/*`. Stage 2 blind run files (`runs/<code-dXX>.json`)
  must omit `model` and scrub self-identifying tokens. Evidence:
  `skills/model-benchmarks/scripts/mini_eval.mjs`, `mini_eval.test.mjs` (39
  assertions), `snapshots/evals/2026-11-22/probe-scorecard.md`.

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
- **2026-10-21 — sr-live staleness was invisible by design: judge freshness
  from `fullRecomputeAt`, never mtime.** Recomputes failed silently for hours
  (bare `node`/`sqlite3` missing from the host PATH, error swallowed), so
  incremental-only patches held h5 at 83% vs 1% DB truth; every patch rewrote
  the file so mtime looked fresh and /quota never self-corrected. Fix:
  `plugins/cost-tracker.js` recomputes in-process (`import { calcSR }`),
  hardens PATH, logs failures to `sr-debug.log`, stamps `fullRecomputeAt`,
  keeps `generated_at` at recompute time (`patched_at` for touches), and
  skips the increment when a recompute just ran (DB may already include the
  turn); `quota-status.mjs` measures staleness from that stamp with a STALE
  banner past 10min. Evidence: `plugins/cost-tracker.js:fullRecompute`,
  `skills/usage-dashboard/scripts/quota-status.mjs:48-70`.

- **2026-10-25 — the Go allowance meter is REQUEST COUNTS per model, not
  dollars.** The console blocked the account with local spend at $7.38 of a
  $30 weekly cap; dollar-based SR math showed 74% while the console showed
  100%. Cross-checking the official request-log CSV against the local DB:
  7d request share (muse 92.8% / deepseek 3.7% / argon 1.7%) matches the
  console (94/3/1), token share (61/34/…) and dollar share do not. Cap
  calibration: muse-spark $60 tier hit its weekly cap at ~7,800 requests →
  `REQ_PER_CAPUSD = 130` req/wk per cap-dollar (`sr-calc.mjs`); h5/d7/d30
  = 20%/50%/100% of the monthly request budget. The official CSV export is
  a 1,000-row tail sample — fine for cost-per-request validation, useless
  for weekly totals. Schema bumped to 3 (v2 = dollar-based, ignored by
  readers). Non-muse request caps are uncalibrated estimates. Evidence:
  `/quota` output (7d 94% binding muse, d7_90) matching the console
  screenshot; `sr-calc.mjs` (REQ_PER_CAPUSD, request-based binding),
  `cost-tracker.js:SCHEMA`, `quota-status.mjs`, `tools/cost-bar/main.swift`.

- **2026-10-25 — plugin code is cached for the process lifetime; a config
  fix does not take effect until OpenCode restarts.** After changing
  sr-calc/cost-tracker, the 7 running opencode processes kept rewriting
  `sr-live.json` with pre-v3 (schema 2, dollar-based) state every ≤60s,
  silently reverting fresh CLI writes within seconds. Diagnosed by
  `generated_at` newer than the manual write; only a restart stops it.
  Write-then-read in a single command to verify against the race.

- **2026-10-25 — request-cap calibration table (ongoing loop).** The weekly
  request cap is `FAMILY_CAP × 130` (muse anchor). Whenever the console shows
  a model's %, compute `impliedCap = 7d reqs ÷ pct` and record it here, then
  tighten the estimate in `sr-calc.mjs`. Known points:
  muse 7,340 @ 94% → ~7,800/wk (anchor); deepseek 291 @ 3% → ~9,700/wk
  (est 10,400 ✓); argon 135 @ 1% → ~13,500/mo (noisy). STILL UNVERIFIED: the
  h5 = 20%-of-monthly split for requests — check vs console rolling % next
  heavy burst. Regression tests for the meter live in
  `skills/model-benchmarks/scripts/sr-calc.test.mjs` (fixture DB, no network).

- **2026-10-26 — the cost bar owns its data now (reader→writer inversion).**
  Reader-only bar + event-only plugin writer meant rolling windows decayed
  whenever idle (wall-clock slides h5/d7/d30 with zero turns — the old
  "idle is not stale" rule was wrong for rolling windows) and every tracker
  fix needed an opencode restart to display. The bar recomputes via sr-calc
  every 60s on a background queue and rewrites sr-live.json atomically; the
  plugin stays as the in-turn fast path (toasts, ≤60s patches). sr-calc
  stamps `fullRecomputeAt` at creation so CLI files are first-class; all
  writers use tmp+rename. isStale keeps the post-full activity gate
  (recompute-failure detector) plus an 1800s idle backstop. Evidence:
  `tools/cost-bar/main.swift:recomputeIfDue`, `sr-calc.mjs:fullRecomputeAt`.

- **2026-10-26 — `strings`/`grep` are blind to non-ASCII-adjacent literals
  in Swift 6 binaries.** Interpolated literals containing emoji/·/— are
  stored UTF-16, so `strings $BIN | grep BLOCKED` finds nothing even when
  the code is fresh — verify builds by sha/mtime delta and behavior
  (`--self-test`), never by literal-hunting. Cost a full stale-binary
  wild-goose chase (binary was current the whole time).

- **2026-10-26 — verify relaunches by PID, not by `pgrep` existing.**
  A `pkill -f` pattern with spaces never matched, so "bar relaunched" was
  unverified. Kill by exact PID, confirm the process is GONE, then confirm
  a NEW pid + start time. The KeepAlive LaunchAgent respawns within
  seconds.

- **2026-10-26 — when the pill looks "impossible", check WHICH writer wrote
  last: `patched_at` vs `fullRecomputeAt`.** The plugin's incremental patch
  and the full recompute used different pct formulas (all-Go total vs
  binding-model-only ÷ binding cap), so the pill flapped 97↔103 on every
  turn — exact after a recompute, inflated after a patch. Proof: 7926/7800
  = 101.6% exactly, while muse alone was ~7,598. Fix: the patch now moves
  pct/allowedReq only when the turn's family IS the binding model
  (`plugins/cost-tracker.js`, binding-aware patch + local `fam()` kept in
  sync with sr-calc). Takes effect on next opencode restart; until then the
  bar's 60s self-recompute corrects the file within a minute.
  (Superseded hours later by the schema-4 remodel below — the binding model
  itself was wrong, not just the patch formula.)

- **2026-10-26 — CORRECTION: the 94/3/1 were model SHARES, and caps are
  account-wide fixed periods — schema 4 remodel.** The console's "Most used
  this period" panel (muse 94%, deepseek 3%, argon 1%) is share of requests,
  NOT cap usage — the entire REQ_PER_CAPUSD=130 calibration and the
  per-model-cap binding model were built on share-confusion and are deleted.
  The console's real structure: Monthly = fixed 19th–19th UTC cycle, Weekly
  = fixed Mon–Mon UTC, Rolling = trailing 5h (verified: console "resets in"
  == our oldest+5h). Caps are account-wide: month 18,000 (console 9,334 =
  52%), week 8,000 PROVISIONAL (blocked ~Oct 25 at ~7.8k account reqs —
  re-derive on the next console weekly reading), rolling cap unknown
  (usage + expiry only, never a pct). Monthly usage counts ALL providers:
  console 9,334 ≈ DB all-provider 9,534 (2%) vs Go-only 8,154 (13%).
  Console truth is pinned via `sr-anchors.json` (usage = anchor + DB deltas;
  `sr-calc.mjs --anchor month|week N`); unanchored windows show
  UNCALIBRATED. Schema bumped to 4 — the running pre-4 plugin ACTIVELY
  reverts the file to schema 3 (observed 02:15), so this remodel REQUIRES one
  opencode restart to converge. Open questions: the Mon 00Z flood (hundreds
  of tiny multi-provider tool-call rows, decaying 284→72→36/hr) may be
  uncounted by the console — if weekly deltas drift from console, exclude
  that class; whether another device contributes the ~1.2k monthly gap.

- **2026-10-26 — a dynamic `import()` is process-lifetime cached: ANY
  sr-calc.mjs edit is invisible to a running opencode until restart.**
  The plugin's recompute path (`cost-tracker.js`) imports sr-calc in-process;
  Node caches that module forever, so mid-session edits to the calculator
  keep re-writing OLD-model state files even after everything else is
  updated (watched again 02:54: the freshly built schema-4 stack got
  overwritten by the still-running plugin's cached pre-4 code). The schema
  guard in `readLive` only rejects foreign schemas — it cannot catch
  schema-4→4 logic fixes. Rule: treat "sr-calc changed" as "opencode
  restart pending"; verify convergence with `fullRecomputeAt` + schema
  check the way the bar unlock was verified.

- **2026-10-21 — quota % must include every Go model, and runway belongs on
  the monthly basis.** Window totals sum ALL `opencode-go` spend (the old
  `cap != null` filter silently dropped unmapped/new models); per-model
  `remainingMsgs` compares 30d spend to the monthly cap instead of pairing a
  7d rate with a monthly cap. `sr-live.json` is stamped `schema: 2` and readers
  ignore other schemas, so a long-running pre-v2 process cannot poison
  freshness (observed: `generated_at` newer than `fullRecomputeAt`). Idle is
  not stale: STALE requires activity after the last full recompute.
  (2026-10-26 correction: true only for cumulative counters — rolling
  windows slide with wall-clock, so an idle file decays; see the
  bar-owns-data entry above.)
  Evidence: `sr-calc.mjs` (`goRows`, `remainingMsgs`), `cost-tracker.js`
  `readLive`, `quota-status.mjs`, `tools/cost-bar/main.swift` `isStale`.

- **2026-11-14 — V2 migration: storage, events, config, and anchors.**
  Live DB is V2-migrated the moment any V2 process opens it (same path);
  legacy `message`/`part` tables freeze, new turns go to `session_message`
  (parts embedded in `data.content`) with per-session aggregates on
  `session_v2.cost`/`tokens_*`. Completed assistant rows DO carry
  cost/tokens (verify with `finish`/`cost` keys — the live turn's in-flight
  row lacks them until it completes). V2 has no `message.updated` event:
  cost-tracker subscribes `session.step.started/ended/failed` (model from
  started, cost from ended) and sr-calc counts `type='assistant'` rows —
  verified 20 `ignoring unknown event types` WARNs ending 02:55Z, none since.
  Anchors are source-stamped (`v1`/`v2`): the V2 migration copies history
  but not 1:1 (−45 rows in Oct 19–26, −$3.93 month cost), so a V1 dbCount
  must never delta against V2 counts — the month anchor was rebased
  9604(v1)→9559(v2) by recounting the same window in the new table.
  Config: `agent`→`agents`, `provider`→`providers` (`npm`→`package`
  `aisdk:`-prefixed, `options`→`settings`, `tool_call`→`capabilities.tools`,
  `reasoning` dropped as unsupported), `permission`→ordered `permissions`
  (`bash`→`shell`, `task`→`subagent`), `mcp`→`mcp.servers` (timeout triple
  startup/catalog/execution), `small_model`→`agents.title.model`;
  agent `temperature` dropped (V2 normalizer ignores it; the runner never
  sends `request.body` either). Verified by `debug config`/`debug agents`
  normalized-output identity before/after. `agent/` and `command/` dirs stay
  (V2 discovers all four layouts; rename was rejected in
  `docs/archive/agent-setup-review.md`). `debug agent <name>` is gone (V2
  only has `debug agents`); harness oracle rewritten for the array shape
  with runtime `~`-expansion mirrored for read/edit/external_directory.
  Write-then-validate configs: the live service rejects malformed JSONC and
  keeps last-good (observed one transient WARN mid-conversion, recovered on
  next write). Known pre-existing V2 gap (not migration-caused):
  `aa_bench inventory` shells `opencode models <provider>`, which V2 no
  longer accepts — 2 test failures, out of scope.

- **2026-11-15 — after any sr-calc/plugin change, restart the SERVICE
  (`opencode service restart`), not the app/terminal — and recognize the
  two-writer flap.** Restarting the desktop app orphaned the service
  (PPID 1, same pid) with the old sr-calc cached: sr-live.json flapped
  between V1-sourced (`dbCount` frozen at the legacy 14576) and V2-sourced
  (advancing ~15600+) writers about once a minute. Signature: `usedReq`
  jumps ±hundreds between reads, `/quota` week/rolling read 0 while sessions
  are active. Only a service restart clears Node's per-process module cache
  (plugin reloads re-execute plugin code but keep cached imports). Verify
  post-restart: `service.json` has a new pid, sr-live `dbCount` matches
  `session_message` counts and advances monotonically across two reads 70s
  apart, zero WARN/ERROR in the log.

- **2026-11-16 — bar said BLOCKED at 101.2% while the console said 99%: two
  gaps, both resolved by re-anchoring + re-deriving.** (1) Monthly: DB
  overcounts the console by ~440 (anchored 18,218 vs console 17,784). The
  openrouter BYOK lane explains nearly all of it — 584 month rows ($24.87 on
  the user's own key, last used Nov 1), 264 before the Oct-26 anchor (baked
  into the offset) + 320 after; ex-openrouter DB 17,875 vs console 17,784 =
  0.5%. Rule: the console counts opencode-infra routes (Go + free + nvidia
  trial) and excludes BYOK keys. If BYOK resumes, exclude that provider in
  sr-calc instead of re-anchoring around it. (2) Weekly: not a count gap but
  a wrong cap — DB week ~2,050 genuine requests (22 sessions, normal
  tokens/row) vs 13% console implies cap ≈ 15.7k, so WEEK_CAP 8,000 →
  15,700 (single reading, confirm next sighting). The Oct-25 "7.8k block"
  inference is superseded. Also: since ~Nov 14 ALL cost fields read 0.0
  (session_message AND session_v2, tokens still flow) — usedUsd is blind for
  recent days; requests (the cap unit) are unaffected. And the console DOES
  show a rolling % (13% this reading → implied rolling cap ~9.8k) — sr-calc
  still models rolling as capless; revisit if rolling ever binds.
  Evidence: console screenshot 2026-11-16 (99/13/13%, 17,784 reqs, 3.154B
  tok), `sr-anchors.json` (month 17784 / week 2041 @ 2026-11-16),
  `sr-calc.mjs:WEEK_CAP`, month tokens DB 3.24B vs console 3.15B.

- **2026-11-17 — local BLOCKED ~5.5h before the real Go block: the quota
  counts Go-product requests only, and the anchor paired a console reading
  with a dbCount from a different instant.** The console request-log CSV
  (1,000 rows, 22:06→05:32Z) matches DB `opencode-go` rows ±2/hour; free,
  BYOK and nvidia rows never appear in it. The console blocked at 05:32:42Z
  (last success, then 429 `Account.GoUsageLimit`); 463 Go successes since
  the 23:44Z anchor imply the console was at 17,537 there, but the anchor
  recorded 17,784 (+247), so the bar crossed 18k at 00:04Z vs the real
  05:32Z. Offset check: console − DB Go-successes = 995 at the anchor and
  999 at the block (stable) → the count model is right; the anchor
  timestamp was not. Fix: month/week/rolling count only
  `providerID='opencode-go'` with `error` rows excluded; anchors carry a
  `basis`; `--anchor --at <ISO>` measures dbCount at the reading instant;
  the cost-tracker incremental patch increments only Go turns. Re-anchored
  month 18,000 @ 05:32:43Z (Go dbCount 17,001) and week 2,041 @ 23:44:11Z
  (Go dbCount 2,012). Month resets at UTC midnight on the 19th
  (`sr-calc.mjs:66` uses `Date.UTC`), so Nov 19 00:00 UTC stands — the
  console's "resets in 1d 17h" at 05:33Z is just lag/rounding against that
  fixed boundary.
  Evidence: `request-logs-2026-11-17.csv`, `sr-anchors.json`,
  `sr-calc.mjs:dbCountSince`, `cost-tracker.js:isGoTurn`,
  `sr-calc.test.mjs` (43 assertions), `cost-tracker.v2.test.mjs` (4 tests).

- **2026-11-18 — the atomicbot.ai Go-blog token prices are exactly what the
  DB records, and pricing tokens recovers the V2 cost loss.** Blog
  (atomicbot.ai/blog/opencode-go, checked 2026-11-02) prices match recorded
  per-message costs to the 4th decimal on every row that carries cost:
  GLM-5.3-Flash $0.15/$0.50/$0.03 (rec $11.3562 = recomputed $11.356),
  Muse Spark 1.3 Contributor $0.10/$0.20/$0.002 ($9.4095 exact), DeepSeek
  V4.1 Flash off-peak $0.15/$0.60/$0.003 ($0.6812 exact — all 290 rows
  off-peak, no weekday-peak doubling seen), MiMo-V2.6-Pro $0.435/$0.87/
  $0.003625 ($0.1726 ≈ $0.1724). V2 `session_message` rows carry cost=0 on
  4,224/8,686 Go rows (legacy `message` froze ~Nov 12 05:20Z; V2 rows are
  costless even when copied), so cycle Go dollars are now computed from
  tokens: Oct 19–Nov 18 cycle = 17,001 Go requests (matches anchor exactly),
  $41.45 est at blog prices vs $34.45 recorded. Gemini 4 Argon (+Contributor)
  and Kimi K3.1 Pro prices are not published in the blog → recorded-cost
  fallback (flagged `*` in the UI). Console enforces account-wide REQUEST
  caps (month 18,000 · week 15,700), so the blog's per-model dollar table is
  nominal; its own text agrees ("switched between models … still hit the
  weekly limit before any single model reached its own").
  Evidence: `skills/usage-dashboard/generate.py` (GO_PRICES/GO_ALLOWANCE/
  go_cycle), dashboard "OpenCode Go" card, sr-anchors.json month 18,000.

- **2026-11-23 — the 5h Go limit is provider-enforced, not request-
  calibrated; the bar now reflects it from the 429 itself.** The rolling
  window showed "no cap yet" through a real block at 20:08:14Z (two
  `provider.go-limit` 429s, "5 hour usage limit reached") while month/week
  had headroom, so the pill never left week/month. The 429 row's
  `error.retryAfterMs` is the provider's own reset (20:08:14Z + 3h2m44s =
  23:10:58Z), and the body's `metadata.limitName` ("5 hour" vs "monthly")
  separates 5h from monthly blocks (both share the type; the message is the
  fallback). sr-calc emits `windows.rolling.blocked/blockedAt/blockedUntil`
  only while no later successful Go row exists; no pct/cap is derived (the
  console rolling % is not a request count). The bar binds the pill to rolling
  when blocked (`⛔ BLOCKED · <reset>`), and /quota prints the same. A
  schema-4 file lacking `rolling.blocked` is treated as stale by the bar and
  /quota so a pre-fix plugin host cannot hide the block before its restart.
  Evidence: `sr-calc.mjs:220-244,290-292`, live 429 row
  2026-11-23T20:08:14.684Z, `sr-calc.test.mjs` (59 assertions),
  `tools/cost-bar/main.swift` (`binding`/`winLine`/`isStale`),
  `quota-status.mjs`.

- **2026-11-23 — quota basis is tier-normalized token dollars, not flat
  requests; the flat request-cap model is retired.** The 5h wall at 430
  requests (vs 13% at 1,263 on Nov 16) proved requests are not the unit: one
  `gemini-4-argon` request (~$0.040 vs $30/mo = 0.134% of monthly quota)
  burns ~91x the quota of one `muse-spark-1.3-contributor` request (~$0.0009
  vs $60/mo). `pct(window) = 100 * Σ_models USD/Allowance` with per-model $
  tiers (5h = monthly/5, weekly = monthly/2) reproduces every console
  reading and 429 block to ~1% with zero anchors (Oct-26 53.2 vs 52,
  Nov-16 5h 13.3 vs 13 and week 13.4 vs 13, Nov-17 month block 99.2 vs 100,
  Nov-23 5h block 99.2 vs 100). `sr-calc.mjs` now prices tokens at blog
  GO_PRICES (max(recorded, token-est)) so V2 zero-cost rows are no longer
  $0.00; request caps/anchors retired (`capReq`/`allowedReq` null,
  `--anchor` records a console pct override, old count anchors ignored);
  rolling carries a live pct and competes for the pill; `tRoll` floors at
  the last expired 5h reset so dead-bucket requests stop inflating the fresh
  bucket; monthly 429s mark the month window blocked. Bar pill names the
  window (`M 69% · 25.0d`) with quota-vs-reset pace projection; plugin
  hot-reloads sr-calc (`?v=mtimeMs`), excludes `-free` from increments,
  estimates V2 zero-cost turns from event tokens, and recomputes on
  `session.step.failed` so a 429 flips state immediately; the Swift
  file-watcher re-arms after atomic renames. Live: month 69% ($21.54,
  exhausts in ~2.2d at Argon-heavy mix), week 57%, rolling 13% fresh
  bucket. Evidence: `sr-calc.mjs` (GO_PRICES/GO_ALLOWANCE/`calcSR`),
  `sr-calc.test.mjs` (88 assertions), `cost-tracker.js`
  (hot-reload/`onFailed`/token estimate), `main.swift`
  (`binding`/`pill`/`armWatcher`/pace projection), `quota-status.mjs`,
  `generate.py` (contributor price), `Index.svelte` (blocked badges).

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
