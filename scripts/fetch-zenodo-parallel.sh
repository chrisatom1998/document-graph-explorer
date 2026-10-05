#!/usr/bin/env bash
# Parallel, resumable Zenodo download. Zenodo caps each connection (~1 MB/s), so every
# file is split into ranged chunks fetched side by side, then joined and size-checked.
# Usage: fetch-zenodo-parallel.sh <record-id> <out-dir> [connections]
set -euo pipefail
REC="$1"; OUT="$2"; CONN="${3:-24}"; CHUNK=$((200*1024*1024))
UA="document-graph-explorer-dataset-fetch/1.0 (local research use)"
mkdir -p "$OUT/.parts"
curl -sf -A "$UA" "https://zenodo.org/api/records/$REC" | python3 -c '
import json,sys
for f in json.load(sys.stdin)["files"]:
    print(f["key"], f["size"], f["links"]["self"])' > "$OUT/.parts/files.txt"

: > "$OUT/.parts/jobs.txt"
while read -r key size url; do
  [ -f "$OUT/$key" ] && [ "$(stat -f%z "$OUT/$key")" = "$size" ] && { echo "have $key"; continue; }
  i=0; start=0
  while [ "$start" -lt "$size" ]; do
    end=$((start+CHUNK-1)); [ "$end" -ge "$size" ] && end=$((size-1))
    part="$OUT/.parts/$key.$(printf %04d $i)"
    want=$((end-start+1))
    # A finished chunk survives a restart; a short one is fetched again.
    if [ ! -f "$part" ] || [ "$(stat -f%z "$part")" != "$want" ]; then
      echo "$url $start $end $part" >> "$OUT/.parts/jobs.txt"
    fi
    i=$((i+1)); start=$((end+1))
  done
done < "$OUT/.parts/files.txt"

n=$(wc -l < "$OUT/.parts/jobs.txt" | tr -d ' ')
echo "record $REC: $n chunks to fetch with $CONN connections"
export UA
< "$OUT/.parts/jobs.txt" xargs -P "$CONN" -L 1 sh -c \
  'curl -sfL --retry 6 --retry-delay 3 -A "$UA" -r "$1-$2" -o "$3" "$0" || echo "chunk failed: $3"'

while read -r key size url; do
  [ -f "$OUT/$key" ] && [ "$(stat -f%z "$OUT/$key")" = "$size" ] && continue
  cat "$OUT/.parts/$key".[0-9][0-9][0-9][0-9] > "$OUT/$key.tmp"
  got=$(stat -f%z "$OUT/$key.tmp")
  if [ "$got" = "$size" ]; then mv "$OUT/$key.tmp" "$OUT/$key"; rm -f "$OUT/.parts/$key".[0-9][0-9][0-9][0-9]; echo "done $key ($((size/1048576)) MB)"
  else rm -f "$OUT/$key.tmp"; echo "INCOMPLETE $key: $got of $size bytes - rerun to resume"; fi
done < "$OUT/.parts/files.txt"
