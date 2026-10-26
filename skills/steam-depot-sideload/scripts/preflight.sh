#!/bin/bash
# preflight.sh — session hygiene + depot-cache redirect before a download_depot session.
# Usage: preflight.sh [--external /Volumes/DRIVE] [--kill-heroic] [--no-symlink] [--check-only]
#        [--guard-only [--apps "id id..."]]
# guard-only: run JUST the manifest guard and exit nonzero when OUR apps are
# shadowed/queued (for the Heroic launch wrapper). Other apps' queues are
# normal Steam business and don't block — pass --apps to scope the Z: check.
set -euo pipefail

EXTERNAL="${STEAM_EXTERNAL:-/Volumes/YH-SanP2TB}"
STEAM_DIR="$HOME/Library/Application Support/Steam"
BUNDLE_MACOS="$STEAM_DIR/Steam.AppBundle/Steam/Contents/MacOS"
CACHE_NAME="SteamDepotCache"
KILL=0; SYMLINK=1; CHECK_ONLY=0; GUARD_ONLY=0; APPS="2552450 292030 784080"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --external)   EXTERNAL="$2"; shift 2;;
    --kill-heroic) KILL=1; shift;;
    --no-symlink) SYMLINK=0; shift;;
    --check-only) CHECK_ONLY=1; shift;;
    --guard-only) GUARD_ONLY=1; CHECK_ONLY=1; SYMLINK=0; KILL=0; shift;;
    --apps)       APPS="${2:?--apps needs a value}"; shift 2;;
    -h|--help) awk 'NR>1 {if ($0 !~ /^#/) exit; sub(/^# ?/,""); print}' "$0"; exit 0;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

if [[ $GUARD_ONLY -eq 1 ]]; then
  # jump straight to the guard; the launch wrapper depends on the exit code
  :
else
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
fi # end of non-guard sections (skipped with --guard-only)

echo "== manifest guard (rules 14/18/20/26 — read-only, launch would act on these) =="
CPREFIX="$HOME/Games/Heroic/Prefixes/default/SteamHeroic/drive_c/Program Files (x86)/Steam"
ZLIB="$EXTERNAL/SteamLibrary/steamapps"
acf_field() { # $1 = file, $2 = key → value (BSD sed: no \s)
  { grep -a -m1 "\"$2\"" "$1" 2>/dev/null || true; } | sed -E 's/.*"'"$2"'"[[:space:]]+"([^"]*)".*/\1/' | head -1
}
RISKS=0
if [[ -d "$CPREFIX/steamapps" ]]; then
  if [[ ! -f "$CPREFIX/steamapps/appmanifest_228980.acf" ]]; then
    echo "  BLOCK: no manifest for shared-redist parent 228980 — the client recreates a stub,"
    echo "         then EVERY dependent (KH3/Witcher/MW5) sticks at Update Required and refuses"
    echo "         to launch offline with 'Downloads disabled'. Write it as installed (rule 26)."
    RISKS=$((RISKS+1))
  fi
  for M in "$CPREFIX"/steamapps/appmanifest_*.acf; do
    [[ -e "$M" ]] || continue
    APP=$(basename "$M" | sed -E 's/appmanifest_([0-9]+).acf/\1/')
    SF=$(acf_field "$M" StateFlags); STAGE=$(acf_field "$M" BytesToStage)
    TO_DL=$(acf_field "$M" BytesToDownload); BID=$(acf_field "$M" buildid)
    TBID=$(acf_field "$M" TargetBuildID)
    ZBID=""
    [[ -f "$ZLIB/appmanifest_$APP.acf" ]] && ZBID=$(acf_field "$ZLIB/appmanifest_$APP.acf" buildid)
    if [[ "$APP" == "228980" ]]; then
      IDEPS=$( { grep -a -c '"manifest"' "$M" 2>/dev/null || true; } | head -1)
      IDEPS=${IDEPS:-0}
      if [[ "$BID" == "0" || "$IDEPS" -eq 0 || "$SF" == "2" ]]; then
        echo "  BLOCK: shared-redist parent 228980 is a stub (buildid=$BID StateFlags=$SF depots=$IDEPS)."
        echo "         Every dependent app inherits Update Required and refuses to launch offline"
        echo "         ('Downloads disabled'). Write it as installed — rule 26 — never park it."
        RISKS=$((RISKS+1))
        continue
      fi
      if [[ "$SF" != "4" && "$SF" != "518" ]] || [[ -n "$TO_DL" && "$TO_DL" != "0" ]] \
         || [[ -n "$STAGE" && "$STAGE" != "0" ]] || [[ -n "$TBID" && "$TBID" != "$BID" ]]; then
        echo "  BLOCK: shared-redist parent 228980 is queued/re-targeted (StateFlags=$SF target=$TBID build=$BID)."
        echo "         The client requeues it on every launch; dependents can inherit Update Required."
        echo "         Relock like the children (StateFlags 4, TargetBuildID=buildid, zero counters) — rule 26."
        RISKS=$((RISKS+1))
        continue
      fi
      echo "  ok: shared-redist parent 228980 installed and idle (build $BID, $IDEPS depots) — dependents can launch."
      continue
    fi
    if [[ -n "$ZBID" && "$BID" != "$ZBID" ]]; then
      echo "  SHADOW: C: manifest for app $APP (build $BID) disagrees with Z: library (build $ZBID)."
      echo "          The client reads the C: husk and ignores the real install (rule 18)."
      echo "          Fix with everything quit: move '$M' + matching C: common/ dir aside."
      RISKS=$((RISKS+1))
    elif [[ -z "$ZBID" && "$TO_DL" == "0" && "$STAGE" == "0" ]]; then
      echo "  info: C: ghost stub for app $APP (no Z: twin, nothing queued) — inert, launch proceeds."
    elif [[ "$SF" != "4" && "$SF" != "518" ]] || [[ -n "$TO_DL" && "$TO_DL" != "0" ]] || [[ -n "$STAGE" && "$STAGE" != "0" ]]; then
      echo "  C: manifest app $APP queued (StateFlags=$SF to-download=$TO_DL to-stage=$STAGE) — launch may stage/delete."
      RISKS=$((RISKS+1))
    fi
  done
  [[ $RISKS -eq 0 ]] && echo "  ok: no shadow/queued manifests in the prefix library"
