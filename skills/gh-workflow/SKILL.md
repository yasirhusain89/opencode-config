---
name: gh-workflow
description: "Use when the user asks to open a pull request, check CI status, or merge a PR. Drives the full branch → PR → checks → merge loop with gh, respecting harness safety gates. Examples: \"open a PR\", \"are checks green\", \"merge this PR\""
---

# GitHub Workflow

Complements `gitnexus-review` (which *reads* PRs) by *driving* them. Hard
safety rails come from the `github-safety` plugin and the permission block —
this skill tells you where they are, not how to dodge them.

## When to Use

- "Open a PR for this branch"
- "Are checks green / what's failing in CI"
- "Merge the PR"

## Decision tree

1. **Dirty tree or wrong branch?** `git status --porcelain`, `git branch --show-current`. Never PR from `main`; never sweep unrelated files in — stage only what's asked.
2. **Reviews first.** Run `gitnexus-review` on the diff before opening the PR. Fix blockers first.
3. **Merge only on explicit approval**, after green checks. No exceptions.

## Workflow

```
1. git fetch origin <base> && git pull --rebase --autostash origin <base>   (never --force)
2. git push -u origin <branch>                                              (needs approval per permission block)
3. gh pr create --title "<type(scope): subject>" --body "<what + why>"      (Conventional Commits subject; see commit-work)
4. gh pr checks --watch  →  gh pr view                                       (quote failures verbatim on red)
5. Red checks → fix, push, re-watch (max 3 rounds, then report and stop)
6. Green + user said merge → gh pr merge --squash|--merge (their pick; default ask)
```

## Hard rails (blocked by plugin — do not work around)

- `gh pr merge --auto`, `gh pr close`, `gh repo delete`, `gh release delete/upload --clobber`, `gh variable/secret delete`, `gh api -X DELETE` → refused. If one fires, tell the user the exact command to run manually.
- `gh variable set`, `cargo/npm publish`, `gh pr merge`, `gh release delete` → ask first even when not blocked.

## Example

```
$ git push -u origin feat/refresh-expiry
$ gh pr create --title "feat(auth): reject expired refresh tokens" --body "..."
→ PR #42 opened
$ gh pr checks --watch
→ 3/3 green → (user: "merge it") → gh pr merge --squash → merged
```
