#!/usr/bin/env bash
# Run the real built app over the locked holdout and score what it displays.
# Usage: scripts/licensed-pilot/run_app.sh <dist-dir> <holdout.json> <free-tag-set dir> <out-dir> [shards=2]
# Uploads every holdout file, renamed to <holdout id><original extension> (no file-name hint), through the app's own
# "Add files" input in headless Chromium (scripts/short-clip-upload-eval.mjs, Full analysis mode, fresh profile),
# then reads the Sounds-panel tags with the app's display code (scripts/ui-export-tags.mjs) and scores them (score_app.py).
set -euo pipefail
DIST=$1 HOLD=$2 FTS=$3 OUT=$4 SHARDS=${5:-2}
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT/audio"
python3 -I - "$HOLD" "$FTS" "$OUT" <<'PY'
import json, os, sys
hold, fts, out = sys.argv[1:4]; items = json.load(open(hold))['items']; man = []
for i in items:
    ext = os.path.splitext(i['path'])[1].lower(); dst = os.path.join(out, 'audio', i['id'] + ext)
    if not os.path.exists(dst): os.symlink(os.path.join(fts, i['path']), dst)
    man.append({'id': i['id'], 'split': 'test', 'file': i['id'] + ext})
json.dump({'items': man}, open(os.path.join(out, 'driver-manifest.json'), 'w'))
PY
CHROME=${CHROME_PATH:-$(ls -d /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell 2>/dev/null | head -1)}
start=$(date +%s)
for ((k = 0; k < SHARDS; k++)); do
  MANIFEST="$OUT/driver-manifest.json" AUDIO_DIR="$OUT/audio" FILE_FIELD=file DIST="$DIST" CHROME_PATH="$CHROME" SHARD="$k/$SHARDS" PORT=$((${PORT_BASE:-4291} + k)) \
    node scripts/short-clip-upload-eval.mjs "$OUT/run-$k" test 20 > "$OUT/run-$k.log" 2>&1 &
done
wait
echo "app runs took $(( $(date +%s) - start )) s" | tee "$OUT/wall.txt"
TAGS=()
for ((k = 0; k < SHARDS; k++)); do
  npx vite-node scripts/ui-export-tags.mjs "$OUT/run-$k/graph-export.json" "$OUT/ui-tags-$k.json" > /dev/null
  TAGS+=("$OUT/ui-tags-$k.json")
done
python3 -I "$HERE/score_app.py" "$HOLD" "$OUT/score.json" "${TAGS[@]}"
