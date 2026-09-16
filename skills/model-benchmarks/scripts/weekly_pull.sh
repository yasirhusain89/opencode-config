#!/bin/bash
# weekly_pull.sh — unattended weekly pull for the model-benchmarks skill:
#   1. OpenRouter catalog snapshot
#   2. value report (joined with curated AA data + deltas vs previous)
# Logs to snapshots/reports/weekly.log. Safe to re-run by hand.
set -u
SKILL="$HOME/.config/opencode/skills/model-benchmarks"
SCRIPTS="$SKILL/scripts"
SNAP="$SKILL/snapshots"
REPORTS="$SNAP/reports"
NODE=/opt/homebrew/bin/node
T=$(date +%F)

mkdir -p "$REPORTS"
echo "=== weekly pull $T $(date +%T) ===" >> "$REPORTS/weekly.log"

"$NODE" "$SCRIPTS/or_catalog.mjs" --out "$SNAP/or-catalog-$T.json" >> "$REPORTS/weekly.log" 2>&1 || {
  echo "catalog pull FAILED" >> "$REPORTS/weekly.log"; exit 1; }

PREV=$(ls "$SNAP"/or-catalog-*.json 2>/dev/null | grep -v "$T" | sort | tail -1 || true)
CODING=$(ls "$SNAP"/coding-index-*.json 2>/dev/null | sort | tail -1 || true)

# shellcheck disable=SC2086
"$NODE" "$SCRIPTS/weekly_report.mjs" --catalog "$SNAP/or-catalog-$T.json" \
  ${PREV:+--prev "$PREV"} ${CODING:+--coding "$CODING"} \
  --out "$REPORTS/$T-value.md" >> "$REPORTS/weekly.log" 2>&1 || {
  echo "report FAILED" >> "$REPORTS/weekly.log"; exit 1; }

echo "done: $REPORTS/$T-value.md" >> "$REPORTS/weekly.log"
