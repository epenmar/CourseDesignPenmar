#!/usr/bin/env bash
# install-airtable-cron.sh — Registers the nightly Airtable course sync with launchd.
# Idempotent: safe to run multiple times. Updates paths + log location.
#
# What it does:
#   - Reads Elisa's Course Developments from the ASU Online Airtable base
#   - Link-only stamps existing dashboard courses with their Airtable record ID
#     (never overwrites course data)
#   - Queues truly-new courses into Supabase `airtable_auto_imports` so the
#     dashboard shows a banner on next load
#
# Prerequisites:
#   - AIRTABLE_PAT=pat... must be set in /Users/epenmar/conductor/.env
#   - node must be on PATH
#
# Usage:
#   bash scripts/install-airtable-cron.sh          # install / update
#   bash scripts/install-airtable-cron.sh --test   # install + run a dry-run now
#   bash scripts/install-airtable-cron.sh --uninstall

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$SCRIPT_DIR/com.elisa.sync-airtable-courses.plist"
TARGET="$HOME/Library/LaunchAgents/com.elisa.sync-airtable-courses.plist"
LABEL="com.elisa.sync-airtable-courses"
LOG_PATH="$HOME/Library/Logs/sync-airtable-courses.log"
NODE_PATH="$(command -v node)"
SCRIPT_PATH="$SCRIPT_DIR/sync-airtable-courses.mjs"

uninstall() {
  echo "Unloading $LABEL…"
  launchctl unload "$TARGET" 2>/dev/null || true
  rm -f "$TARGET"
  echo "Removed $TARGET"
}

if [[ "${1:-}" == "--uninstall" ]]; then
  uninstall
  exit 0
fi

if [[ -z "$NODE_PATH" ]]; then
  echo "ERROR: node not found in PATH. Install Node before running this script." >&2
  exit 1
fi
if [[ ! -f "$SCRIPT_PATH" ]]; then
  echo "ERROR: $SCRIPT_PATH not found." >&2
  exit 1
fi
if ! grep -q '^AIRTABLE_PAT=' /Users/epenmar/conductor/.env 2>/dev/null; then
  echo "WARNING: AIRTABLE_PAT not found in /Users/epenmar/conductor/.env" >&2
  echo "         Add a line like: AIRTABLE_PAT=patXXXX.XXXXXXXX" >&2
  echo "         The sync will fail until this is set." >&2
fi

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$HOME/Library/Logs"

sed \
  -e "s|__NODE_PATH__|$NODE_PATH|g" \
  -e "s|__SCRIPT_PATH__|$SCRIPT_PATH|g" \
  -e "s|__LOG_PATH__|$LOG_PATH|g" \
  "$TEMPLATE" > "$TARGET"

launchctl unload "$TARGET" 2>/dev/null || true
launchctl load "$TARGET"

echo "✓ Installed $LABEL"
echo "  plist: $TARGET"
echo "  runs:  daily at 22:30 local time"
echo "  log:   $LOG_PATH"
echo ""
echo "Useful commands:"
echo "  tail -f $LOG_PATH                                    # watch the log"
echo "  launchctl list | grep sync-airtable-courses          # check status"
echo "  launchctl start $LABEL                               # run once now"
echo "  bash $SCRIPT_DIR/install-airtable-cron.sh --uninstall # remove"

if [[ "${1:-}" == "--test" ]]; then
  echo ""
  echo "--- Running a test dry-run now ---"
  "$NODE_PATH" "$SCRIPT_PATH" --dry
fi
