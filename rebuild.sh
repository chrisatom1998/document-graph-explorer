#!/usr/bin/env bash
# Rebuild Document Graph Explorer and redeploy it to ~/Applications.
# Works even when npm/node aren't on PATH, by locating an nvm-installed Node.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  CANDIDATE=$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -n1 || true)
  if [ -n "$CANDIDATE" ]; then
    NODE_BIN="$CANDIDATE"
  fi
fi

if [ -z "$NODE_BIN" ]; then
  echo "error: no Node.js installation found (checked PATH and ~/.nvm)." >&2
  exit 1
fi

NODE_DIR="$(dirname "$NODE_BIN")"
NPM_CLI="$NODE_DIR/../lib/node_modules/npm/bin/npm-cli.js"

export PATH="$NODE_DIR:$PATH"
"$NODE_BIN" "$NPM_CLI" run build:desktop
