#!/usr/bin/env bash
# install-jira-time-cron.sh — Registers the nightly Jira time sync with launchd.
# Idempotent: safe to run multiple times. Updates paths + log location.
#
# Usage:
#   bash scripts/install-jira-time-cron.sh          # install / update
#   bash scripts/install-jira-time-cron.sh --test   # install + run now
#   bash scripts/install-jira-time-cron.sh --uninstall

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$SCRIPT_DIR/com.elisa.sync-jira-time.plist"
TARGET="$HOME/Library/LaunchAgents/com.elisa.sync-jira-time.plist"
LABEL="com.elisa.sync-jira-time"
LOG_PATH="$HOME/Library/Logs/sync-jira-time.log"
NODE_PATH="$(command -v node)"
SCRIPT_PATH="$SCRIPT_DIR/sync-jira-time.mjs"

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

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$HOME/Library/Logs"

# Render the template with real paths
sed \
  -e "s|__NODE_PATH__|$NODE_PATH|g" \
  -e "s|__SCRIPT_PATH__|$SCRIPT_PATH|g" \
  -e "s|__LOG_PATH__|$LOG_PATH|g" \
  "$TEMPLATE" > "$TARGET"

# Reload (unload first so updates take effect)
launchctl unload "$TARGET" 2>/dev/null || true
launchctl load "$TARGET"

echo "✓ Installed $LABEL"
echo "  plist: $TARGET"
echo "  runs:  daily at 23:00 local time"
echo "  log:   $LOG_PATH"
echo ""
echo "Useful commands:"
echo "  tail -f $LOG_PATH                                      # watch the log"
echo "  launchctl list | grep sync-jira-time                   # check status"
echo "  launchctl start $LABEL                                 # run once now"
echo "  bash $SCRIPT_DIR/install-jira-time-cron.sh --uninstall # remove"

if [[ "${1:-}" == "--test" ]]; then
  echo ""
  echo "--- Running a test dry-run now ---"
  "$NODE_PATH" "$SCRIPT_PATH" --dry
fi
