# Agent setup review — archived

Superseded. Full historical review (Sept 2026, plus the §5 authoritative
corrections record) now lives at `docs/archive/agent-setup-review.md`.

Current ground truth (Oct 2026):

- Agent pins come from the 2026-10-18 mini-eval (see
  `skills/model-benchmarks/snapshots/evals/2026-10-18/scorecard.md`):
  `reviewer` + `security-reviewer` → `opencode/space-bunny-free`,
  `researcher` → `opencode/nemotron-3.5-super-vl-free`.
  `muse-spark-1.3-contributor` is dropped as an agent model — the route is
  blocked by OpenRouter privacy guardrails (paid-training exclusion).
- Safety posture is plugins + permissions, not the D+ grade in §§1–4:
  `plugins/` (`secret-guard`, `github-safety`, `path-guard`, `disk-guard`)
  auto-load, backed by the `permission` block in `opencode.jsonc`.
- Live model/routing state: `skills/model-benchmarks/` (guide + snapshots +
  `snapshots/CHANGELOG.md`) and `skills/usage-dashboard/generate.py`
  (`TOP_MODELS`). Read those, not the archived grades.
