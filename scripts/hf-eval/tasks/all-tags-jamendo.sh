#!/usr/bin/env bash
# The all-tags full-song test (.github/workflows/all-tags-eval.yml) in the real built app on HF Jobs: 600 MTG-Jamendo
# split-0 validation songs, 26 tags, scored with the app's own display code. TASK_ARGS: optional track limit per part.
#   run:     fetch this part's tracks (byte ranges of the archive folders), build the app, analyse in headless Chromium (PROCS browsers in parallel).
#   collect: score all parts (scripts/all-tags/score.mjs, all/pick/check halves) and extract per-track records.
set -euo pipefail
DOCS=docs/evaluations/all-tags-2026-10-06
JM=https://raw.githubusercontent.com/MTG/mtg-jamendo-dataset/cafd8e20c265ed84f1e61f1c875327971f43a62f
case "$1" in
run)
  for f in data/splits/split-0/autotagging_instrument-validation.tsv data/raw_30s_cleantags.tsv \
           derived/music-classification-annotations/music-classification-annotations-clean.tsv data/download/raw_30s_audio-low_sha256_tracks.txt; do
    mkdir -p "$WORK/mj/$(dirname $f)"; curl -fsSL --retry 6 -o "$WORK/mj/$f" "$JM/$f"
  done
  python3 "$HARNESS/scripts/all-tags/select-jamendo-val.py" "$WORK/mj"
  python3 "$HARNESS/scripts/hf-eval/fetch-jamendo-ranges.py" "$HARNESS/$DOCS/jamendo-val-manifest.json" \
    "$WORK/mj/data/download/raw_30s_audio-low_sha256_tracks.txt" $PART/$PARTS $WORK/audio
  cd "$APP"
  # The harness's driver: it handles both the old toolbar and the Resonance layout (#137).
  cp "$HARNESS/scripts/short-clip-upload-eval.mjs" scripts/
  npx playwright install --with-deps chromium > /dev/null
  npm run build > $WORK/build.log 2>&1 || { tail -40 $WORK/build.log; exit 1; }
  export CHROME_PATH=$(node -e "console.log(require('playwright').chromium.executablePath())")
  # Browsers in parallel over the tracks fetched here; each gets its own preview port and output folder.
  ls $WORK/audio | sed 's/\.wav$//' | python3 -c "import json,sys; json.dump([l.strip() for l in sys.stdin if l.strip()], open('$WORK/ids.json','w'))"
  P=${PROCS:-$(( CPUS / 2 > 0 ? CPUS / 2 : 1 ))}; pids=()
  for p in $(seq 0 $((P - 1))); do
    ( cd "$APP" && AUDIO_DIR=$WORK/audio AUDIO_EXT=wav MANIFEST=$HARNESS/$DOCS/jamendo-val-manifest.json ONLY_IDS=$WORK/ids.json \
      SHARD=$p/$P PORT=$((4300 + p)) node scripts/short-clip-upload-eval.mjs $OUT/run-$p validation 20 ${TASK_ARGS:-} ) > $WORK/sub-$p.log 2>&1 &
    pids+=($!)
  done
  fail=0; for k in "${!pids[@]}"; do wait "${pids[$k]}" || { fail=1; echo "browser $k failed:"; tail -30 $WORK/sub-$k.log; }; done
  tail -n 2 $WORK/sub-*.log
  exit $fail ;;
collect)
  SHARDS=$2; RESULTS=$3; mkdir -p "$RESULTS"
  APP_SHA=$(cat $SHARDS/part-0/app-commit.txt)
  for f in $SHARDS/part-*/app-commit.txt; do [ "$(cat $f)" = "$APP_SHA" ] || { echo "$f is not $APP_SHA"; exit 1; }; done
  cd "$APP" && npm ci --no-audit --no-fund --loglevel=error
  mkdir -p scripts/all-tags scripts/dj-fix && cp "$HARNESS/scripts/all-tags/score.mjs" scripts/all-tags/ && cp "$HARNESS/scripts/dj-fix/extract.mjs" scripts/dj-fix/
  set -o pipefail
  for h in all pick check; do
    MANIFEST=$HARNESS/$DOCS/jamendo-val-manifest.json HALF=$h npx vite-node scripts/all-tags/score.mjs "$RESULTS/tags-$h.json" $SHARDS/part-*/run-*/graph-export.json | tee "$RESULTS/tags-$h.txt"
  done
  npx vite-node scripts/dj-fix/extract.mjs "$RESULTS/records.json" $SHARDS/part-*/run-*/graph-export.json
  echo "app $APP_SHA; hf-eval run $RUN_KEY" > "$RESULTS/tested-commit.txt" ;;
esac
