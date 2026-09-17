---
name: writing-skills
description: "Use when creating a new skill, editing an existing skill, or verifying a skill works before relying on it. Applies TDD to process docs: baseline failure first, then the doc, then compliance. Examples: \"create a skill\", \"write a skill for this\", \"test this skill\""
---

# Writing Skills

Ported from obra/superpowers (MIT), condensed. Prerequisite:
`test-driven-development` — this skill is TDD applied to documentation.

## When to Use

Create when: the technique wasn't obvious, you'll reuse it across
projects, it applies broadly, others benefit. Don't create for: one-offs,
well-documented standard practice, project conventions (those belong in
`AGENTS.md`), or anything enforceable by regex/validation (automate it —
docs are for judgment calls).

## TDD mapping

| TDD | Skills |
| :--- | :--- |
| Test case | Pressure scenario run with a subagent |
| RED | Agent violates the rule without the skill — document the exact rationalization |
| GREEN | Agent complies with the skill present |
| Refactor | Find new rationalizations → plug loopholes → re-verify |

Never write the doc first and declare victory: watch the baseline fail,
then prove compliance.

## House layout (opencode)

```
~/.config/opencode/skills/<name>/SKILL.md   (global; name == folder)
<repo>/.opencode/skills/<name>/SKILL.md     (project; travels with code)
```

- Flat namespace, one thing per skill. Heavy reference (100+ lines) or
  reusable scripts go in sibling files (`references/`, `scripts/` —
  scripts run `--help`-first, treated as black boxes); principles and
  patterns stay inline.
- Project-specific conventions go in the repo's `AGENTS.md`, not a skill.

## Frontmatter rules

- `name`: lowercase hyphens, matches folder, ≤64 chars.
- `description`: third person, triggers ONLY — "Use when…" with symptoms
  and contexts. Never summarize the process (that's what the body is for;
  process in the description wastes every session's context).
- Relevant siblings this repo follows: decision trees for non-obvious
  routing, checklists for multi-step flows, worked examples over abstract
  prose, file:line evidence style.

## Verify before relying on it

Fresh-session check: name resolves, description triggers on the intended
phrases and stays quiet on adjacent topics, scripts exit correctly.
`verification-before-completion` applies to skill work too.
