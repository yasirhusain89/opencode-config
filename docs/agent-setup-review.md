# OpenCode Agent Setup: Architectural Review, Effort Calibration & SOTA Comparison

**Author:** Yasir Husain & Antigravity  
**Date:** September 2026  
**Scope:** `~/.config/opencode` (Global OpenCode Configuration, Agents, Skills, and Plugins)

---

## Executive Summary

The OpenCode agent configuration in this repository represents an advanced, high-capability developer harness. Notably, the integration of **GitNexus** (graph intelligence, AST navigation, and statement-level program dependence graphs) together with **zvec-grep** (hybrid semantic and lexical retrieval) places this environment in the upper tier of agentic harnesses for codebase grounding and impact analysis.

However, a rigorous audit reveals several operational disconnects, uncalibrated reasoning budgets, and an instruction vacuum in the global agent constitution:
1. **Safety Interceptors are Inactive:** TypeScript plugins for secret protection (`secret-guard.ts`) and destructive git safeguards (`github-safety.ts`) exist in the repository but were never registered in `opencode.jsonc`.
2. **Global Agent Constitution is Lacking:** `AGENTS.md` is loaded into every session but contains only zvec-grep retrieval routing. It lacks operational tenets (Think $\to$ Plan $\to$ Act $\to$ Verify), code editing hygiene, and verification mandates.
3. **Reasoning & Step Budget Bottlenecks:** Agents are constrained to rigid, low step limits (15–25 steps), which prematurely abort multi-step graph traversals. None of the agents take advantage of dynamic reasoning/thinking parameters, and fixed temperatures on reasoning endpoints degrade thinking trajectories.
4. **Missing Verification Persona:** While specialized review and research agents exist, there is no automated verification subagent to execute test suites, parse stack traces, and isolate minimal repro steps.

---

## 1. Deep-Dive Audit of Current Architecture

### 1.1 Configuration (`opencode.jsonc`)

- **Unregistered Plugins:**
  `plugins/secret-guard.ts` and `plugins/github-safety.ts` define interceptors using `@opencode-ai/plugin` hooks (`tool.execute.before`). However, `opencode.jsonc` lacks the `"plugin"` array. Consequently, these protections are dormant.
- **Top-Level Model Omission:**
  `opencode.jsonc` specifies `"small_model": "opencode/muse-spark-1.3-contributor-free"`, but lacks a root `"model"` key. Primary interactive sessions rely on unpinned defaults or CLI session state rather than a declared primary model.
- **Provider Explicit Declarations:**
  Agent files explicitly call `nvidia/deepseek-ai/deepseek-v4-pro` and `deepseek-v4-flash`, yet `provider` only lists `ollama`. Ensuring explicit fallback or authentication documentation prevents breakage across new machine clones.
- **MCP Timeout Ceiling:**
  MCP timeouts are set to 600,000ms (10 minutes). While beneficial during initial deep PDG graph builds, hanging processes will lock the agent loop for 10 minutes without intermediate diagnostics.

### 1.2 Global Agent Instructions (`AGENTS.md`)

- **Scope Limitation:**
  `AGENTS.md` currently acts solely as a manual for `zvec-grep`.
- **Missing Directives:**
  - *Zero Hallucination Standard:* Mandatory source verification prior to stating assumptions or altering APIs.
  - *Surgical Diff Principle:* Prohibition of unsolicited reformatting, stylistic churn, or out-of-scope refactoring.
  - *Plan-Before-Act Threshold:* Criteria for when the agent must stop and present a plan (e.g., changes modifying $>2$ files, schema migrations, or public API modifications).
  - *Verification Mandate:* Automated execution of tests, builds, or linters prior to declaring task completion.

### 1.3 Agent Personas (`agent/*.md`)

- **Step Caps vs. Graph Overhead:**
  - `reviewer.md`: 25 steps. GitNexus calls (`detect_changes` $\to$ `impact` $\to$ `context` $\to$ source inspection) routinely consume 10–16 steps, leaving insufficient room for deep analysis.
  - `security-reviewer.md`: 25 steps. Tracing tainted inputs across IPC boundaries requires wide traversal.
  - `researcher.md`: 25 steps. Architecture surveys require hypothesis testing across deep call chains.
- **Temperature on Reasoning Endpoints:**
  `temperature: 0.2` is hardcoded across analytical agents. For reasoning/thinking models (e.g., DeepSeek R1/V4, Claude 3.7 with extended thinking, OpenAI o-series), explicit temperature overrides can conflict with reasoning token generation or cause provider API errors.

---

## 2. Effort, Thinking & Model Allocation Strategy

Modern frontier agent architectures decouple token speed from cognitive effort. Tasks must be mapped to appropriate reasoning budgets:

