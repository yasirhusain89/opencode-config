# Agentic coding benchmarks — snapshot 2026-09-16

Source: `snapshots/coding-index-2026-09-16.json`, scraped from
`artificialanalysis.ai/agents/coding-agents` (Coding Agent Index v1.5)
via `node scripts/aa_bench.mjs coding`.
Refresh, then update the embedded table in `SKILL.md`.

Composite = equal weight of DeepSWE v1.1 (113 Datacurve SWE tasks),
Terminal-Bench 4.0 (66 Laude terminal-use tasks), SWE-Atlas-QnA (124
Scale AI technical-QA tasks). Scores are **model×harness** — a score earned
on one harness transfers to opencode agents only approximately.

| Setup (harness + model) | Index | DeepSWE | T-Bench | QnA | $/task | time |
|---|---|---|---|---|---|---|
| Claude Code Fable 5.1 (max, fallback) | 62 | 64 | 58 | 65 | $12.40 | 34.8m |
| Codex GPT-6 Astra (max) | 62 | 68 | 56 | 62 | $7.47 | 29.4m |
| Claude Code Opus 5 (max) | 60 | 63 | 55 | 62 | $10.80 | 41.9m |
| Muse Code Muse Spark 1.3 (max) | 54 | 72 | 32 | 59 | $3.98 | 18.4m |
| Opencode GLM-5.3 (max effort) | 54 | 61 | 40 | 59 | $4.24 | 48.1m |
| Kimi Code CLI Kimi K3 | 52 | 68 | 21 | 66 | $5.05 | 1.0h |
| Grok Build Grok 4.6 (xhigh) | 47 | 65 | 18 | 58 | $3.57 | 19.5m |
| Claude Code Qwen3.8 Max | 43 | 51 | 17 | 62 | $3.48 | 1.1h |
| Codex DeepSeek V4 Pro 0813 (max) | 43 | 57 | 10 | 62 | $0.24 | 40.3m |
| Antigravity Gemini 3.8 Flash (high) | 42 | 66 | 15 | 45 | $2.47 | 11.7m |
| Codex DeepSeek V4 Flash 0731 (max) | ~39* | 54 | 11 | 51 | — | — |
| Codex GPT-5.6 Sol (max) | — | 72 | 37 | 54 | — | — |

Notes:

- `*` DS Flash composite ~39 inferred from full-chart rank order (value in
  footnote only — never present it as measured).
- Sol composite/cost/time not published in highlights; DeepSWE 72 noted
  for the watchlist.
- Not on this leaderboard (no agentic data): DeepSeek V4.1 Flash,
  GLM-5.3-Flash, Nemotron 3 Ultra/Super, Gemma 4, Sonnet 5, GPT-5.6 Luna,
  Qwen3.5 Plus, MiniMax M3, Kimi K2.7 — never read absence as weakness.
- Role mapping: DeepSWE ≈ reviewer work, Terminal-Bench ≈ researcher
  work, QnA ≈ technical QA.
