#!/usr/bin/env bash
# Launch the installed Document Graph Explorer app detached from this terminal.
set -euo pipefail

APP_PATH="/Applications/Document Graph Explorer.app"

if [ ! -d "$APP_PATH" ]; then
  echo "error: $APP_PATH does not exist. Run ./rebuild.sh first." >&2
  exit 1
fi

open -a "$APP_PATH"