| Agent Persona | Role Profile | Recommended Model Class | Step Budget | Thinking / Effort Budget | Rationale |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`security-reviewer`** | Taint tracking, auth boundaries, vulnerability hunt | Frontier Reasoning (e.g. DeepSeek V4 Pro, Claude 3.7 Sonnet) | 45 | **Max / High** | Prevents false negatives; allows full chain-of-thought exploration of exploit vectors. |
| **`reviewer`** | Blast radius analysis, regressions, invariants | Frontier Reasoning | 40 | **High** | Correlates graph impact with semantic diffs and verifies test coverage completeness. |
| **`researcher`** | Flow tracing, architecture discovery | Frontier Reasoning / Fast Thinking | 50 | **Medium** | Needs breadth and step budget over deep single-prompt reasoning. |
| **`domain-companion`** | Domain modeling (finance math, UI UX patterns) | Frontier Fast / Balanced | 25 | **Medium** | Mathematical edge cases (FIFO lots, tax brackets) require verification scratchpads. |
| **`docs-writer`** | Code documentation, Markdown sync | Fast Flash (e.g. DeepSeek V4 Flash) | 20 | **None / Minimal** | Pure extraction and summarization; thinking tokens add latency without value. |
| **`verifier`** *(New)* | Build execution, test runner, failure isolation | Fast Balanced / Tool Specialist | 30 | **Low / Medium** | Interprets compiler/test diagnostics, extracts tracebacks, runs targeted repros. |

---

## 3. Comparison with State-of-the-Art (SOTA) Agent Setups

A comparison between this setup and leading production harnesses (Antigravity 2.0 / Google AAC, Anthropic Claude Code, and SOTA SWE-Agents):

```
+-----------------------------------------------------------------------------+
|                            SOTA COMPARISON MATRIX                            |
+--------------------------+---------------------+----------------------------+
| DIMENSION                | CURRENT SETUP       | SOTA INDUSTRY BENCHMARK    |
+--------------------------+---------------------+----------------------------+
| 1. Codebase Grounding    | Grade: A+           | Grade: B+                  |
|    & Graph Intelligence  | GitNexus AST/PDG +  | Mostly vector embeddings + |
|                          | zvec-grep hybrid    | ripgrep/ctags symbol tags  |
+--------------------------+---------------------+----------------------------+
| 2. Safety Interceptors   | Grade: D+           | Grade: A                   |
|    & Guardrails          | Unregistered TS     | Pre-tool hooks, container  |
|                          | plugins; basic      | seatbelts, strict write    |
|                          | permission strings  | path authorization         |
+--------------------------+---------------------+----------------------------+
| 3. Extended Reasoning &  | Grade: C            | Grade: A                   |
|    Thinking Budgets      | Fixed temp: 0.2; no | Dynamic thinking budgets   |
|                          | reasoning params    | based on task complexity   |
+--------------------------+---------------------+----------------------------+
| 4. Execution Loop &      | Grade: C-           | Grade: A+                  |
|    Verification Gates    | Agent stops after   | Deterministic loop: Edit   |
|                          | editing; no tests   | -> Lint -> Test -> Re-try  |
+--------------------------+---------------------+----------------------------+
| 5. Planning Architecture | Grade: B            | Grade: A                   |
|                          | GitNexus-plan has   | Automated two-phase gating |
|                          | ledger spec, but is | (Plan mode vs. Act mode)   |
|                          | decoupled & manual  | on complex tasks           |
+--------------------------+---------------------+----------------------------+
| 6. Context Hygiene       | Grade: B+           | Grade: A-                  |
|    & Snippet Management  | Bounded zvec-grep   | Windowed AST slices and    |
|                          | snippets; minimal   | rolling compaction         |
|                          | redundant reading   |                            |
+--------------------------+---------------------+----------------------------+
```

### Key Insights:
- **Your Edge:** The codebase knowledge layer (GitNexus + zvec-grep) is exceptional and exceeds standard commercial tooling. It provides deterministic statement-level dependencies that vector search alone cannot match.
- **Your Opportunity:** Hardening runtime safety (activating plugins), embedding a strict verification feedback loop, and giving analytical agents enough step runway and reasoning budget to finish deep investigations.

---

## 4. Architectural Roadmap & Implementation Blueprint

### Phase 1: Configuration & Runtime Hardening
1. **Register Plugins in `opencode.jsonc`:**
   ```jsonc
   "plugin": [
     "./plugins/secret-guard.ts",
     "./plugins/github-safety.ts"
   ],
   ```
2. **Define Top-Level Model:**
   Set `"model": "nvidia/deepseek-ai/deepseek-v4-pro"` in `opencode.jsonc`.
3. **Module Compatibility:**
   Add `export default` alongside named exports in `plugins/*.ts` to guarantee clean loading by the plugin runner.

