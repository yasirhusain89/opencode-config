---
description: Show quota, credit and spend status (Go plan, OpenRouter key, recorded paid)
---

Current quota / credit / spend snapshot (local files + live DB, no network calls):

!`node ~/.config/opencode/skills/usage-dashboard/scripts/quota-status.mjs`

Lead with the SR burn line: it is live (≤90s old, recomputed from the session
DB on demand). In one or two lines, say what needs attention: any SR window
over 70% used, a per-model runway under ~500 msgs, stale official-quota
snapshots (re-run go_quota.mjs), billing flags on key-authed providers, or 429
pressure in the last 24h. If everything is healthy, say so in one line and stop.
