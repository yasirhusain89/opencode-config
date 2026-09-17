---
name: test-driven-development
description: "Use when implementing any feature or bugfix, before writing implementation code. Enforces RED-GREEN-REFACTOR: failing test first, minimal code, refactor green. Examples: \"implement this with TDD\", \"write the test first\", \"fix this bug\""
---

# Test-Driven Development

Ported from obra/superpowers (MIT), adapted for this harness: stack
detection defers to `test-runner`; root-cause tracing to
`systematic-debugging`.

## When to Use

Always: new features, bug fixes, refactoring, behavior changes.
Exceptions (ask first): throwaway prototypes, generated code, config files.

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Wrote code before the test? Delete it — no "keep as reference", no
adapting while testing. Start over from the test.

**Core principle:** if you didn't watch the test fail, you don't know if
it tests the right thing.

## Red-Green-Refactor

**RED — one minimal failing test.** One behavior, clear name, real code
(no mocks unless unavoidable). Then **verify RED (mandatory):** run it,
confirm it *fails* (not errors) for the expected reason — feature missing,
not a typo. Passes immediately? You're testing existing behavior; fix the
test.

**GREEN — minimal code.** Simplest thing that passes. No new features, no
drive-by refactoring, no "improvements". Then **verify GREEN (mandatory):**
test passes, all other tests still pass, output pristine. Fails? Fix the
code, never the test.

**REFACTOR — green only.** Remove duplication, improve names, extract
helpers. Stay green, add no behavior. Then repeat for the next behavior.

Run tests via `test-runner` (stack-aware: `uv run pytest`, `cargo test`,
`npm run`, `svelte-check`).

## Good tests

| Quality | Good | Bad |
| :--- | :--- | :--- |
| Minimal | One thing ("and" in the name? split it) | `validates email and domain and whitespace` |
| Clear | Name describes behavior | `test1` |
| Honest | Asserts real behavior, real code | Asserts mock interactions |

## Rationalizations (all mean: delete code, start over)

- "Too simple to test" / "I'll test after" — tests-after answer "what does
  this do?", tests-first answer "what should this do?". After-the-fact tests
  pass immediately, which proves nothing.
- "Already manually tested" — ad-hoc, unrepeatable, edge cases forgotten.
- "Deleting hours of work is wasteful" — sunk cost; untrusted code is the waste.
- "Keep as reference" — you'll adapt it; that's testing after.
- "Need to explore first" — fine; throw the exploration away, then TDD.

## Verification checklist (before marking complete)

- [ ] Every new function/method has a test
- [ ] Watched each test fail first, for the expected reason
- [ ] Minimal code to green; full suite passes; output pristine
- [ ] Mocks only where unavoidable; edge cases covered

## Debugging integration

Bug found? Write the failing reproduction test first, then follow this
cycle. Never fix bugs without a test. For root-cause method, see
`systematic-debugging`.
