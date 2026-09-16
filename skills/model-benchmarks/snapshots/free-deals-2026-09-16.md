# Free top-tier models by provider + good deals — snapshot 2026-09-16

Companion to `access-2026-09-16.json` (full CLI catalogs) and
`agentic-table-2026-09-16.md`. "Top-tier" = strongest freely available
pick per provider, with AA signal where it exists. Free tiers change fast:
no-card/no-expiry claims must be re-verified each sweep (check the date).

## Free ($0) top-tier by provider

| Provider | Free top-tier pick(s) | AA signal | Terms / limits |
|---|---|---|---|
| opencode (Zen) | `muse-spark-1.3-contributor-free` | Eng 49, Intel 48, CAI 54, DeepSWE 72 | limited-time; trains Meta models |
| opencode (Zen) | `nemotron-3-ultra-free` | Intel ~48; Eng/CAI unknown | limited-time; NVIDIA trial terms, logged, no confidential data |
| opencode (Zen) | `nemotron-3.5-lightning-free` | unevaluated (speed tier) | same trial terms |
| opencode (Zen) | `mimo-v2.5-free` | base Intel 22 OR Pro 43/Eng 29 (variant ambiguous) | trains on data; verify served variant |
| opencode (Zen) | `ling-3.0-flash-fin-free` | finance-tuned; general Intel ~mid-30s | trains on data; finance niche only |
| opencode (Zen) | `big-pickle` | stealth, zero data | trains on data; sandbox only |
| NVIDIA (nvapi trial credits) | `deepseek-v4-pro-0813`, `kimi-k3`, `qwen3-coder-480b`, `minimax-m3`, `qwen3.5-397b`, `gpt-oss-120b`, `mistral-large-3-...` | Pro Eng 37/CAI 43; Kimi Eng 43/CAI 52; M3 Eng 32; oss-120b Intel ~33 | trial credits, rate-limited; verify allowance in console |
| OpenRouter `:free` | `nvidia/nemotron-3-ultra-550b-a55b:free`, `-super-120b:free`, `-3.5-lightning:free`, `google/gemma-4-31b-it:free` (Intel 39.2), `thinkingmachines/inkling-small:free` (Eng 29), `inclusionai/ling-3.0-flash-fin:free` | as above | rate-limited, routed, variable speed/ZDR; require `tools` support (rejects `z-ai/glm-5.2:free`: no tools, 32K ctx) |
| Z.ai direct | `GLM-4.7-Flash` (~200K, coding-tuned), `GLM-4.5-Flash`, `GLM-4.6V-Flash` | older 4.x gen, no current AA data | permanent $0, no card, ~1 req/s (observed); NOT 5.x models |
| Groq | `gpt-oss-120b/20b`, `qwen3.6/3.8-27b` | oss-120b Intel ~33 | ongoing, no card, ~8K TPM — low-volume agents only |
| Google AI Studio | Gemini Flash tier (verify model list in console) | Flash-Lite 366 tps, Eng off-chart | free tokens, modest quota, trains on data |
| GitHub Models | full catalog, throttled | — | Low tier 15 RPM/150 RPD, 8K in per req — prototyping only, diffs won't fit |
| Ollama local | `qwen3.8:latest` | family Eng ~40 (giant MoE variants; local quant differs) | free, private, hardware-bound |
| Excluded | Cerebras (no permanent free tier: $5/30-day trial + card); Hugging Face ($0.10/mo credits ≈ nothing for agents) | — | — |

## Good deals (paid, cheap)

| Deal | Price $/1M in/out | Signal | Catch |
|---|---|---|---|
| Zen DeepSeek V4 Flash | $0.14 / $0.28 | Eng-35 family; CAI Flash 39 | 3× below first-party; needs Zen billing |
| Zen GLM-5.3-Flash | $0.15 / $0.50 | Eng 44 | cheapest current-gen; no agentic data |
| Zen GPT-5.6 Luna | $0.20 / $1.20 | Eng 36, $0.18/task | 50% off ends 2026-09-18, then doubles |
| Zen Qwen3.5 Plus | $0.20 / $1.20 | unevaluated on AA | trial only |
| Zen MiniMax M3 / M2.7 | $0.30 / $1.20 | M3 Eng 32 | — |
| Zen Kimi K2.7 Code | $0.95 / $4.00 | Eng 30 | — |
| Zen paid Muse Spark 1.3 | $1.25 / $4.25 | Eng 49, DeepSWE 72 | zero-retention vs contributor terms |
| Z.ai GLM Coding Plan | ~$18/mo Lite (80 prompts/5h, 400/wk) | flagship GLM-5.2/5.3 access | subscription; compatible IDE/CLI tools only |

## Agent mapping (free → deal)

- researcher: free → `nemotron-3-ultra-free` trial (Intel 48, Eng unknown)
  or Z.ai `GLM-4.7-Flash` $0 (coding-tuned, ~200K); deal → Zen
  GLM-5.3-Flash / Luna.
- reviewer: free → NVIDIA-trial `deepseek-v4-pro-0813` ($0.24/task equiv,
  best free value); deal → Zen DeepSeek V4 Flash $0.14/$0.28.
- security-reviewer: free → Spark contributor-free (accept training
  terms) else paid Spark $1.25/$4.25 (DeepSWE 72, zero-retention).
- docs-writer / domain-companion: Groq `gpt-oss-120b` free, Google free
  tier, or Z.ai `GLM-4.5-Flash` $0 — quality bar is low, latency/price rule.
