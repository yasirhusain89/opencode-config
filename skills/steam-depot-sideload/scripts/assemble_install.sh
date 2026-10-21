#!/bin/bash
# assemble_install.sh — move a downloaded depot's content into the SteamLibrary
# common/<installdir>/ and verify it first. Leaves Manifest_*.txt metadata behind.
# Layout is verbatim (depot-relative paths map 1:1 under installdir); existing
# dirs are descended into, same-path file overlaps overwrite with a loud warning,
# and every move is asserted (aborts on any mismatch). See SKILL.md step 4.
# Usage: assemble_install.sh --appid N --depotid N --installdir "Name" \
#          [--external /Volumes/DRIVE] [--library /Volumes/DRIVE/SteamLibrary] [--dry-run]
#          [--no-manifest = skip verify for depots that ship no Manifest_*.txt]
set -euo pipefail

EXTERNAL="${STEAM_EXTERNAL:-/Volumes/YH-SanP2TB}"
CACHE="$EXTERNAL/SteamDepotCache"
LIBRARY="$EXTERNAL/SteamLibrary"
APPID=""; DEPOTID=""; INSTALLDIR=""; DRY=0; NOMANIFEST=0; TOLERANT=0; FAILED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --appid)      APPID="$2"; shift 2;;
    --depotid)    DEPOTID="$2"; shift 2;;
    --installdir) INSTALLDIR="$2"; shift 2;;
    --external)   EXTERNAL="$2"; CACHE="$EXTERNAL/SteamDepotCache"; shift 2;;
    --library)    LIBRARY="$2"; shift 2;;
    --dry-run)    DRY=1; shift;;
    --no-manifest) NOMANIFEST=1; shift;;
    --tolerant)   TOLERANT=1; shift;;
    # tolerant: flaky-disk mode — skip same-size files, log I/O failures
    # and continue instead of aborting (Steam verify arbitrates afterward)
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
if [[ -z "$(find "$DEPOT" -maxdepth 1 -name 'Manifest_*.txt' -print -quit)" ]]; then
  if [[ $NOMANIFEST -eq 1 ]]; then
    echo "SKIP: depot ships no Manifest_*.txt (--no-manifest given)."
    echo "      structural sanity: $(find "$DEPOT" -type f | wc -l | tr -d ' ') files, $(du -sh "$DEPOT" | cut -f1) total"
    EXES=$(find "$DEPOT" -name '*.exe' | wc -l | tr -d ' ')
    if [[ "$EXES" -eq 0 ]]; then
      echo "WARNING: no .exe found in depot tree." >&2
    else
      echo "      entry point(s): $(find "$DEPOT" -name '*.exe' | sed "s|^$DEPOT/||")"
    fi
  else
    echo "NO manifest file found in $DEPOT" >&2
    echo "this depot ships without one — re-run with --no-manifest to skip verification." >&2
    exit 1
  fi
else
  python3 "$SCRIPT_DIR/steamdepot.py" verify --depot "$DEPOT"
  V=$?
  if [[ $V -ne 0 ]]; then
    echo "verification FAILED — fix the download (re-run download_depot) before assembling." >&2
    exit "$V"
  fi
fi

echo
echo "== assemble =="
echo "  depot : $DEPOT"
echo "  target: $TARGET"
mkdir -p "$TARGET"
MOVED=0; SKIPPED=0

# die loudly if a move didn't land where expected — silent loss on this
# path once cost a full 66GB re-download.
assert_moved() { # $1 = source (must be gone), $2 = dest (must exist)
  if [[ -e "$1" ]]; then
    echo "MOVE FAILED: source still exists: $1" >&2
    echo "target left untouched — fix the cause and re-run." >&2
    exit 1
  fi
  if [[ ! -e "$2" ]]; then
    echo "MOVE FAILED: dest missing after move: $2 (from $1)" >&2
    echo "STOP — files may be lost. Do not write the manifest yet." >&2
    exit 1
  fi
}

