#!/bin/bash
# monitor_depot.sh — track download_depot progress from Steam's console log.
# Reports per depot (latest Downloading/complete/failed line + on-disk size),
# because several depots can be in flight and their log lines interleave.
# Usage: monitor_depot.sh [--watch [SECONDS]] [--log PATH] [--external /Volumes/DRIVE]
set -euo pipefail

LOG="$HOME/Library/Application Support/Steam/logs/console_log.txt"
EXTERNAL="${STEAM_EXTERNAL:-/Volumes/YH-SanP2TB}"
CACHE="$EXTERNAL/SteamDepotCache"
WATCH=0; INTERVAL=30

while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch)    WATCH=1; [[ "${2:-}" =~ ^[0-9]+$ ]] && { INTERVAL=$2; shift; }; shift;;
    --log)      LOG="$2"; shift 2;;
    --external) EXTERNAL="$2"; CACHE="$EXTERNAL/SteamDepotCache"; shift 2;;
    -h|--help)  awk 'NR>1 {if ($0 !~ /^#/) exit; sub(/^# ?/,""); print}' "$0"; exit 0;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

report() {
  echo "=== $(date '+%H:%M:%S') ==="
  local EVENTS
  EVENTS=$(grep -E "Downloading depot [0-9]+|Depot download (complete|failed)[^:]*: " "$LOG" 2>/dev/null | tail -30)
  if [[ -z "$EVENTS" ]]; then
    echo "  state: IDLE (no depot activity in log)"
  else
    # per-depot status: for every depot with a "Downloading" line, print its
    # latest Downloading / complete / failed line plus its on-disk size.
    # (global "last line wins" breaks when several depots interleave.)
    echo "$EVENTS" | grep -oE "Downloading depot [0-9]+" | awk '{print $NF}' | sort -u | while read -r D; do
      LATEST=$(echo "$EVENTS" | grep -E "depot $D[ :)]|depot_$D" | tail -1 | sed -E 's/^\[[^]]+\] //; s/^/  /')
      DIR=$(find "$CACHE/content" -maxdepth 2 -type d -name "depot_$D" 2>/dev/null | head -1)
      if [[ -n "$DIR" ]]; then
        ON_DISK=$(du -sh "$DIR" 2>/dev/null | cut -f1)
      else
        ON_DISK="(dir gone)"
      fi
      echo "  depot $D — on disk: $ON_DISK"
      echo "$LATEST"
      # FALSE COMPLETE: Steam printed "complete" but the cache is empty —
      # stale resume-state survived an assemble (state file lists files that
      # were moved into the tree). Next download_depot would fetch 0 bytes.
      if echo "$LATEST" | grep -q "Depot download complete"; then
        BYTES=$(du -sk "$DIR" 2>/dev/null | cut -f1 || echo 0)
        if [[ "$BYTES" -eq 0 ]]; then
          APP=$(basename "$(dirname "$DIR")" | sed 's/^app_//')
          echo "  !! FALSE COMPLETE: cache empty despite 'complete' — stale state file."
          echo "     fix: quit Steam, then: steamdepot.py reset --appid $APP --depotid $D"
        fi
      fi
    done
  fi
}

if [[ $WATCH -eq 1 ]]; then
  while true; do report; sleep "$INTERVAL"; done
else
  report
fi
