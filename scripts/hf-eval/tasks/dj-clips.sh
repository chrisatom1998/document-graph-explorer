#!/usr/bin/env bash
# The DJ clip test (.github/workflows/dj-clips-eval.yml, round 1; dj-clips-eval-round2.yml, round 2) in the real built
# app on HF Jobs. TASK_ARGS = r1 (500 OpenMIC tags + 500 GiantSteps tempo) or r2 (500 OpenMIC + 500 GiantSteps MTG key).
#   run:     every part rebuilds both frozen sets from the public sources (checked against the committed manifests),
#            builds the app and analyses its own 1/PARTS of each set in headless Chromium.
#   collect: the round's own scorers (scripts/mixed-music/score.mjs, scripts/dj-clips/score-giantsteps.mjs).
set -euo pipefail
ROUND=${TASK_ARGS:-r1}
OPENMIC='https://zenodo.org/records/1432913/files/openmic-2018-v1.0.0.tgz?download=1'
if [ "$ROUND" = r1 ]; then
  DOCS=docs/evaluations/dj-clips-2026-10-06; PICK=openmic.py; K=giantsteps; KMAN=giantsteps-manifest.json
  KREPO=https://github.com/GiantSteps/giantsteps-tempo-dataset.git; KREF=d51ab2422e76abacfaa86616a57054bc222ec9fd; KPICK=giantsteps.py; BENCH=
else
  DOCS=docs/evaluations/dj-clips-round2-2026-10-06; PICK=openmic-round2.py; K=mtgkey; KMAN=mtg-key-manifest.json
  KREPO=https://github.com/GiantSteps/giantsteps-mtg-key-dataset.git; KREF=fd7b8c584f7bd6d720d170c325a6d42c9bf75a6b; KPICK=mtg-key.py; BENCH=dj-clips-round2-2026-10-06/
fi
case "$1" in
run)
  cd "$APP"
  curl -fsSL --retry 6 -o $WORK/openmic.tgz "$OPENMIC" && echo "e4ccf187e2bb5ab2e115416e8aafe7f4  $WORK/openmic.tgz" | md5sum -c -
  python3 scripts/dj-clips/$PICK $WORK/openmic.tgz $WORK/audio-openmic && rm $WORK/openmic.tgz
  git clone -q $KREPO $WORK/k && git -C $WORK/k checkout -q $KREF
  python3 scripts/dj-clips/$KPICK $WORK/k $WORK/audio-$K
  git diff --quiet -- $DOCS || { echo "a frozen manifest changed:"; git diff --stat -- $DOCS; exit 1; }
  # The harness's driver: it handles both the old toolbar and the Resonance layout (#137).
  cp "$HARNESS/scripts/short-clip-upload-eval.mjs" scripts/
  npx playwright install --with-deps chromium > /dev/null
  npm run build > $WORK/build.log 2>&1 || { tail -40 $WORK/build.log; exit 1; }
  export CHROME_PATH=$(node -e "console.log(require('playwright').chromium.executablePath())")
  P=${PROCS:-$(( CPUS / 2 > 0 ? CPUS / 2 : 1 ))}; fail=0
  for set in openmic $K; do
    [ $set = openmic ] && { EXT=ogg; MAN=$DOCS/openmic-manifest.json; } || { EXT=wav; MAN=$DOCS/$KMAN; }
    pids=()
    for p in $(seq 0 $((P - 1))); do
      ( AUDIO_DIR=$WORK/audio-$set AUDIO_EXT=$EXT MANIFEST=$MAN PORT=$((4300 + p)) SHARD=$(( PART * P + p ))/$(( PARTS * P )) \
        node scripts/short-clip-upload-eval.mjs $OUT/$set/run-$p test 20 ) > $WORK/$set-$p.log 2>&1 &
      pids+=($!)
    done
    for k in "${!pids[@]}"; do wait "${pids[$k]}" || { fail=1; echo "$set browser $k failed:"; tail -5 $WORK/$set-$k.log; }; done
  done
  exit $fail ;;
collect)
  SHARDS=$2; R=$3; mkdir -p "$R"
  APP_SHA=$(cat $SHARDS/part-0/app-commit.txt)
  for f in $SHARDS/part-*/app-commit.txt; do [ "$(cat $f)" = "$APP_SHA" ] || { echo "$f is not $APP_SHA"; exit 1; }; done
  cd "$APP" && npm ci --no-audit --no-fund --loglevel=error
  set -o pipefail
  OM=$(ls $SHARDS/part-*/openmic/run-*/graph-export.json); KX=$(ls $SHARDS/part-*/$K/run-*/graph-export.json)
  node -e "const m=require('./'+process.argv[1]);m.items=m.items.filter(i=>i.djTier==='dj genre');require('fs').writeFileSync('$WORK/dj-tier.json',JSON.stringify(m))" $DOCS/openmic-manifest.json
  MANIFEST=$DOCS/openmic-manifest.json BENCHMARK=${BENCH:-dj-clips-2026-10-06/}openmic npx vite-node scripts/mixed-music/score.mjs "$R/openmic-tags.json" $OM | tee "$R/openmic-tags.txt"
  MANIFEST=$WORK/dj-tier.json BENCHMARK=${BENCH:-dj-clips-2026-10-06/}openmic-dj-genres npx vite-node scripts/mixed-music/score.mjs "$R/openmic-tags-dj-genres.json" $OM | tee "$R/openmic-tags-dj-genres.txt"
  node scripts/compare-tag-reports.mjs --min-positives 5 "$R/openmic-tags.json" | tee -a "$R/openmic-tags.txt" || true
  node scripts/compare-tag-reports.mjs --min-positives 5 "$R/openmic-tags-dj-genres.json" | tee -a "$R/openmic-tags-dj-genres.txt" || true
  MANIFEST=$DOCS/$KMAN BENCHMARK=${BENCH:-dj-clips-2026-10-06/}$K npx vite-node scripts/dj-clips/score-giantsteps.mjs "$R/$K.json" $KX | tee "$R/$K.txt"
  echo "round $ROUND; app $APP_SHA; hf-eval run $RUN_KEY" > "$R/tested-commit.txt" ;;
esac