# recursive merge: move src tree into dst, descending into same-named dirs
# instead of nesting or failing on "Directory not empty".
merge_tree() { # $1 = src dir, $2 = dst dir
  local src="$1" dst="$2" item name
  mkdir -p "$dst"
  shopt -s dotglob nullglob
  for item in "$src"/*; do
    name=$(basename "$item")
    case "$name" in
      Manifest_*.txt) echo "  keep (metadata): $name"; continue;;
    esac
    if [[ -d "$item" && -d "$dst/$name" ]]; then
      # dir exists on both sides: descend (this is also how a depot top dir
      # lands nested under a same-named installdir — verbatim layout, correct)
      merge_tree "$item" "$dst/$name"
      rmdir "$item" 2>/dev/null || true
    elif [[ -f "$item" && -f "$dst/$name" ]]; then
      # same relative path in two depots (e.g. shared movies): last assembled
      # wins, mirroring a real Steam install — but say so loudly, because only
      # content_log.txt reveals which depot Steam actually requires
      SZ_OLD=$(stat -f %z "$dst/$name" 2>/dev/null || echo ?)
      SZ_NEW=$(stat -f %z "$item" 2>/dev/null || echo ?)
      if [[ $TOLERANT -eq 1 && "$SZ_OLD" == "$SZ_NEW" && "$SZ_OLD" != "?" ]]; then
        echo "  skip (tolerant, same size ${SZ_OLD}B): ${dst#$TARGET/}/$name"
        SKIPPED=$((SKIPPED+1))
      else
        echo "  OVERWRITE (overlap): ${dst#$TARGET/}/$name  old=${SZ_OLD}B new=${SZ_NEW}B"
        if [[ $DRY -eq 1 ]]; then
          echo "  would overwrite with: ${item#$DEPOT/}"
        elif [[ $TOLERANT -eq 1 ]]; then
          if mv "$item" "$dst/$name" 2>/dev/null && [[ ! -e "$item" && -e "$dst/$name" ]]; then
            MOVED=$((MOVED+1))
          else
            echo "  FAILED (I/O, left in depot): ${item#$DEPOT/}" >&2
            FAILED=1
          fi
        else
          mv "$item" "$dst/$name"
          assert_moved "$item" "$dst/$name"
          MOVED=$((MOVED+1))
        fi
      fi
    elif [[ -e "$dst/$name" ]]; then
      echo "  skip (exists, keeping existing): ${dst#$TARGET/}/$name"
      SKIPPED=$((SKIPPED+1))
    else
      if [[ $DRY -eq 1 ]]; then
        echo "  would move: ${item#$DEPOT/} -> ${dst#$TARGET/}/$name"
      elif [[ $TOLERANT -eq 1 ]]; then
        if mv "$item" "$dst/" 2>/dev/null && [[ ! -e "$item" && -e "$dst/$name" ]]; then
          echo "  moved: ${dst#$TARGET/}/$name"
          MOVED=$((MOVED+1))
        else
          echo "  FAILED (I/O, left in depot): ${item#$DEPOT/}" >&2
          FAILED=1
        fi
      else
        mv "$item" "$dst/"
        assert_moved "$item" "$dst/$name"
        echo "  moved: ${dst#$TARGET/}/$name"
        MOVED=$((MOVED+1))
      fi
    fi
  done
  shopt -u dotglob nullglob
}

merge_tree "$DEPOT" "$TARGET"
echo
# The depot content now lives in the tree — but the resume-state file stays
# behind, and a later `download_depot` reads it and prints a FALSE COMPLETE
# (0 bytes fetched, cache empty). Remove it so the next fetch starts clean.
STATE="$(dirname "$DEPOT")/state_${APPID}_${DEPOTID}.patch"
if [[ $DRY -eq 1 ]]; then
  echo "dry run: $MOVED item(s) would move, $SKIPPED skipped. Nothing changed."
else
  echo "done: $MOVED moved, $SKIPPED skipped (existing content preserved)."
  if [[ $FAILED -ne 0 ]]; then
    echo "WARNING: some moves FAILED with I/O errors (listed above as FAILED)." >&2
    echo "Those files were left in the depot. Steam verify arbitrates what's" >&2
    echo "actually needed; re-run to retry, or fetch individually." >&2
    echo "(resume state kept, so a re-run download_depot resumes)" >&2
    exit 1
  fi
  if [[ -e "$STATE" ]]; then
    rm -f "$STATE"
    echo "cleared stale resume state: $STATE"
    echo "(re-running download_depot for this depot now starts a clean fetch)"
  fi
  echo "next: write the appmanifest:"
  echo "  steamdepot.py manifest --appid $APPID --library $LIBRARY \\"
  echo "    --installdir '$INSTALLDIR' --name '<title>' --buildid <id> \\"
  echo "    --depot <depotid>:<manifest gid from 'Depot download complete'>:<size>"
fi
