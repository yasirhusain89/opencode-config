#!/bin/bash
# weekly_pull.sh — unattended refresh for the model-benchmarks skill:
#   1. OpenRouter catalog snapshot + value report (with deltas vs previous)
#   2. provider inventory snapshot (opencode/nvidia/ollama model lists)
#   3. dashboard regen + guide splice (usage, reliability, drift, pacing)
#   4. AA Coding Agent Index version check (alerts on benchmark version bump)
#   5. test suites (both must stay green)
# Notable findings are appended to snapshots/CHANGELOG.md.
#
# Idempotent: exits early when the newest catalog is < 7 days old, so it is
# safe to run on login (RunAtLoad catch-up) as well as on the Monday 06:00
# schedule, and safe to re-run by hand. Needs playwright-core for the
# catalog + version checks: run from a dir that has it, or set PW_CORE.
set -u
SKILL="$HOME/.config/opencode/skills/model-benchmarks"
SCRIPTS="$SKILL/scripts"
SNAP="$SKILL/snapshots"
REPORTS="$SNAP/reports"
NODE=/opt/homebrew/bin/node
T=$(date +%F)
FAIL=0

mkdir -p "$REPORTS"
echo "=== weekly pull $T $(date +%T) ===" >> "$REPORTS/weekly.log"

# --- staleness guard: a fresh catalog means nothing to do ---
NEWEST=$(ls "$SNAP"/or-catalog-*.json 2>/dev/null | sort | tail -1 || true)
if [ -n "$NEWEST" ]; then
  AGE_DAYS=$(( ( $(date +%s) - $(stat -f %m "$NEWEST" 2>/dev/null || stat -c %Y "$NEWEST") ) / 86400 ))
  if [ "$AGE_DAYS" -lt 7 ]; then
    echo "catalog fresh ($NEWEST, ${AGE_DAYS}d old) — nothing to do" >> "$REPORTS/weekly.log"
    exit 0
  fi
fi

# --- 1+2. OR catalog + value report ---
"$NODE" "$SCRIPTS/or_catalog.mjs" --out "$SNAP/or-catalog-$T.json" >> "$REPORTS/weekly.log" 2>&1 || {
  echo "catalog pull FAILED" >> "$REPORTS/weekly.log"; FAIL=1; }

PREV=$(ls "$SNAP"/or-catalog-*.json 2>/dev/null | grep -v "$T" | sort | tail -1 || true)
CODING=$(ls "$SNAP"/coding-index-*.json 2>/dev/null | sort | tail -1 || true)

if [ "$FAIL" -eq 0 ]; then
# shellcheck disable=SC2086
"$NODE" "$SCRIPTS/weekly_report.mjs" --catalog "$SNAP/or-catalog-$T.json" \
  ${PREV:+--prev "$PREV"} ${CODING:+--coding "$CODING"} \
  --out "$REPORTS/$T-value.md" >> "$REPORTS/weekly.log" 2>&1 || {
  echo "report FAILED" >> "$REPORTS/weekly.log"; FAIL=1; }
fi

# --- 3. provider inventory ---
if [ "$FAIL" -eq 0 ]; then
"$NODE" "$SCRIPTS/aa_bench.mjs" inventory --out "$SNAP/access-$T.json" >> "$REPORTS/weekly.log" 2>&1 || {
  echo "inventory FAILED" >> "$REPORTS/weekly.log"; FAIL=1; }
fi

# --- 4. dashboard regen + guide splice ---
if [ "$FAIL" -eq 0 ]; then
"$NODE" "$SCRIPTS/dashboard.mjs" --date "$T" --out "$SNAP/dashboard-$T.json" --write-guide "$SKILL/model-selection-guide.html" >> "$REPORTS/weekly.log" 2>&1 || {
  echo "dashboard FAILED" >> "$REPORTS/weekly.log"; FAIL=1; }
fi

# --- 4b. personality indexes (supplementary; never fails the run) ---
if [ "$FAIL" -eq 0 ]; then
if [ -f "$SNAP/personality-$T.json" ]; then
  echo "personality fresh ($T) — skipping" >> "$REPORTS/weekly.log"
else
  "$NODE" "$SCRIPTS/aa_bench.mjs" personality --out "$SNAP/personality-$T.json" >> "$REPORTS/weekly.log" 2>&1 || echo "personality FAILED (supplementary; continuing)" >> "$REPORTS/weekly.log"
fi
fi

# --- 5. AA index version check (alert only, never fails the run) ---
if [ -f "$SNAP/aa-index-version.txt" ] && [ "$FAIL" -eq 0 ]; then
  EXPECTED=$(cat "$SNAP/aa-index-version.txt")
  VER_OUT=$("$NODE" "$SCRIPTS/aa_version.mjs" --expect "$EXPECTED" 2>&1)
  VER_RC=$?
  echo "$VER_OUT" >> "$REPORTS/weekly.log"
  if [ "$VER_RC" -eq 2 ]; then
    echo "AA INDEX VERSION CHANGED (was $EXPECTED)" >> "$REPORTS/weekly.log"
    {
      echo ""; echo "## $T — AA index version drift (weekly pull)"
        echo "- Coding Agent Index version differs from pinned $EXPECTED."
      echo "- Action: re-run \`coding\` pull, refresh guide §2/§17 + SKILL agentic table."
    } >> "$SNAP/CHANGELOG.md"
  elif [ "$VER_RC" -ne 0 ]; then
    echo "aa_version check errored (site blocked?); continuing" >> "$REPORTS/weekly.log"
  fi
fi

# --- 6. test suites ---
"$NODE" "$SCRIPTS/aa_bench.test.mjs" >> "$REPORTS/weekly.log" 2>&1 || {
  echo "aa_bench tests FAILED" >> "$REPORTS/weekly.log"; FAIL=1; }
"$NODE" "$SCRIPTS/dashboard.test.mjs" >> "$REPORTS/weekly.log" 2>&1 || {
  echo "dashboard tests FAILED" >> "$REPORTS/weekly.log"; FAIL=1; }

# --- 7. changelog notable findings from today's dashboard ---
if [ "$FAIL" -eq 0 ] && [ -f "$SNAP/dashboard-$T.json" ]; then
  "$NODE" -e "
const j = require('$SNAP/dashboard-$T.json');
const notes = [];
const dead = [...new Set((j.deadPins || []).map(d => d.model))];
if (dead.length) notes.push('- Dead pins: ' + dead.join(', '));
const unm = [...new Set((j.unmatchedCheckPins || []).map(d => d.model))];
if (unm.length) notes.push('- No AA coverage: ' + unm.join(', '));
if (notes.length) {
  const fs = require('fs');
  fs.appendFileSync('$SNAP/CHANGELOG.md', '\n## $T \u2014 weekly pull findings\n' + notes.join('\n') + '\n');
  console.log('changelog updated: ' + notes.length + ' finding(s)');
} else console.log('no changelog-worthy findings');
" >> "$REPORTS/weekly.log" 2>&1 || echo "changelog append FAILED" >> "$REPORTS/weekly.log"
fi

if [ "$FAIL" -eq 0 ]; then
  echo "done: $REPORTS/$T-value.md" >> "$REPORTS/weekly.log"
else
  echo "weekly pull $T finished WITH FAILURES (see above)" >> "$REPORTS/weekly.log"
  exit 1
fi
