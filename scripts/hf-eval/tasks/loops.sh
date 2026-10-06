#!/usr/bin/env bash
# Tempo and key on 330 listener-checked FSL10K loops (scripts/hf-eval/data/fsl10k-loops-manifest.json: listener BPM on
# all 330, listener key on 194) in the real built app on HF Jobs, scored with scripts/dj-clips/score-giantsteps.mjs
# (tempo within 4%, key exact and MIREX). Earlier loop numbers came from scripts/loops/loop-features.mjs in Node, which
# skips the app's tempo model (#139); this is the app as a user runs it.
set -euo pipefail
MAN=$HARNESS/scripts/hf-eval/data/fsl10k-loops-manifest.json
case "$1" in
run)
  python3 "$HARNESS/scripts/hf-eval/fetch-fsl10k-loops.py" $MAN $WORK/audio $PART/$PARTS
  cd "$APP"
  cp "$HARNESS/scripts/short-clip-upload-eval.mjs" scripts/
  npx playwright install --with-deps chromium > /dev/null
  npm run build > $WORK/build.log 2>&1 || { tail -40 $WORK/build.log; exit 1; }
  export CHROME_PATH=$(node -e "console.log(require('playwright').chromium.executablePath())")
  ls $WORK/audio | sed 's/\.wav$//' | python3 -c "import json,sys; json.dump([l.strip() for l in sys.stdin if l.strip()], open('$WORK/ids.json','w'))"
  P=${PROCS:-$(( CPUS / 2 > 0 ? CPUS / 2 : 1 ))}; pids=(); fail=0
  for p in $(seq 0 $((P - 1))); do
    ( AUDIO_DIR=$WORK/audio AUDIO_EXT=wav MANIFEST=$MAN ONLY_IDS=$WORK/ids.json PORT=$((4300 + p)) SHARD=$p/$P \
      node scripts/short-clip-upload-eval.mjs $OUT/run-$p test 20 ) > $WORK/sub-$p.log 2>&1 &
    pids+=($!)
  done
  for k in "${!pids[@]}"; do wait "${pids[$k]}" || { fail=1; echo "browser $k failed:"; tail -5 $WORK/sub-$k.log; }; done
  exit $fail ;;
collect)
  SHARDS=$2; R=$3; mkdir -p "$R"
  APP_SHA=$(cat $SHARDS/part-0/app-commit.txt)
  for f in $SHARDS/part-*/app-commit.txt; do [ "$(cat $f)" = "$APP_SHA" ] || { echo "$f is not $APP_SHA"; exit 1; }; done
  cd "$APP" && npm ci --no-audit --no-fund --loglevel=error
  set -o pipefail
  MANIFEST=$MAN BENCHMARK=fsl10k-loops-330 npx vite-node scripts/dj-clips/score-giantsteps.mjs "$R/loops.json" $(ls $SHARDS/part-*/run-*/graph-export.json) | tee "$R/loops.txt"
  echo "app $APP_SHA; hf-eval run $RUN_KEY" > "$R/tested-commit.txt" ;;
esac
