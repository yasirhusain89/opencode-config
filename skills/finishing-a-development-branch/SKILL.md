---
name: finishing-a-development-branch
description: "Use when implementation is complete and tests pass, to decide how the work lands: merge locally, open a PR, or keep the branch. Verifies the suite, presents the menu, executes the choice, cleans up. Examples: \"wrap this up\", \"how should this land\", \"finish the branch\""
---

# Finishing a Development Branch

Ported from obra/superpowers (MIT), adapted: PR execution defers to
`gh-workflow`; merge/push approvals defer to the permission block and the
`github-safety` plugin.

## When to Use

Implementation done, suite green, work sits on a feature branch or
worktree. Not before: failing suite → fix first, menu after.

## Workflow

**1. Verify tests.** Run the full suite on this tree (`test-runner`). Red →
report failures and stop. A green run only proves the tree it ran on.

**2. Detect environment + base.** `GIT_DIR` vs `GIT_COMMON` (same commands
as `using-git-worktrees`): normal repo, named-branch worktree, or detached
HEAD (externally managed — no local merge option). Confirm the base branch
it forked from — merging into the wrong base is expensive to undo.

**3. Present the menu — integration is the user's decision, never assumed:**
```
Implementation complete. What would you like to do?
1. Merge back to <base> locally
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)
```
Detached HEAD: options 2–3 only. Discard exists solely on explicit "throw
it away" — confirm with typed `discard`, never infer it.

**4. Execute.**
- *Merge:* from main-repo root, checkout base, pull, merge, re-run tests
  on the merged result. Red → stop, everything stays put, investigate.
  Green → remove worktree (from outside it), `git branch -d`.
- *PR:* push branch, create via `gh-workflow` (repo PR template,
  Conventional Commits title), report URL. Keep the worktree for feedback.
- *Keep:* report branch name + worktree path, stop.
- *Discard (explicit only):* list branch, commits, path; typed `discard`;
  remove worktree, `git branch -D`.

**5. Cleanup rules.** Only `.worktrees/`/`worktrees/` you created. Removal
refused (uncommitted-only files)? Never `--force` — show the files, offer
commit / move / delete, then proceed. Foreign workspaces stay untouched.
Never force-push to fix a rejected push — remote moved; investigate, and
force only on explicit request.
