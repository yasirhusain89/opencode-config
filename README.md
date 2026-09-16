# opencode-config

Global [opencode](https://opencode.ai) configuration for yasirhusain89. This repo is meant to live at `~/.config/opencode` — cloned directly, so the live config and the repo are the same directory.

## What's included

| Path | Purpose |
| --- | --- |
| `opencode.jsonc` | Providers (Ollama local), `model` + `small_model` (both `opencode/muse-spark-1.3-contributor-free`), permissions, MCP servers (gitnexus, zvec_grep) |
| `AGENTS.md` | Global agent instructions (operating constitution + zvec-grep retrieval routing) — auto-loaded into every session |
| `agent/` | 5 custom agents (all `opencode/muse-spark-1.3-contributor-free`): `reviewer` (35 steps), `security-reviewer` (40 steps), `docs-writer`, `researcher` (40 steps), `domain-companion` (finance/app-design companion grounded in Mint/YNAB/Monarch/Copilot patterns) |
| `skills/` | 14 skills: full GitNexus suite (12) + `usage-dashboard` + `model-benchmarks` |
| `plugins/` | Auto-loaded hooks: `secret-guard.ts`, `github-safety.ts` (no `plugin` config entry needed) |
| `command/sync-config.md` | The `/sync-config` command — syncs this repo from inside opencode |
| `sync.sh` | The sync script the command runs |

## Setup

1. Install opencode, then back up any existing global config:

   ```bash
   mv ~/.config/opencode ~/.config/opencode.bak.$(date +%s)
   ```

2. Clone this repo into place:

   ```bash
   git clone https://github.com/yasirhusain89/opencode-config.git ~/.config/opencode
   ```

3. Install the node dependency (used by skill scripts / future plugins):

   ```bash
   cd ~/.config/opencode && npm install
   ```

4. Machine-specific paths — `opencode.jsonc` references Homebrew-installed binaries; adjust if yours differ:

   - `gitnexus`: `/opt/homebrew/bin/gitnexus` (verify with `which gitnexus`)
   - `zg` (zvec-grep): `/opt/homebrew/bin/zg` (verify with `which zg`)

5. Authenticate providers that need it (`opencode auth login` — covers `model`/`small_model` and all agents on the opencode gateway):

   ```bash
   opencode auth login
   ```

6. Quit and restart opencode. Config, agents, skills, and commands load once at startup — running sessions keep the already-loaded config.

Everything then auto-loads: skills from `skills/`, agents from `agent/`, commands from `command/`, instructions from `AGENTS.md`.

Optional — track it from PyCharm as a project folder (a symlink; edits write through to the live config):

```bash
ln -s ~/.config/opencode ~/PycharmProjects/opencode-config
```

## Search index

zvec-grep indexes this repo for semantic search: `zg index` (run after big changes). The generated `.zvec-grep/` dir is machine-local runtime state — gitignored and PyCharm-excluded, never commit it.

## When the gateway quota runs out

OpenCode has no automatic failover: a dead quota surfaces as a session error and the agent stops. Switch manually:

* **TUI:** `/models` → pick `opencode/muse-spark-1.2-contributor-free` (same gateway, separate quota, verified working).
* **CLI (verified end-to-end):**
  ```bash
  OPENCODE_CONFIG_CONTENT='{"model":"opencode/muse-spark-1.2-contributor-free","small_model":"opencode/muse-spark-1.2-contributor-free"}' opencode run --title "backup" "..."
  ```
  The `small_model` part matters: title/summary calls hit the same dead quota otherwise.
* **Whole session:** `export OPENCODE_CONFIG_CONTENT='...'` (same JSON), then `opencode`.

Same model family, so reasoning quality stays close to 1.3 — just stay on 1.2 until the 1.3 quota resets, then switch back. Last resort if the whole gateway is down: `ollama/qwen3.8:latest` (local, no quota; add `"compaction":{"auto":false}` to the override JSON — it rambles end-of-run summaries).

## Keeping it in sync

Because the repo **is** the live config dir, sync is a plain git sync:

```bash
bash ~/.config/opencode/sync.sh           # pull, commit local changes, push
bash ~/.config/opencode/sync.sh --check   # exit 0 when in sync, 1 when behind or dirty
```

Or from inside opencode in any project: run `/sync-config`.

The `--check` mode is cron/launchd-friendly. To remind yourself daily, e.g.:

```bash
crontab -e
# 0 9 * * * ~/.config/opencode/sync.sh --check || echo "opencode-config out of sync" >&2
```

## Editing agents, skills, and commands

- Agents: `agent/<name>.md` — frontmatter (`description`, `mode`, `permission`), body becomes the prompt. `mode: all` = switchable in the TUI **and** usable as a subagent.
- Skills: `skills/<name>/SKILL.md` — `name` must match the folder; `description` drives when the model triggers it.
- Commands: `command/<name>.md` — body is the prompt; `$ARGUMENTS` receives what the user typed.
- Config: `opencode.jsonc` — validated against https://opencode.ai/config.json; opencode refuses to start on an invalid field.

After any edit: `/sync-config` (or `sync.sh`), then restart opencode.

## Machines beyond the primary one

Clone into `~/.config/opencode` as above, then fix the two MCP binary paths in `opencode.jsonc` if Homebrew lives elsewhere (e.g. `/usr/local/bin` on Intel macs, or a Linux path). The permission block guards risky bash (`git push`, `rm -rf`, `sudo`, `curl`, `wget` → ask) — adjust to taste.
