---
description: Sync the opencode-config repo — pull, commit, and push so the global config stays backed up.
agent: build
---

Run `bash ~/.config/opencode/sync.sh` and report:

1. Whether the repo was behind origin and what was pulled
2. What changed locally and the commit message used
3. The push result

If the script fails, show the exact git error and stop — do not retry with `--force`, amended commits, or rebases you invent. Never commit secrets (API keys, tokens) that appear in config files; report them and stop instead.

$ARGUMENTS
