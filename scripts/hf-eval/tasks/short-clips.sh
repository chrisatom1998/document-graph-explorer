#!/usr/bin/env bash
# The short-clip tag test (.github/workflows/short-clip-eval.yml, branch side) in the real built app on HF Jobs.
# TASK_ARGS = split (test, default, or calibration). Each part rebuilds its 1/PARTS of the split's audio from the public
# sources (scripts/short-clip-fetch-audio.py checks every duration) and analyses it; collect merges the exports and
# scores with scripts/short-clip-displayed.mjs + scripts/short-clip-report.py.
set -euo pipefail
SPLIT=${TASK_ARGS:-test}
case "$1" in
run)
  cd "$APP"
  python3 scripts/short-clip-fetch-audio.py $WORK/clips $SPLIT $WORK/sources
  cp "$HARNESS/scripts/short-clip-upload-eval.mjs" scripts/
  npx playwright install --with-deps chromium > /dev/null
  npm run build > $WORK/build.log 2>&1 || { tail -40 $WORK/build.log; exit 1; }
  export CHROME_PATH=$(node -e "console.log(require('playwright').chromium.executablePath())")
  P=${PROCS:-$(( CPUS / 2 > 0 ? CPUS / 2 : 1 ))}; pids=(); fail=0
  for p in $(seq 0 $((P - 1))); do
    ( AUDIO_DIR=$WORK/clips PORT=$((4300 + p)) SHARD=$(( PART * P + p ))/$(( PARTS * P )) \
      node scripts/short-clip-upload-eval.mjs $OUT/run-$p $SPLIT 60 ) > $WORK/sub-$p.log 2>&1 &
    pids+=($!)
  done
  for k in "${!pids[@]}"; do wait "${pids[$k]}" || { fail=1; echo "browser $k failed:"; tail -5 $WORK/sub-$k.log; }; done
  exit $fail ;;
collect)
  SHARDS=$2; R=$3; mkdir -p "$R"
  APP_SHA=$(cat $SHARDS/part-0/app-commit.txt)
  for f in $SHARDS/part-*/app-commit.txt; do [ "$(cat $f)" = "$APP_SHA" ] || { echo "$f is not $APP_SHA"; exit 1; }; done
  cd "$APP" && npm ci --no-audit --no-fund --loglevel=error
  # One export with every part's nodes, so the single-run scorers see the whole split.
  node -e "const fs=require('fs'),[out,...ps]=process.argv.slice(1),g=ps.map(p=>JSON.parse(fs.readFileSync(p,'utf8')));
    fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/graph-export.json',JSON.stringify({...g[0],nodes:g.flatMap(x=>x.nodes),edges:g.flatMap(x=>x.edges??[])}))" \
    $WORK/merged $(ls $SHARDS/part-*/run-*/graph-export.json)
  set -o pipefail
  npx vite-node scripts/short-clip-displayed.mjs $WORK/merged/graph-export.json $WORK/merged/r
  python3 scripts/short-clip-report.py $WORK/merged $SPLIT > "$R/report.json"
  node scripts/compare-tag-reports.mjs "$R/report.json" | tee "$R/report.txt"
  echo "split $SPLIT; app $APP_SHA; hf-eval run $RUN_KEY" > "$R/tested-commit.txt" ;;
esac