### Phase 2: System Operating Constitution
Expand `AGENTS.md` with:
- **Core Engineering Principles:** Grounding in actual files, minimal diff footprint, no assumption of external APIs.
- **Two-Phase Planning Threshold:** Require explicit plan and confirmation for multi-file alterations or structural refactors.
- **Verification Requirement:** Mandatory compilation/test check before closing an issue.
- **Preserved Retrieval Section:** Retain the `<!-- ZVEC_GREP_START -->` block intact.

### Phase 3: Agent Parameter & Step Tuning
- Adjust `steps` to 40–50 for `reviewer`, `security-reviewer`, and `researcher`.
- Remove conflicting `temperature: 0.2` configurations on reasoning models.
- Introduce `agent/verifier.md` as a subagent dedicated to running tests and providing concise diagnostic failure context.

---

## 5. Final implementation (2026-09-16) — what actually shipped

Independent verification against `https://opencode.ai/docs/*` and live `opencode debug config` / `opencode run` tests found the audit ~70% correct with three load-bearing errors. Corrections applied below; this section is the authoritative record.

| # | Review claim | Decision | Rationale / evidence |
| :--- | :--- | :--- | :--- |
| 1 | Plugins dormant; add `"plugin": ["./plugins/..."]`; add `export default` | **REJECTED** | Per `/docs/plugins/`, files in `~/.config/opencode/plugins/` **auto-load**; the `plugin` array is for npm specs (explicit local paths redundant). Named exports match the docs example exactly. Safety re-graded **B-**, not D+ (permission block + active hooks). No config change; `plugins/` row added to `README.md` instead. |
| 2 | Missing top-level `model` | **ACCEPTED, different value** | Set to `opencode/muse-spark-1.3-contributor-free` (cheap default), **not** `deepseek-v4-pro` — pinning every session to a frontier reasoning model would maximize cost/latency. Pro/Flash overrides stayed per-agent until §8. |
| 3 | `temperature: 0.2` breaks reasoning models | **REJECTED as stated** | Valid for DeepSeek-V4; docs bless 0.0–0.2 for analysis. Kept on all analytical agents. Real gap was the unimplementable Max/High/Medium thinking table (actual knobs are provider-specific `reasoningEffort` / `thinking.budgetTokens`) — not added under the single-model setup. |
| 4 | Steps 15–25 abort graph traversals | **ACCEPTED, tuned down** | `reviewer` 25→**35**, `researcher`/`security-reviewer` 25→**40** (not 40–50 across the board); `docs-writer`/`domain-companion` stay 15. Verified in `debug config`. |
| 5 | `AGENTS.md` is zvec-only | **ACCEPTED, minimal** | 5-line operating constitution prepended (grounding, surgical diffs, plan threshold >2 files, verify, prefer edits). `ZVEC_GREP` block byte-intact — full thresholds stay in the `gitnexus-work` skill to avoid taxing every session's context. |
| 6 | Missing verifier subagent | **DEFERRED** | Built-in `general` already runs tests; revisit only if the gap is felt. |
| 7 | (Missed) singular `agent/`/`command/` dirs | **REJECTED rename** | Skill + back-compat note confirm both forms load; all 5 agents resolve in `debug config`. Rename is churn against the PyCharm symlink setup. |
| 8 | All-muse-1.3 default | **ACCEPTED** | `model` + `small_model` + all 5 agents pinned to `opencode/muse-spark-1.3-contributor-free`; `README.md` auth section simplified to one gateway login. |
| 9 | MCP 600s ceiling | **ACCEPTED, split** | `gitnexus` stays 600s (initial PDG builds), `zvec_grep` → 60s. |
| 10 | Quota backup | **ACCEPTED — 1.2 primary** | `muse-spark-1.2-contributor-free` verified live (`backup-ok`, clean exit). No auto-failover exists: 1.3 quota death = session error → switch via `/models` or `OPENCODE_CONFIG_CONTENT` override (must include `small_model`; procedure in `opencode.jsonc:3-11` + `README.md`). Incidental bugfix: Ollama `qwen3.8` limit was 262k ctx → 32k (was forcing a ~19GB KV reload stall); kept as offline last resort with its `compaction:auto=false` caveat. |
| 11 | (Missed) README drift | **FIXED** | 13→14 skills (`model-benchmarks` uncounted), plugin auto-load row, step budgets, gateway auth note. |

**Verification evidence (2026-09-16):** `opencode debug config` parses with all 7 model slots on muse-spark-1.3; `opencode run` returns `ok`/`backup-ok` on 1.3, 1.2, and ollama paths; `git diff` confirms the zvec block untouched and the change footprint limited to `opencode.jsonc`, `AGENTS.md`, `agent/*`, `README.md` (+ this doc).
