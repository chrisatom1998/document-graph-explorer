#!/usr/bin/env bash
# Score the shipped app's tags on the tag-baseline set with the app-path evaluator (scripts/eval-tag.ts), then write
# the per-tag table. Usage: scripts/tag-baseline/run.sh <work-dir> <out-dir> [shards=4]
# <work-dir> is what fetch.sh filled. Model outputs are cached in <work-dir>/cache, so a re-run only re-decides.
set -euo pipefail
W=${1:?work dir}; OUT=${2:?out dir}; N=${3:-4}; HERE=$(cd "$(dirname "$0")" && pwd)
TAGS=$(python3 -c "import json; print(','.join(json.load(open('$W/set/items.json'))['tags']))")
FIRST=${TAGS%%,*}; REST=${TAGS#*,}
common=(--set "$W/set/items.json" --audio-dir "$W/audio" --cache "$W/cache" --tag "$FIRST" --watch "$REST")
T0=$(date +%s)
for i in $(seq 0 $((N - 1))); do
  npx vite-node scripts/eval-tag.ts "${common[@]}" --score-only --shard "$i/$N" --threads $(( $(nproc) / N > 0 ? $(nproc) / N : 1 )) > "$W/score-$i.log" 2>&1 &
done
wait
T1=$(date +%s)
npx vite-node scripts/eval-tag.ts "${common[@]}" --decide-only --out "$W/report.json" > "$W/decide.log" 2>&1
T2=$(date +%s)
echo "score ${N} shards: $((T1 - T0)) s; decide: $((T2 - T1)) s" | tee "$W/timing.txt"
python3 "$HERE/summarize.py" "$W/report.json" "$W/set/items.json" "$OUT" --timing "$W/timing.txt"
