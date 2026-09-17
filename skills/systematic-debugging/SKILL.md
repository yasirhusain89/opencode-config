---
name: systematic-debugging
description: "Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes. Enforces root-cause-first investigation in four phases. Examples: \"why is this failing\", \"find the root cause\", \"debug this\""
---

# Systematic Debugging

Ported from obra/superpowers (MIT), adapted: graph tracing defers to
GitNexus (`trace`, `query`, `pdg_query` flows); test discipline to
`test-driven-development`; completion gates to
`verification-before-completion`.

## When to Use

Any technical issue — especially under time pressure, when a "quick fix"
looks obvious, after multiple failed attempts, or when you don't fully
understand the issue yet. Simple bugs have root causes too.

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

## Phase 1: Root cause investigation

1. **Read errors fully** — stack traces, line numbers, codes. They often
   contain the solution.
2. **Reproduce consistently** — exact steps, every time? Not reproducible →
   gather data, don't guess.
3. **Check recent changes** — `git diff`, recent commits, new deps, env drift.
4. **Multi-component systems** (CI → build → signing, client → bridge →
   server): instrument each boundary (log what enters/exits), run once, see
   WHERE it breaks before investigating further.
5. **Trace data flow backward** — where does the bad value originate? What
   called this with it? Fix at source, not symptom. Use `trace` /
   `pdg_query` (flows mode) for call-chain and intra-function tracing.

## Phase 2: Pattern analysis

Find working code similar to the broken code. Read the reference completely
— don't skim. List every difference, however small; don't assume "that
can't matter". Check dependencies, config, and assumptions.

## Phase 3: Hypothesis and testing

One written hypothesis: "I think X is the root cause because Y." Smallest
possible test of it, one variable at a time. Failed? New hypothesis — never
stack fixes. Genuinely stuck? Say "I don't understand X" and ask or
research.

## Phase 4: Implementation

1. Failing reproduction test first (`test-driven-development`).
2. Single fix, no bundled refactoring or "while I'm here".
3. Verify: test passes, nothing else broke, symptom gone
   (`verification-before-completion`).
4. Fix #3 failed? **Stop fixing and question the architecture** — recurring
   new symptoms in new places mean a wrong pattern, not a wrong line.
   Discuss with the user before any Fix #4.

## Red flags (all mean: stop, return to Phase 1)

"Quick fix for now", "just try X", multiple simultaneous changes, "it's
probably X", proposing before tracing, "one more attempt" after 2+
failures, assuming without verifying.

## Quick reference

| Phase | Activity | Done when |
| :--- | :--- | :--- |
| 1. Root cause | Errors, repro, changes, evidence | You know WHAT and WHY |
| 2. Pattern | Working example vs broken | Differences listed |
| 3. Hypothesis | One theory, minimal test | Confirmed or replaced |
| 4. Implementation | Test, single fix, verify | Green suite, symptom gone |
