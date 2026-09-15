# opencode-config

Global [opencode](https://opencode.ai) configuration for yasirhusain89. This repo is meant to live at `~/.config/opencode` — cloned directly, so the live config and the repo are the same directory.

## What's included

| Path | Purpose |
| --- | --- |
| `opencode.jsonc` | Providers (Ollama local), small_model, permissions, MCP servers (gitnexus, zvec_grep) |
| `AGENTS.md` | Global agent instructions (zvec-grep retrieval routing) — auto-loaded into every session |
| `agent/` | 5 custom agents: `reviewer`, `security-reviewer`, `docs-writer`, `researcher`, `domain-companion` (finance/app-design companion grounded in Mint/YNAB/Monarch/Copilot patterns) |
| `skills/` | 13 skills: full GitNexus suite (12) + `usage-dashboard` |
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

5. Authenticate providers that need it (opencode's own gateway models are used for `small_model`):

   ```bash
   opencode auth login
   ```

6. Quit and restart opencode. Config, agents, skills, and commands load once at startup — running sessions keep the already-loaded config.

Everything then auto-loads: skills from `skills/`, agents from `agent/`, commands from `command/`, instructions from `AGENTS.md`.

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
