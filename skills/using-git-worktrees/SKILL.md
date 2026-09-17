---
name: using-git-worktrees
description: "Use when starting feature work that needs isolation from the current workspace, or before executing an implementation plan. Sets up an isolated worktree and verifies a clean test baseline. Examples: \"start this feature isolated\", \"set up a worktree\", \"begin the plan\""
---

# Using Git Worktrees

Ported from obra/superpowers (MIT), adapted: no native worktree tool in
this harness, so git worktrees are the mechanism; GitNexus calls take the
`worktree` path (see `gitnexus-refactoring` worktree notes).

## When to Use

Feature work that must not disturb the current branch, parallel efforts,
or plan execution. Ask consent before creating ("Isolated worktree? It
protects your current branch.") unless a preference is already declared.

## Workflow

**0. Detect isolation first** — never eyeball it:
```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
```
- `GIT_DIR != GIT_COMMON` + not a submodule (`git rev-parse
  --show-superproject-working-tree` empty) → already in a linked
  worktree: skip creation. Detached HEAD = externally managed; branch
  creation waits for finish time.
- Otherwise → normal checkout: proceed.

**1. Create.** Prefer existing `.worktrees/` (else `worktrees/`, else create
`.worktrees/`). Verify ignored first: `git check-ignore -q .worktrees` —
if not, add to `.gitignore` and commit that first (never commit a tree
into the repo). Then `git worktree add <path> -b <branch>`. Permission
denied → say so, work in place.

**2. Set up.** Auto-detect and install: `package.json` → npm install;
`Cargo.toml` → cargo build; `pyproject.toml`/uv → per repo docs (MonArtha:
uv-managed — never raw pip).

**3. Clean baseline.** Run the suite (`test-runner` for stack detection).
Failing baseline → report and ask whether to proceed; a dirty baseline
makes every later failure ambiguous. Passing → report path, test count,
readiness.

## Rules

- Pass `worktree` to GitNexus `detect_changes` when editing a linked
  worktree the MCP server wasn't launched from — otherwise the diff runs
  in the wrong checkout and reads as falsely clean.
- Never `--force` worktree removal; uncommitted-only files are shown to
  the user first (see `finishing-a-development-branch`).
