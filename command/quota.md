---
description: Show quota, credit and spend status (Go plan, OpenRouter key, recorded paid)
---

Current quota / credit / spend snapshot (local files + live DB, no network calls):

!`node ~/.config/opencode/skills/usage-dashboard/scripts/quota-status.mjs`

Lead with the Go burn line: it is an estimate from local DB spend (≤90s old,
recomputed on demand), ordered binding-first (weekly, monthly, then 5h), and
shows both percent used and percent left. In one or two lines, say what needs
attention: a weekly/monthly window over 70% used, whether the pace line says
the cap is exhausted before the window releases headroom, a per-model runway
under ~500 msgs, stale state, billing flags on key-authed providers, or 429
pressure in the last 24h. If everything is healthy, say so in one line and stop.
