#!/bin/bash
# Build OpenCodeCostBar.app into ~/Applications (no Xcode, no signing).
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
# Branded bundle name (matches Login Items + ai.opencode.costbar.plist).
APP="$HOME/Applications/OpenCode Cost Bar.app"
BIN="$APP/Contents/MacOS/OpenCodeCostBar"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$SRC/Info.plist" "$APP/Contents/Info.plist"
swiftc -O -framework AppKit -o "$BIN" "$SRC/main.swift"
echo "built $BIN"
"$BIN" --self-test
