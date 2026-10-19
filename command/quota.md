---
description: Show quota, credit and spend status (Go plan, OpenRouter key, recorded paid)
---

Current quota / credit / spend snapshot (local files only, no network calls):

!`node ~/.config/opencode/skills/usage-dashboard/scripts/quota-status.mjs`

In one or two lines, say what needs attention, if anything: quota windows over
80% used or resetting soon, stale snapshots (re-run the named fetch script),
billing flags on key-authed providers, or 429 pressure in the last 24h.
If everything is healthy, say so in one line and stop.
