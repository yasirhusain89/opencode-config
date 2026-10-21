#!/usr/bin/env bash
# Housekeeping for opencode's sqlite session DB (default
# ~/.local/share/opencode/opencode.db). Read-only reporting by default; writes
# only in the mode you ask for. Never issues raw DELETEs — session removal
# goes through `opencode export` (archive) + `opencode session delete` (app
# handles cascades; part.session_id and event rows have no FK cascade from
# session, so raw SQL would orphan rows).
#
# Usage:
#   bash scripts/opencode_db_housekeeping.sh [report]   # sizes, pragmas, top sessions (read-only)
#   bash scripts/opencode_db_housekeeping.sh maintain   # wal checkpoint + analyze + optimize + integrity check
#   bash scripts/opencode_db_housekeeping.sh vacuum     # full VACUUM (refused while opencode runs; --force overrides)
#   bash scripts/opencode_db_housekeeping.sh prune --session <id> [--yes]
#   bash scripts/opencode_db_housekeeping.sh costs      # per-model/session cost+tokens review (read-only)
#   bash scripts/opencode_db_housekeeping.sh --check    # cron/launchd-friendly: exit 1 when over thresholds
#
# Env overrides:
#   OPENCODE_DB=path            DB path (default ~/.local/share/opencode/opencode.db)
#   OPENCODE_ARCHIVE_DIR=path   prune archives (default ~/.local/share/opencode/archive)
#   OPENCODE_HK_MAX_DB_MB=N     --check fails when DB file exceeds N MB (default 1536)
#   OPENCODE_HK_MAX_WAL_MB=N    --check fails when WAL exceeds N MB (default 64)
#   OPENCODE_HK_MAX_MSGS=N      --check fails when any session exceeds N messages (default 1000)
set -euo pipefail

DB="${OPENCODE_DB:-$HOME/.local/share/opencode/opencode.db}"
ARCHIVE_DIR="${OPENCODE_ARCHIVE_DIR:-$HOME/.local/share/opencode/archive}"
MAX_DB_MB="${OPENCODE_HK_MAX_DB_MB:-1536}"
MAX_WAL_MB="${OPENCODE_HK_MAX_WAL_MB:-64}"
MAX_MSGS="${OPENCODE_HK_MAX_MSGS:-1000}"

die() { echo "housekeeping: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }

file_mb() { # file_mb <path> -> MB with 1 decimal, 0.0 when missing
  if [ -f "$1" ]; then
    awk -v b="$(stat -f%z "$1" 2>/dev/null || stat -c%s "$1")" 'BEGIN { printf "%.1f", b/1024/1024 }'
  else
    echo "0.0"
  fi
}

opencode_running() {
  # Desktop app, serve/web servers, and CLI runs all hold the DB.
  pgrep -af "OpenCode\.app/Contents/MacOS/OpenCode|opencode (serve|web|attach)|/opencode$|opencode run" >/dev/null 2>&1
}

q() { sqlite3 "$DB" "$1"; }

cmd_report() {
  echo "db=$DB"
  echo "db_mb=$(file_mb "$DB") wal_mb=$(file_mb "$DB-wal") shm_mb=$(file_mb "$DB-shm")"
  echo "journal_mode=$(q 'PRAGMA journal_mode;') page_size=$(q 'PRAGMA page_size;') page_count=$(q 'PRAGMA page_count;') freelist=$(q 'PRAGMA freelist_count;') auto_vacuum=$(q 'PRAGMA auto_vacuum;')"
  echo "--- tables (rows / data MB) ---"
  q "SELECT 'event ' || COUNT(*) || ' / ' || printf('%.1f', SUM(LENGTH(data))/1024.0/1024.0) FROM event;"
  q "SELECT 'part ' || COUNT(*) || ' / ' || printf('%.1f', SUM(LENGTH(data))/1024.0/1024.0) FROM part;"
  q "SELECT 'message ' || COUNT(*) || ' / ' || printf('%.1f', SUM(LENGTH(data))/1024.0/1024.0) FROM message;"
  q "SELECT 'session ' || COUNT(*) FROM session;"
  echo "--- top sessions by messages ---"
  q "SELECT substr(s.id,1,18) || ' | ' || substr(s.title,1,44) || ' | msgs=' || COUNT(m.id) FROM session s LEFT JOIN message m ON m.session_id = s.id GROUP BY s.id ORDER BY COUNT(m.id) DESC LIMIT 8;"
  echo "--- top sessions by part bytes (MB) ---"
  q "SELECT substr(p.session_id,1,18) || ' | ' || printf('%.1f', SUM(LENGTH(p.data))/1024.0/1024.0) FROM part p GROUP BY p.session_id ORDER BY SUM(LENGTH(p.data)) DESC LIMIT 8;"
}

cmd_maintain() {
  # Safe while opencode runs: checkpoint + planner stats + cache tuning + check.
  echo "checkpoint: $(q 'PRAGMA wal_checkpoint(TRUNCATE);')"
  q "PRAGMA analyze;"
  q "PRAGMA optimize;"
  local ok
  ok="$(q 'PRAGMA integrity_check;')"
  echo "integrity_check: $ok"
  [ "$ok" = "ok" ] || die "integrity check failed — stop opencode and investigate before any vacuum/prune"
  echo "maintain done"
}

cmd_vacuum() {
  local force=0
  [ "${1:-}" = "--force" ] && force=1
  if [ "$force" -eq 0 ] && opencode_running; then
    die "opencode is running (DB holders found) — VACUUM needs an exclusive lock. Quit opencode (desktop + servers + CLI runs) and retry, or pass --force to attempt anyway"
  fi
  # VACUUM rewrites the whole file: refuse when free space is short (same
  # 10GiB heuristic as plugins/disk-guard.ts).
  local free_kb db_kb
  free_kb="$(df -k -P "$(dirname "$DB")" | awk 'END { print $4 }')"
  db_kb="$(du -sk "$DB" | awk '{ print $1 }')"
  if [ "$((free_kb / 1024 / 1024))" -lt 10 ] || [ "$free_kb" -lt "$((db_kb * 2))" ]; then
    die "not enough free space for a safe VACUUM (need >=2x DB and >=10GiB)"
  fi
  cmd_maintain
  echo "vacuuming..."
  q "VACUUM;"
  q "PRAGMA analyze;"
  echo "vacuum done: db_mb=$(file_mb "$DB") freelist=$(q 'PRAGMA freelist_count;')"
}

cmd_prune() {
  local session="" yes=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --session) session="${2:-}"; shift 2 ;;
      --yes) yes=1; shift ;;
      *) die "prune usage: prune --session <sessionID> [--yes]" ;;
    esac
  done
  [ -n "$session" ] || die "prune usage: prune --session <sessionID> [--yes]"
  need opencode
  q "SELECT id || ' | ' || substr(title,1,60) || ' | msgs=' || (SELECT COUNT(*) FROM message WHERE session_id = session.id) FROM session WHERE id = '$session';" | grep -q . || die "unknown session: $session"
  mkdir -p "$ARCHIVE_DIR"
  local archive="$ARCHIVE_DIR/${session}.json"
  [ -e "$archive" ] && die "archive already exists: $archive (refusing to overwrite)"
  echo "exporting $session -> $archive"
  opencode export "$session" > "$archive"
  [ -s "$archive" ] || die "export produced an empty file — aborting before delete"
  if [ "$yes" -eq 0 ]; then
    printf 'delete session %s (archived at %s)? [y/N] ' "$session" "$archive"
    read -r ans
    [ "$ans" = "y" ] || die "aborted"
  fi
  opencode session delete "$session"
  q "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
  echo "pruned $session (archive kept at $archive). Run 'vacuum' while opencode is stopped to reclaim space."
}

