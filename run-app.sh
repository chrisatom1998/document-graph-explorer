#!/usr/bin/env bash
# Launch the installed Document Graph Explorer app detached from this terminal.
# If the source tree has changed since the installed app was built (or no app
# is installed yet), rebuild and redeploy first so you never run a stale build.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

APP_PATH="/Applications/Document Graph Explorer.app"

needs_rebuild() {
  [ ! -d "$APP_PATH" ] && return 0
  # Any tracked source newer than the installed bundle means the app is stale.
  local newer
  newer=$(find src desktop public scripts index.html vite.config.ts tsconfig.json package.json \
    -type f -newer "$APP_PATH" -print -quit 2>/dev/null || true)
  [ -n "$newer" ]
}

if needs_rebuild; then
  echo "Installed app is missing or older than the source tree — rebuilding…"
  ./rebuild.sh
fi

open -a "$APP_PATH"
