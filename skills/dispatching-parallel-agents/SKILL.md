---
name: dispatching-parallel-agents
description: "Use when facing 2+ independent tasks with no shared state or ordering dependency: failing suites in different subsystems, parallel investigations, concurrent builds. Fans out one focused subagent per domain, then merges. Examples: \"fix these failures in parallel\", \"investigate both\", \"parallelize this\""
---

# Dispatching Parallel Agents

Ported from obra/superpowers (MIT), adapted: dispatch via the `Task` tool
(one call per agent, same block = parallel); subagents cannot spawn
further (`subagent_depth: 1`), so all fan-out happens here.

## When to Use

Multiple independent failures or investigations — different test files,
subsystems, bugs — each understandable without the others' context, no
shared files under edit. **Don't** use for related failures (fix one, may
fix others), full-system understanding, exploratory debugging, or shared
state (agents would collide).

## Workflow

**1. Group into independent domains** (by file, subsystem, symptom). If a
fix in one could fix another, they're one domain — investigate together.

**2. One focused brief per agent** — each prompt carries its full context
(they inherit nothing from your session):
- Specific scope (one file/subsystem) + clear goal
- Pasted error messages and failing test names
- Constraints ("don't touch production code" / "tests only")
- Exact return shape ("summary of root cause + what you changed")

Too broad ("fix all tests"), context-free ("fix the race"), unconstrained,
or vague-output briefs produce garbage — be specific or don't dispatch.

**3. Dispatch together.** All `Task` calls in one block run concurrently;
one per message runs sequentially. Match subagent to domain (`researcher`
for tracing, `general` for fixes).

**4. Merge.** Read every summary, check for conflicting edits to the same
files, run the full suite (`test-runner`), spot-check — agents make
systematic errors. Report the integrated result with per-domain outcomes.

## Example

```
3 failing suites, independent → one block:
  Task(researcher): "Trace auth-refresh failures in tests/auth.spec.ts: <errors>. Return chain + suspect lines."
  Task(general): "Fix parser edge cases in tests/import.spec.ts: <errors>. Tests only. Return root cause + diff."
→ merge summaries → full suite → report
```
