---
name: verification-before-completion
description: "Use when about to claim work is complete, fixed, or passing, before committing or creating PRs. Requires running verification commands and confirming output first — evidence before assertions, always. Examples: \"this is done\", \"fixed\", \"tests pass\", \"ready to commit\""
---

# Verification Before Completion

Ported from obra/superpowers (MIT). This is the operating constitution's
verify mandate expanded into a gate: **evidence before claims, always.**

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command in this session, you cannot
claim it passes.

## The gate

Before claiming any status or expressing satisfaction:

1. **IDENTIFY:** what command proves this claim?
2. **RUN:** the full command, fresh — not a previous run, not a subset.
3. **READ:** full output, exit code, failure count.
4. **VERIFY:** does the output confirm the claim? No → state actual status
   with evidence. Yes → state the claim WITH evidence.
5. Only then: make the claim.

Skip any step and it's assertion, not verification.

## Claim table

| Claim | Requires | Not sufficient |
| :--- | :--- | :--- |
| Tests pass | Test output: 0 failures | Earlier run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build exit 0 | Linter green, logs look fine |
| Bug fixed | Original symptom re-tested: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | Passes once |
| Subagent done | VCS diff shows the changes | Agent reported "success" |
| Requirements met | Line-by-line checklist | Tests passing |

## Regression tests (TDD red-green)

Write → run (pass) → revert fix → run (**must fail**) → restore → run
(pass). A regression test without verified red proves nothing.

## Red flags (stop)

"Should", "probably", "seems to". Satisfaction before evidence
("Great!", "Done!"). About to commit/PR/testify without running.
Trusting a subagent's success report — check the diff yourself. Fatigue,
"just this once", partial checks, reworded claims. Tired is not an
exception.
