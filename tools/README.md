# tools/ — native macOS companions (no Xcode, no signing)

Built with `/usr/bin/swiftc` (AppKit only, stdlib for scripts). Rebuild with
each directory's `build.sh`. Installed outputs live OUTSIDE the repo
(`~/Applications/*.app`, `~/Library/LaunchAgents/*.plist`) — this folder
holds source only.

## cost-bar/ — OpenCode Cost Bar (menu-bar Go-quota pill)

Single-file Swift `NSStatusItem` app (`main.swift`, `Info.plist`,
`build.sh`). Reads `~/.local/share/opencode/sr-live.json` (written by
`plugins/cost-tracker.js`, computed by
`skills/model-benchmarks/scripts/sr-calc.mjs`) via event-driven file watch +
5s mtime backup. Pill shows the binding window's percentage plus time until
headroom returns (e.g. `⚡ 4.1d 61%`; amber ≥70, red ≥90) or `—` when the
shared state is untrusted; in that case
the app recomputes from the DB itself instead of showing a stale number.
Dropdown has used/left/next-drop per window (7d/30d/5h), pace and weekly
headroom, per-model 30d spend vs cap with remaining messages, and links to
the dashboard + guide. No API key needed.
`build.sh` assembles `~/Applications/OpenCode Cost Bar.app` and runs
`--self-test` (parses state, prints pill + menu, exits — no GUI needed).
LaunchAgent `~/Library/LaunchAgents/ai.opencode.costbar.plist` (RunAtLoad +
KeepAlive). Start manually once with `open ~/Applications/OpenCode\ Cost\
Bar.app`.

## helpers/ — branded wrappers for scheduled agents

macOS Login Items names background items after the EXECUTABLE, so
LaunchAgents that exec `/bin/bash` or `/usr/bin/python3` show up as anonymous
"bash"/"python". `launcher.swift` + `build.sh` wrap each job in its own
`~/Applications/OpenCode <Job>.app` (owl icon copied from OpenCode.app,
real command in the bundle's `OPCommand` Info.plist key). Spawn-and-wait, NOT
exec — exec would swap the image back to the interpreter and resurrect the
old name. Current set: DB Maintain, DB Check, Usage Dashboard, Model
Benchmarks. After rebuilding, re-point the matching
`~/Library/LaunchAgents/*.plist` `ProgramArguments` at the new binary and
`launchctl bootout`/`bootstrap` it.
