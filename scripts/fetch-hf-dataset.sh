#!/usr/bin/env bash
# Parallel download of every file in a Hugging Face dataset repo.
# Usage: fetch-hf-dataset.sh <owner/name> <out-dir> [connections]
set -euo pipefail
REPO="$1"; OUT="$2"; CONN="${3:-12}"
mkdir -p "$OUT"
curl -sf "https://huggingface.co/api/datasets/$REPO/tree/main?recursive=true" | python3 -c '
import json,sys
for f in json.load(sys.stdin):
    if f.get("type")=="file": print(f["path"], f.get("size",0))' > "$OUT/.files.txt"
echo "$REPO: $(wc -l < "$OUT/.files.txt" | tr -d " ") files"
export REPO OUT
< "$OUT/.files.txt" xargs -P "$CONN" -L 1 sh -c '
  dest="$OUT/$0"; mkdir -p "$(dirname "$dest")"
  [ -f "$dest" ] && [ "$(stat -f%z "$dest")" = "$1" ] && exit 0
  curl -sfL --retry 6 --retry-delay 3 -o "$dest" "https://huggingface.co/datasets/$REPO/resolve/main/$0" || echo "failed: $0"'
echo "done $REPO -> $OUT"
