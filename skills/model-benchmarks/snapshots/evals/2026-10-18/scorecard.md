# Mini-eval scorecard — 2026-10-18

Protocol: guide §17 (10 frozen monartha diffs, same frozen reviewer prompt, fresh session, blind-judge intent). Judge: main session (opencode). Deviations, disclosed:
- Judge saw key.json after a route failure forced a mid-run contender swap (bias risk acknowledged; scoring was rubric-structured per output).
- Runs used the default agent WITH tools; cwd was the eval dir (no repo). Three models intermittently explored instead of reviewing — in production (repo present) that instinct becomes grounding, but it failed 5 runs here.
- All routes $0 (free shelf). Spark-contrib route hard-blocked by user's OpenRouter privacy guardrails → substituted before any runs; tie-break $/run moot.
- onyx scored on 6/10 diffs (2×420s provider timeouts, 2 exploration no-deliveries); lynx 8/10 (2 exploration no-deliveries); koda 10/10.

## Contenders (key unsealed)
| Code | Model | Delivered | Avg wall (delivered) | $/run |
|---|---|---|---|---|
| koda | opencode/nemotron-3.5-super-vl-free | 10/10 | ~64s | $0 |
| lynx | opencode/space-bunny-free | 8/10 | ~31s | $0 |
| onyx | opencode/glm-5.3-flash-free | 6/10 | ~150s | $0 |

## Per-diff highlights (ground-truthed)
- **d01 timeout budget**: lynx + onyx caught the num_predict 4000→2000 truncation-vs-"generates more tokens" contradiction + missing done_reason check (lynx blocking, onyx major w/ 60-tok/row arithmetic). **onyx uniquely caught the per-attempt timeout → 240s worst case** (body_attempts loop). koda: test-gap minor only.
- **d02 checks:write**: all fine; onyx uniquely noted job-level permissions *replace* inherited top-level grants.
- **d03 Phase-3 security**: lynx 12 findings — SBOM generated *after* draft release (never attached), fileURLToPath/percent-encoding, tag-vs-version gap unenforced, "uncommitted" doc heading landing in its own commit. onyx 5 minors — **uniquely caught eslint-ignores vs .prettierignore asymmetry re-breaking `prettier --check .`**. koda: 4 minors + **1 hallucinated major** (`matrix.platform` "undefined" — verified defined in ci.yml matrix include).
- **d05 fallback_reason**: all three caught untested headline + duplicated logic; lynx + onyx caught the dead-end field (nothing consumes it); onyx uniquely: Err arm omits fallback_reason.
- **d06 PDF import**: lynx + onyx both caught the CSV-input-not-disabled race and verify-a-reparse-not-the-payload; lynx uniquely: `\r` unquoted by csvCell (blocking-grade for PDF-sourced text) + no frontend timeout on extractStatement.
- **d09 ci-watch** (onyx DNF): lynx caught the false-green race (later-registering workflows missed → exit 0) + gh-error swallowing (koda also caught) + flag-parsing/jq edge minors.
- **d10 worktree exclusions**: lynx uniquely proved AGENTS.md's "eslint respects .gitignore" is false (flat config needs explicit ignores; none added) — a codified-false-invariant catch. koda/onyx: hedged .gitignore confirm-notes.
- **d04, d07**: lynx d04 + d07, onyx d07 + d10 delivered no review (exploration rabbit hole). onyx d04/d09: 420s provider timeouts ×2.

## Scores (rubric: TP weighted blocking=3/major=2/minor=1; FP ×3 penalty; actionability & format 1–5)
| Contender | TP (wtd) | FP (penalized) | Net | Actionability | Format | Delivery |
|---|---|---|---|---|---|---|
| lynx (space-bunny) | 41 | 9 | **+32** | 5 | 4 | 8/10 |
| onyx (glm-5.3-flash) | 34 | 4 | **+30** | 5 | 5 | 6/10 |
| koda (nemotron-3.5-super-vl) | 21 | 12 | **+9** | 4 | 3 | 10/10 |

FP notes: lynx's penalty comes from overstated conditionals it then hedged (matrix.platform premise false but flagged "confirm"; injection claim speculative); koda's from one unhedged hallucinated major + weak test claims; onyx's from one wrong sub-detail (canonical header claim) on an otherwise-true finding.

## Decision (guide §17 rule: blocking caught − false alarms, tie-break $/run)
1. **space-bunny-free** — wins on depth and true-positive density at the fastest wall time; ship-stopper caveats: ~20% no-delivery when it wanders (mitigate: repo present in real sessions; consider a read-only agent profile for unattended runs), and treat "blocking" claims as verify-first.
2. **glm-5.3-flash-free** — near-equal depth, best calibration and format; killed by provider timeouts on medium diffs (2×420s DNF) — use with a hard client timeout + retry, or as second opinion.
3. **nemotron-3.5-super-vl-free** — most reliable delivery, shallowest signal, one hallucinated major — fine generalist, not the reviewer pick.

Pin recommendation: reviewer/security-reviewer → `opencode/space-bunny-free`; researcher/main fallback → `opencode/nemotron-3.5-super-vl-free` or `opencode/glm-5.3-flash-free`. Spark-1.3-contributor via OR is dead under current privacy settings regardless of quality.
