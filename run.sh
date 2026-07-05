#!/bin/sh
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found on your PATH."
  echo "Install it from https://nodejs.org/ and try again."
  exit 1
fi

exec node scripts/serve.mjs
