#!/bin/bash
# assemble_install.sh — move a downloaded depot's content into the SteamLibrary
# common/<installdir>/ and verify it first. Leaves Manifest_*.txt metadata behind.
# Usage: assemble_install.sh --appid N --depotid N --installdir "Name" \
#          [--external /Volumes/DRIVE] [--library /Volumes/DRIVE/SteamLibrary] [--dry-run]
set -euo pipefail

EXTERNAL="${STEAM_EXTERNAL:-/Volumes/YH-SanP2TB}"
CACHE="$EXTERNAL/SteamDepotCache"
LIBRARY="$EXTERNAL/SteamLibrary"
APPID=""; DEPOTID=""; INSTALLDIR=""; DRY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --appid)      APPID="$2"; shift 2;;
    --depotid)    DEPOTID="$2"; shift 2;;
    --installdir) INSTALLDIR="$2"; shift 2;;
    --external)   EXTERNAL="$2"; CACHE="$EXTERNAL/SteamDepotCache"; shift 2;;
    --library)    LIBRARY="$2"; shift 2;;
    --dry-run)    DRY=1; shift;;
    -h|--help)    awk 'NR>1 {if ($0 !~ /^#/) exit; sub(/^# ?/,""); print}' "$0"; exit 0;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

[[ -n "$APPID" && -n "$DEPOTID" && -n "$INSTALLDIR" ]] || { echo "need --appid, --depotid, --installdir" >&2; exit 2; }

DEPOT="$CACHE/content/app_$APPID/depot_$DEPOTID"
TARGET="$LIBRARY/steamapps/common/$INSTALLDIR"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

[[ -d "$DEPOT" ]] || { echo "depot dir missing: $DEPOT" >&2; exit 1; }

echo "== verify depot against its manifest =="
python3 "$SCRIPT_DIR/steamdepot.py" verify --depot "$DEPOT"
V=$?
if [[ $V -ne 0 ]]; then
  echo "verification FAILED — fix the download (re-run download_depot) before assembling." >&2
  exit "$V"
fi

echo
echo "== assemble =="
echo "  depot : $DEPOT"
echo "  target: $TARGET"
mkdir -p "$TARGET"
MOVED=0; SKIPPED=0
for entry in "$DEPOT"/*; do
  name=$(basename "$entry")
  case "$name" in
    Manifest_*.txt) echo "  keep (metadata): $name"; continue;;
  esac
  if [[ -e "$TARGET/$name" ]]; then
    echo "  skip (exists, keeping existing): $name"
    SKIPPED=$((SKIPPED+1))
  else
    if [[ $DRY -eq 1 ]]; then
      echo "  would move: $name"
    else
      mv "$entry" "$TARGET/"
      echo "  moved: $name"
    fi
    MOVED=$((MOVED+1))
  fi
done
echo
if [[ $DRY -eq 1 ]]; then
  echo "dry run: $MOVED item(s) would move, $SKIPPED skipped. Nothing changed."
else
  echo "done: $MOVED moved, $SKIPPED skipped (existing content preserved)."
  echo "next: write the appmanifest:"
  echo "  steamdepot.py manifest --appid $APPID --library $LIBRARY \\"
  echo "    --installdir '$INSTALLDIR' --name '<title>' --buildid <id> \\"
  echo "    --depot <depotid>:<manifest gid from 'Depot download complete'>:<size>"
fi
