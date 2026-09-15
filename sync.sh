#!/usr/bin/env bash
# Keeps this opencode global config repo (~/.config/opencode) in sync with origin.
# Usage:
#   bash sync.sh            # pull, commit local changes, push
#   bash sync.sh --check    # exit 0 when in sync, 1 when behind or dirty
set -euo pipefail
cd "$(dirname "$0")"

if [ "${1:-}" = "--check" ]; then
  git fetch origin main --quiet
  behind=$(git rev-list --count HEAD..origin/main)
  dirty=$(git status --porcelain | wc -l | tr -d ' ')
  echo "behind=$behind dirty=$dirty"
  [ "$behind" -eq 0 ] && [ "$dirty" -eq 0 ]
  exit $?
fi

git fetch origin main --quiet
git pull --rebase --autostash origin main
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -m "Sync opencode config $(date '+%Y-%m-%d %H:%M')"
fi
git push origin main
echo "config repo synced"
