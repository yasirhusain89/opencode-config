# tools/ — native macOS companions (no Xcode, no signing)

Built with `/usr/bin/swiftc` (AppKit only, stdlib for scripts). Rebuild with
each directory's `build.sh`. Installed outputs live OUTSIDE the repo
(`~/Applications/*.app`, `~/Library/LaunchAgents/*.plist`) — this folder
holds source only.

## cost-bar/ — OpenCode Cost Bar (menu-bar SR pill)

Single-file Swift `NSStatusItem` app (`main.swift`, `Info.plist`,
`build.sh`). Reads `~/.local/share/opencode/sr-live.json` (written by
`plugins/cost-tracker.js`, computed by
`skills/model-benchmarks/scripts/sr-calc.mjs`) via event-driven file watch +
5s mtime backup. Pill shows Go 5h-window SR + % (amber ≥70, red ≥90);
dropdown has 5h/7d/30d windows, per-model 7d $/msg + message runway, official
quota (when `go_quota.mjs` has run), and links to the dashboard + guide.
`build.sh` assembles `~/Applications/OpenCode Cost Bar.app` and runs
`--self-test` (parses state, prints pill + menu, exits — no GUI needed).
LaunchAgent `~/Library/LaunchAgents/ai.opencode.costbar.plist` (RunAtLoad +
KeepAlive). Start manually once with `open ~/Applications/OpenCode\ Cost\
Bar.app`; needs no API key (local math only) — official-quota refresh does.

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