cmd_check() {
  # Cheap, cron-friendly: file sizes + indexed message counts only (no full
  # data scans). Exit 1 with reasons when over thresholds.
  local fail=0
  local db_mb wal_mb top_msgs
  db_mb="$(file_mb "$DB")"
  wal_mb="$(file_mb "$DB-wal")"
  top_msgs="$(q 'SELECT IFNULL(MAX(c),0) FROM (SELECT COUNT(*) c FROM message GROUP BY session_id);')"
  echo "behind_check db_mb=$db_mb wal_mb=$wal_mb top_session_msgs=$top_msgs (limits: $MAX_DB_MB / $MAX_WAL_MB / $MAX_MSGS)"
  awk -v a="$db_mb" -v b="$MAX_DB_MB" 'BEGIN { exit !(a > b) }' && { echo "over: db_mb $db_mb > $MAX_DB_MB"; fail=1; } || true
  awk -v a="$wal_mb" -v b="$MAX_WAL_MB" 'BEGIN { exit !(a > b) }' && { echo "over: wal_mb $wal_mb > $MAX_WAL_MB"; fail=1; } || true
  [ "$top_msgs" -gt "$MAX_MSGS" ] && { echo "over: session with $top_msgs messages > $MAX_MSGS (archive it via prune)"; fail=1; }
  exit "$fail"
}

cmd_costs() {
  # Quantitative review without opening mega-sessions: session table carries
  # cost + token counters per session, so effectiveness-per-model review does
  # not need the (pruned) transcripts live. Full transcripts stay available in
  # prune archives (~/.local/share/opencode/archive/<sessionID>.json).
  # Snapshot over time with: ... costs > "$ARCHIVE_DIR/costs-$(date +%F).tsv"
  # model column holds a JSON blob on recent sessions: compact to id/provider/variant.
  local m="CASE WHEN model LIKE '{%' THEN IFNULL(json_extract(model,'\$.id'),'?') || '/' || IFNULL(json_extract(model,'\$.providerID'),'?') || '/' || IFNULL(json_extract(model,'\$.variant'),'default') ELSE IFNULL(model,'(null)') END"
  echo "--- totals ---"
  q "SELECT 'sessions=' || COUNT(*) || ' cost=' || printf('%.2f', IFNULL(SUM(cost),0)) || ' tok_in=' || IFNULL(SUM(tokens_input),0) || ' tok_out=' || IFNULL(SUM(tokens_output),0) || ' tok_reason=' || IFNULL(SUM(tokens_reasoning),0) FROM session;"
  echo "--- by model ---"
  q "SELECT ($m) || ' | sessions=' || COUNT(*) || ' | cost=' || printf('%.2f', IFNULL(SUM(cost),0)) || ' | tok_in=' || IFNULL(SUM(tokens_input),0) || ' | tok_out=' || IFNULL(SUM(tokens_output),0) FROM session GROUP BY model ORDER BY SUM(cost) DESC;"
  echo "--- top sessions by cost ---"
  q "SELECT substr(id,1,18) || ' | ' || printf('%.2f', IFNULL(cost,0)) || ' | ' || ($m) || ' | ' || IFNULL(agent,'?') || ' | ' || substr(title,1,44) FROM session ORDER BY cost DESC LIMIT 12;"
}

need sqlite3
[ -f "$DB" ] || die "DB not found: $DB"

mode="${1:-report}"
shift || true
case "$mode" in
  report) cmd_report ;;
  maintain) cmd_maintain ;;
  vacuum) cmd_vacuum "${1:-}" ;;
  prune) cmd_prune "$@" ;;
  costs) cmd_costs ;;
  --check) cmd_check ;;
  *) die "unknown mode: $mode (report|maintain|vacuum|prune|costs|--check)" ;;
esac
