#!/bin/bash
# preflight.sh — session hygiene + depot-cache redirect before a download_depot session.
# Usage: preflight.sh [--external /Volumes/DRIVE] [--kill-heroic] [--no-symlink] [--check-only]
set -euo pipefail

EXTERNAL="${STEAM_EXTERNAL:-/Volumes/YH-SanP2TB}"
STEAM_DIR="$HOME/Library/Application Support/Steam"
BUNDLE_MACOS="$STEAM_DIR/Steam.AppBundle/Steam/Contents/MacOS"
CACHE_NAME="SteamDepotCache"
KILL=0; SYMLINK=1; CHECK_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --external)   EXTERNAL="$2"; shift 2;;
    --kill-heroic) KILL=1; shift;;
    --no-symlink) SYMLINK=0; shift;;
    --check-only) CHECK_ONLY=1; shift;;
    -h|--help) awk 'NR>1 {if ($0 !~ /^#/) exit; sub(/^# ?/,""); print}' "$0"; exit 0;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

echo "== Steam client =="
[[ -d "$BUNDLE_MACOS" ]] && echo "  ok: $BUNDLE_MACOS" || { echo "  MISSING: $BUNDLE_MACOS" >&2; exit 1; }

echo "== external drive =="
if [[ -d "$EXTERNAL" ]]; then
  echo "  ok: $EXTERNAL mounted"
else
  echo "  NOT MOUNTED: $EXTERNAL" >&2
  exit 1
fi

if [[ $CHECK_ONLY -eq 1 ]]; then KILL=0; SYMLINK=0; fi

echo "== session hygiene (only ONE Steam client may be logged in) =="
WINE_PIDS=$(pgrep -f 'wine64-preloader|SteamHeroic' 2>/dev/null || true)
HEROIC_PIDS=$(pgrep -f 'Heroic.app' 2>/dev/null || true)
if [[ -n "$WINE_PIDS" || -n "$HEROIC_PIDS" ]]; then
  echo "  Windows Steam / Heroic IS running (pids: ${WINE_PIDS:+$WINE_PIDS }${HEROIC_PIDS})"
  if [[ $KILL -eq 1 ]]; then
    osascript -e 'tell application "Heroic" to quit' 2>/dev/null || true; sleep 2
    pkill -f 'wine64-preloader' 2>/dev/null || true; sleep 3
    pkill -9 -f 'wine64-preloader' 2>/dev/null || true
    pkill -9 -f 'SteamHeroic' 2>/dev/null || true
    sleep 2
    LEFT=$(pgrep -f 'wine64-preloader|SteamHeroic|Heroic.app' 2>/dev/null || true)
    [[ -z "$LEFT" ]] && echo "  killed: all wine/Heroic processes gone" \
                     || { echo "  STILL RUNNING: $LEFT" >&2; exit 1; }
  else
    echo "  NOT killed (pass --kill-heroic). Depot downloads WILL fail with"
    echo "  'Session Replaced' / 'No connection' while it runs."
  fi
else
  echo "  ok: no Windows Steam / Heroic processes"
fi

# Detect a kicked session: 'Session Replaced' after the most recent logon.
CLOG="$STEAM_DIR/logs/connection_log.txt"
if [[ -f "$CLOG" ]]; then
  LAST_LOGON=$(grep -n 'RecvMsgClientLogOnResponse' "$CLOG" | tail -1 | cut -d: -f1 || echo 0)
  KICKED=$(tail -n +"$LAST_LOGON" "$CLOG" | grep -c 'Session Replaced' || true)
  if [[ "$KICKED" -gt 0 ]]; then
    echo "  WARNING: session was kicked ('Session Replaced') after last logon."
    echo "  Steam does NOT auto-reconnect from this. Fully quit + relaunch Steam first."
  else
    echo "  ok: current session not kicked"
  fi
fi

if [[ $SYMLINK -eq 1 ]]; then
  echo "== depot-cache redirect (keeps download_depot off the main drive) =="
  TARGET="$EXTERNAL/$CACHE_NAME"
  LINK="$BUNDLE_MACOS/steamapps"
  if [[ -L "$LINK" ]]; then
    CUR=$(readlink "$LINK")
    if [[ "$CUR" == "$TARGET" ]]; then echo "  ok: symlink -> $TARGET"
    else echo "  CHANGING: $CUR -> $TARGET"; ln -sfn "$TARGET" "$LINK"; fi
  elif [[ -e "$LINK" ]]; then
    echo "  REFUSING: $LINK exists as a real directory (not a symlink)." >&2
    echo "  Inspect it manually before replacing: it may hold uncommitted depots." >&2
    exit 1
  else
    mkdir -p "$TARGET"
    ln -s "$TARGET" "$LINK"
    echo "  created: $LINK -> $TARGET"
  fi
fi

echo "== disk space =="
for VOL in /System/Volumes/Data "$EXTERNAL"; do
  df -h "$VOL" 2>/dev/null | awk 'NR==2{printf "  %-24s %6s used, %6s free\n", $9, $3, $4}'
done
echo "preflight done."
