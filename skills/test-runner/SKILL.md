---
name: test-runner
description: "Use when the user asks to run tests, verify a change, or fix failing tests. Detects the stack, runs the minimal relevant suite first, parses failures, and iterates a bounded fix loop. Examples: \"run the tests\", \"verify this change\", \"fix the failing tests\""
---

# Test Runner

## When to Use

- "Run the tests" / "run the test suite"
- "Verify this change" after an edit
- "Fix the failing tests"

## Decision tree (detect stack, cheapest gate first)

| Signal | Command |
| :--- | :--- |
| `package.json` scripts | `npm run <test\|check>` / `npx svelte-check` — never install new deps without asking |
| `Cargo.toml` | `cargo test <filter>` |
| `pytest.ini` / `pyproject.toml` / `uv.lock` | `uv run pytest <path> -x -q` |
| No suite found | Report how to add one and stop — do not invent tests |

## Workflow

1. **Fastest relevant gate first:** typecheck/lint, then targeted tests covering the changed files, then the broader suite only if it runs in ~2 minutes or less — otherwise ask before running it all.
2. **On failure:** extract the failing test names plus the first error lines (quote them verbatim, never paraphrase). Fix, re-run the failing subset.
3. **Bound the loop:** max 3 fix attempts. Still red → stop and report: failing cases, exact output, and what was tried. Never delete or weaken snapshots/assertions to turn red green without explicit approval.
4. **Report:** pass/fail counts, the exact failing cases (if any), and which files the fix touched. Never commit as part of testing.

## Example

```
$ uv run pytest tests/test_import.py -x -q
FAILED tests/test_import.py::test_signed_amounts - assert -50.0 == 50.0
→ fix normalization in importer.py, re-run subset → 12 passed
```