else
  echo "  skip: no prefix Steam library at $CPREFIX/steamapps"
fi
ZRISKS=0
if [[ -d "$ZLIB" ]]; then
  for M in "$ZLIB"/appmanifest_*.acf; do
    [[ -e "$M" ]] || continue
    APP=$(basename "$M" | sed -E 's/appmanifest_([0-9]+).acf/\1/')
    if [[ $GUARD_ONLY -eq 1 ]]; then
      # launch wrapper: only our apps block; other queues are normal business
      case " $APPS " in *" $APP "*) ;; *) continue;; esac
    fi
    SF=$(acf_field "$M" StateFlags); STAGE=$(acf_field "$M" BytesToStage)
    TO_DL=$(acf_field "$M" BytesToDownload)
    if [[ "$SF" != "4" && "$SF" != "518" ]] || [[ -n "$TO_DL" && "$TO_DL" != "0" ]] || [[ -n "$STAGE" && "$STAGE" != "0" ]]; then
      echo "  QUEUED: Z: manifest app $APP (StateFlags=$SF to-download=$TO_DL to-stage=$STAGE)"
      echo "          launching Windows Steam now will STAGE (delete!) files first (rule 20)."
      echo "          Fix with all clients quit: zero the counters + StateFlags 4 (steamdepot.py manifest),"
      echo "          or park the manifest aside if the tree is already gone."
      ZRISKS=$((ZRISKS+1))
    fi
  done
  [[ $ZRISKS -eq 0 ]] && echo "  ok: shared-library manifests all idle (StateFlags 4/518, counters zero)"
else
  echo "  skip: no shared library at $ZLIB"
fi
if [[ $GUARD_ONLY -eq 1 ]]; then
  if [[ $((RISKS + ZRISKS)) -gt 0 ]]; then
    echo "GUARD: BLOCKED — $RISKS prefix + $ZRISKS library risk(s). Quit and relock first."
    exit 1
  fi
  echo "GUARD: CLEAR — launch may proceed."
  exit 0
fi
echo "preflight done."
