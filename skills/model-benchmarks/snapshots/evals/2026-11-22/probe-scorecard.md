# Stage 1 Mini-Eval Probe Scorecard — 2026-11-22

Protocol: 4 deterministic auto-graded micro-tasks (`P1 coding` 35 + `P2 bughunt` 35 + `P3 reasoning` 15 + `P4 agentic` 15 = 100 pts), isolated tool-deny config for P1–P3, sandboxed fixture read/grep for P4, `OPENCODE_MODEL_FALLBACK=off`.

| Model | Composite | Tier | P1 Coding (35) | P2 BugHunt (35) | P3 Logic (15) | P4 Agentic (15) | Delivery | p50 s | tok/s | Reas % |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `opencode/iceman-free` | **100** | Apex | 35 | 35 | 15 | 15 | 4/4 | 43.3s | 55.6 | 91% |
| `opencode-go/glm-5.3-flash` | **100** | Apex | 35 | 35 | 15 | 15 | 4/4 | 7.7s | 89.2 | 78% |
| `opencode/big-pickle` | **98** | Apex | 35 | 35 | 15 | 13 | 4/4 | 28.3s | 90.4 | 93% |
| `opencode-go/iceman-contributor-free` | **96** | Apex | 35 | 31 | 15 | 15 | 4/4 | 47.1s | 60 | 90% |
| `opencode/hy4-flash-free` | **96** | Apex | 35 | 31 | 15 | 15 | 4/4 | 22.7s | 163.9 | 94% |
| `opencode-go/kimi-k3.1-pro` | **90** | Apex | 35 | 25 | 15 | 15 | 4/4 | 23.3s | 89.9 | 90% |
| `opencode/mimo-v2.6-flash-free` | **86** | Apex | 35 | 21 | 15 | 15 | 4/4 | 23.7s | 94.5 | 86% |
| `opencode/flint-40b-free` | **72** | Workhorse | 35 | 31 | 0 | 6 | 3/4 | 61.4s | 67.6 | 0% |
| `opencode/longcat-2.5-free` | **71** | Workhorse | 35 | 21 | 0 | 15 | 3/4 | 30.8s | 60.4 | 89% |
| `opencode/tidepool-alpha-free` | **61** | Workhorse | 35 | 26 | 0 | 0 | 2/4 | 76.4s | 130.2 | 96% |

## Per-Model Breakdown

### `opencode/iceman-free` — 100/100 (Apex)
- **P1-coding** (35/35, 39.2s): PASS inclusive-bounds; PASS window-exclusion; PASS free-and-provider-filter; PASS error-exclusion; PASS dedup-first-wins; PASS overcap-and-pct; PASS fractional-pct; PASS empty-window; PASS oldest-expiry-unordered; PASS bymodel-sorted-normalized
- **P2-bughunt** (35/35, 43.3s): PASS format-compliance (+6); PASS caught-truncation-commit (+14); PASS caught-sql-injection (+10); PASS caught-timeout-unit-mismatch (+5); PASS zero-false-positives-on-decoy
- **P3-reasoning** (15/15, 101.9s): PASS minTotalSeconds=16 (+5); PASS commitOrder=A,B,C,E,D (+5); PASS minWriteBufferKiB=350 (+5)
- **P4-agentic** (15/15, 27.2s): PASS used-read-search-tools (grep, glob, grep, grep, read, read) (+5); PASS exact-root-cause (src/reconcile.mjs:23, >= -> >) (+6); PASS tool-discipline (6 steps, clean JSON) (+4)

### `opencode-go/glm-5.3-flash` — 100/100 (Apex)
- **P1-coding** (35/35, 5.9s): PASS inclusive-bounds; PASS window-exclusion; PASS free-and-provider-filter; PASS error-exclusion; PASS dedup-first-wins; PASS overcap-and-pct; PASS fractional-pct; PASS empty-window; PASS oldest-expiry-unordered; PASS bymodel-sorted-normalized
- **P2-bughunt** (35/35, 7.7s): PASS format-compliance (+6); PASS caught-truncation-commit (+14); PASS caught-sql-injection (+10); PASS caught-timeout-unit-mismatch (+5); PASS zero-false-positives-on-decoy
- **P3-reasoning** (15/15, 55.3s): PASS minTotalSeconds=16 (+5); PASS commitOrder=A,B,C,E,D (+5); PASS minWriteBufferKiB=350 (+5)
- **P4-agentic** (15/15, 6.3s): PASS used-read-search-tools (glob, read, read) (+5); PASS exact-root-cause (src/reconcile.mjs:23, >= -> >) (+6); PASS tool-discipline (3 steps, clean JSON) (+4)

