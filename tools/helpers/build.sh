#!/bin/bash
# Build branded helper .app wrappers into ~/Applications (no Xcode, no signing).
# Each wrapper keeps its bundle name + the OpenCode owl icon in Login Items >
# App Background Activity, instead of showing as "bash"/"python".
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="$HOME"
OWL="/Applications/OpenCode.app/Contents/Resources/icon.icns"
HOUSEKEEPING="$HOME_DIR/.config/opencode/scripts/opencode_db_housekeeping.sh"
DASHBOARD_PY="$HOME_DIR/.opencode/usage-dashboard/generate.py"
WEEKLY_SH="$HOME_DIR/.config/opencode/skills/model-benchmarks/scripts/weekly_pull.sh"

build_one() { # $1=name $2=bundle-id $3..=command
  local name="$1" bid="$2"; shift 2
  local app="$HOME_DIR/Applications/$name.app"
  local macos="$app/Contents/MacOS" res="$app/Contents/Resources"
  mkdir -p "$macos" "$res"
  swiftc -O -o "$macos/$name" "$SRC/launcher.swift"
  cp "$OWL" "$res/icon.icns"
  python3 - "$app/Contents/Info.plist" "$name" "$bid" "$@" <<'EOF'
import plistlib, sys
plist, name, bid, cmd = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
with open(plist, 'wb') as f:
    plistlib.dump({
        'CFBundleDisplayName': name, 'CFBundleName': name,
        'CFBundleExecutable': name, 'CFBundleIdentifier': bid,
        'CFBundlePackageType': 'APPL', 'CFBundleShortVersionString': '1.0',
        'CFBundleVersion': '1', 'CFBundleIconFile': 'icon.icns',
        'LSMinimumSystemVersion': '13.0', 'NSHighResolutionCapable': True,
        'OPCommand': cmd,
    }, f)
EOF
  echo "built $app"
}

build_one "OpenCode DB Maintain" "ai.opencode.helper.dbmaintain" /bin/bash "$HOUSEKEEPING" maintain
build_one "OpenCode DB Check" "ai.opencode.helper.dbcheck" /bin/bash "$HOUSEKEEPING" --check
build_one "OpenCode Usage Dashboard" "ai.opencode.helper.dashboard" /usr/bin/python3 "$DASHBOARD_PY"
build_one "OpenCode Model Benchmarks" "ai.opencode.helper.benchmarks" /bin/bash "$WEEKLY_SH"
