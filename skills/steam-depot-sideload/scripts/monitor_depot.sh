#!/bin/bash
# monitor_depot.sh — track download_depot progress from Steam's console log.
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
  grep -E "Downloading depot|Depot download complete|Depot download failed" "$LOG" 2>/dev/null | tail -3 | sed 's/^/  /'
  if [[ -d "$CACHE" ]]; then
    FILES=$(find "$CACHE" -type f 2>/dev/null | wc -l | tr -d ' ')
    SIZE=$(du -sh "$CACHE" 2>/dev/null | cut -f1)
    echo "  cache: $FILES files, $SIZE"
  else
    echo "  cache: (nothing downloaded yet)"
  fi
  # unfinished = a "Downloading" line newer than the last "complete"/"failed"
  LAST=$(grep -E "Downloading depot|Depot download complete|Depot download failed" "$LOG" 2>/dev/null | tail -1)
  case "$LAST" in
    *"Downloading depot"*) echo "  state: DOWNLOADING";;
    *"complete"*)          echo "  state: COMPLETE";;
    *"failed"*)            echo "  state: FAILED — fix cause, then re-run the same";;
    *)                     echo "  state: IDLE (no depot activity in log)";;
  esac
}

if [[ $WATCH -eq 1 ]]; then
  while true; do report; sleep "$INTERVAL"; done
else
  report
fi