### `opencode/big-pickle` — 98/100 (Apex)
- **P1-coding** (35/35, 17.9s): PASS inclusive-bounds; PASS window-exclusion; PASS free-and-provider-filter; PASS error-exclusion; PASS dedup-first-wins; PASS overcap-and-pct; PASS fractional-pct; PASS empty-window; PASS oldest-expiry-unordered; PASS bymodel-sorted-normalized
- **P2-bughunt** (35/35, 28.3s): PASS format-compliance (+6); PASS caught-truncation-commit (+14); PASS caught-sql-injection (+10); PASS caught-timeout-unit-mismatch (+5); PASS zero-false-positives-on-decoy
- **P3-reasoning** (15/15, 120.2s): PASS minTotalSeconds=16 (+5); PASS commitOrder=A,B,C,E,D (+5); PASS minWriteBufferKiB=350 (+5)
- **P4-agentic** (13/15, 18.6s): PASS used-read-search-tools (read, glob, glob, glob, grep, read, read, glob) (+5); PASS exact-root-cause (src/reconcile.mjs:23, >= -> >) (+6); PARTIAL tool-discipline (8 steps) (+2)

### `opencode-go/iceman-contributor-free` — 96/100 (Apex)
- **P1-coding** (35/35, 36.7s): PASS inclusive-bounds; PASS window-exclusion; PASS free-and-provider-filter; PASS error-exclusion; PASS dedup-first-wins; PASS overcap-and-pct; PASS fractional-pct; PASS empty-window; PASS oldest-expiry-unordered; PASS bymodel-sorted-normalized
- **P2-bughunt** (31/35, 47.1s): PASS format-compliance (+6); PASS caught-truncation-commit (+10); PASS caught-sql-injection (+10); PASS caught-timeout-unit-mismatch (+5); PASS zero-false-positives-on-decoy
- **P3-reasoning** (15/15, 57.1s): PASS minTotalSeconds=16 (+5); PASS commitOrder=A,B,C,E,D (+5); PASS minWriteBufferKiB=350 (+5)
- **P4-agentic** (15/15, 24.2s): PASS used-read-search-tools (glob, grep, grep, read) (+5); PASS exact-root-cause (src/reconcile.mjs:23, >= -> >) (+6); PASS tool-discipline (4 steps, clean JSON) (+4)

### `opencode/hy4-flash-free` — 96/100 (Apex)
- **P1-coding** (35/35, 14s): PASS inclusive-bounds; PASS window-exclusion; PASS free-and-provider-filter; PASS error-exclusion; PASS dedup-first-wins; PASS overcap-and-pct; PASS fractional-pct; PASS empty-window; PASS oldest-expiry-unordered; PASS bymodel-sorted-normalized
- **P2-bughunt** (31/35, 22.7s): PASS format-compliance (+6); PASS caught-truncation-commit (+10); PASS caught-sql-injection (+10); PASS caught-timeout-unit-mismatch (+5); PASS zero-false-positives-on-decoy
- **P3-reasoning** (15/15, 47.5s): PASS minTotalSeconds=16 (+5); PASS commitOrder=A,B,C,E,D (+5); PASS minWriteBufferKiB=350 (+5)
- **P4-agentic** (15/15, 7.3s): PASS used-read-search-tools (read) (+5); PASS exact-root-cause (src/reconcile.mjs:23, >= -> >) (+6); PASS tool-discipline (1 steps, clean JSON) (+4)

### `opencode-go/kimi-k3.1-pro` — 90/100 (Apex)
- **P1-coding** (35/35, 23.3s): PASS inclusive-bounds; PASS window-exclusion; PASS free-and-provider-filter; PASS error-exclusion; PASS dedup-first-wins; PASS overcap-and-pct; PASS fractional-pct; PASS empty-window; PASS oldest-expiry-unordered; PASS bymodel-sorted-normalized
- **P2-bughunt** (25/35, 66.7s): PASS format-compliance (+6); PASS caught-truncation-commit (+14); PASS caught-sql-injection (+10); PASS caught-timeout-unit-mismatch (+5); FP   flagged-clean-currency-decoy x1 (-10)
- **P3-reasoning** (15/15, 20.2s): PASS minTotalSeconds=16 (+5); PASS commitOrder=A,B,C,E,D (+5); PASS minWriteBufferKiB=350 (+5)
- **P4-agentic** (15/15, 4s): PASS used-read-search-tools (read) (+5); PASS exact-root-cause (src/reconcile.mjs:23, >= -> >) (+6); PASS tool-discipline (1 steps, clean JSON) (+4)

### `opencode/mimo-v2.6-flash-free` — 86/100 (Apex)
- **P1-coding** (35/35, 10.5s): PASS inclusive-bounds; PASS window-exclusion; PASS free-and-provider-filter; PASS error-exclusion; PASS dedup-first-wins; PASS overcap-and-pct; PASS fractional-pct; PASS empty-window; PASS oldest-expiry-unordered; PASS bymodel-sorted-normalized
- **P2-bughunt** (21/35, 14.8s): PASS format-compliance (+6); MISS truncation-commit (0); PASS caught-sql-injection (+10); PASS caught-timeout-unit-mismatch (+5); PASS zero-false-positives-on-decoy
- **P3-reasoning** (15/15, 48.1s): PASS minTotalSeconds=16 (+5); PASS commitOrder=A,B,C,E,D (+5); PASS minWriteBufferKiB=350 (+5)
- **P4-agentic** (15/15, 23.7s): PASS used-read-search-tools (read, grep, glob) (+5); PASS exact-root-cause (src/reconcile.mjs:23, >= -> >) (+6); PASS tool-discipline (3 steps, clean JSON) (+4)

### `opencode/flint-40b-free` — 72/100 (Workhorse)
- **P1-coding** (35/35, 61.4s): PASS inclusive-bounds; PASS window-exclusion; PASS free-and-provider-filter; PASS error-exclusion; PASS dedup-first-wins; PASS overcap-and-pct; PASS fractional-pct; PASS empty-window; PASS oldest-expiry-unordered; PASS bymodel-sorted-normalized
- **P2-bughunt** (31/35, 50.4s): PASS format-compliance (+6); PASS caught-truncation-commit (+10); PASS caught-sql-injection (+10); PASS caught-timeout-unit-mismatch (+5); PASS zero-false-positives-on-decoy
- **P3-reasoning** (0/15, 120s): invalid or missing JSON
- **P4-agentic** (6/15, 142.3s): FAIL called-forbidden-or-malformed-tool (grep, glob, glob, shell</arg_key><arg_value>true</arg_value>, read, glob, glob, glob) (0); PASS exact-root-cause (src/reconcile.mjs:23, >= -> >) (+6); FAIL tool-thrashing (41 steps > 12) (0)

### `opencode/longcat-2.5-free` — 71/100 (Workhorse)
- **P1-coding** (35/35, 30.8s): PASS inclusive-bounds; PASS window-exclusion; PASS free-and-provider-filter; PASS error-exclusion; PASS dedup-first-wins; PASS overcap-and-pct; PASS fractional-pct; PASS empty-window; PASS oldest-expiry-unordered; PASS bymodel-sorted-normalized
- **P2-bughunt** (21/35, 104.1s): PASS format-compliance (+6); MISS truncation-commit (0); PASS caught-sql-injection (+10); PASS caught-timeout-unit-mismatch (+5); PASS zero-false-positives-on-decoy
- **P3-reasoning** (0/15, 120s): invalid or missing JSON
- **P4-agentic** (15/15, 7.7s): PASS used-read-search-tools (read) (+5); PASS exact-root-cause (src/reconcile.mjs:23, >= -> >) (+6); PASS tool-discipline (1 steps, clean JSON) (+4)

### `opencode/tidepool-alpha-free` — 61/100 (Workhorse)
- **P1-coding** (35/35, 68.2s): PASS inclusive-bounds; PASS window-exclusion; PASS free-and-provider-filter; PASS error-exclusion; PASS dedup-first-wins; PASS overcap-and-pct; PASS fractional-pct; PASS empty-window; PASS oldest-expiry-unordered; PASS bymodel-sorted-normalized
- **P2-bughunt** (26/35, 76.4s): PASS format-compliance (+6); PASS caught-truncation-commit (+10); PASS caught-sql-injection (+10); MISS timeout-unit-mismatch (0); PASS zero-false-positives-on-decoy
- **P3-reasoning** (0/15, 122.7s): invalid or missing JSON
- **P4-agentic** (0/15, 120s): empty response / DNF
