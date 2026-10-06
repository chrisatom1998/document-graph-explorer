#!/usr/bin/env bash
# The accuracy gate (.github/workflows/accuracy-gate-run.yml, PR #124) on HF Jobs: both sides of a change analysed in the
# real built app on the round 3 held-out set, scored with each side's own display code, and compared.
# app_ref = the head (it must carry scripts/accuracy-gate/); TASK_ARGS = <fast|full> [base commit] (default: main's tip).
#   run:     fetch this part's share of the audio, build base and head, analyse both in headless Chromium.
#   collect: score each side (head's scripts/holdout-r3 scorers and manifests) and run scripts/accuracy-gate/compare.mjs.
# Only aggregate reports leave the job. HELD_OUT=1: the workflow deletes the per-track exports from the HF dataset.
# HELD_OUT=1
set -euo pipefail
read -r MODE BASE_REF <<< "${TASK_ARGS:-fast}"; MODE=${MODE:-fast}
DOCS=docs/evaluations/holdout-r3-2026-10-06
JM=https://raw.githubusercontent.com/MTG/mtg-jamendo-dataset/cafd8e20c265ed84f1e61f1c875327971f43a62f
case "$1" in
run)
  git -C "$HARNESS" fetch -q origin "${BASE_REF:-main}" && git -C "$HARNESS" worktree add -q --detach $WORK/base FETCH_HEAD
  git -C $WORK/base rev-parse HEAD > $OUT/base-commit.txt; echo "base: $(git -C $WORK/base log -1 --format='%H %s')"
  node "$APP/scripts/accuracy-gate/subset.mjs" "$MODE" $WORK/m
  mkdir -p $WORK/mj && curl -fsSL --retry 6 -o $WORK/mj/sums.txt "$JM/data/download/raw_30s_audio-low_sha256_tracks.txt"
  python3 "$HARNESS/scripts/hf-eval/fetch-jamendo-ranges.py" $WORK/m/jamendo.json $WORK/mj/sums.txt $PART/$PARTS $WORK/audio/jamendo
  # MTG key: every part fetches the whole (small) set and analyses its own 1/PARTS of it.
  git clone -q https://github.com/GiantSteps/giantsteps-mtg-key-dataset.git $WORK/mk && git -C $WORK/mk checkout -q fd7b8c584f7bd6d720d170c325a6d42c9bf75a6b
  python3 "$APP/scripts/holdout-r3/select-mtg-key.py" $WORK/mk "$APP/$DOCS/round2-mtg-key-tracks.txt" $WORK/audio/mtgkey
  git -C "$APP" diff --quiet -- $DOCS/mtg-key-manifest.json || { echo "the frozen MTG key manifest changed"; exit 1; }
  (cd $WORK/base && npm ci --no-audit --no-fund --loglevel=error)
  (cd "$APP" && npx playwright install --with-deps chromium > /dev/null)
  export CHROME_PATH=$(cd "$APP" && node -e "console.log(require('playwright').chromium.executablePath())")
  P=${PROCS:-$(( CPUS / 2 > 0 ? CPUS / 2 : 1 ))}; fail=0
  for side in head base; do
    D=$([ $side = head ] && echo "$APP" || echo $WORK/base); cd "$D"
    # The head's driver drives both sides (it handles the old toolbar and the Resonance layout).
    [ $side = base ] && cp "$APP/scripts/short-clip-upload-eval.mjs" scripts/
    npm run build > $WORK/build-$side.log 2>&1 || { tail -40 $WORK/build-$side.log; exit 1; }
    for set in jamendo mtgkey; do
      ls $WORK/audio/$set | sed 's/\.wav$//' | python3 -c "import json,sys; json.dump([l.strip() for l in sys.stdin if l.strip()], open('$WORK/ids-$set.json','w'))"
      [ $set = mtgkey ] && OWN="$PART/$PARTS" || OWN=0/1
      pids=()
      for p in $(seq 0 $((P - 1))); do
        ( AUDIO_DIR=$WORK/audio/$set AUDIO_EXT=wav MANIFEST=$WORK/m/$set.json ONLY_IDS=$WORK/ids-$set.json PORT=$((4300 + p)) \
          SHARD=$(( ${OWN%/*} * P + p ))/$(( ${OWN#*/} * P )) node scripts/short-clip-upload-eval.mjs $OUT/$side-$set/run-$p test 20 ) > $WORK/$side-$set-$p.log 2>&1 &
        pids+=($!)
      done
      for k in "${!pids[@]}"; do wait "${pids[$k]}" || { fail=1; echo "$side $set browser $k failed:"; tail -5 $WORK/$side-$set-$k.log; }; done
    done
  done
  exit $fail ;;
collect)
  SHARDS=$2; RESULTS=$3; mkdir -p "$RESULTS"
  HEAD_SHA=$(cat $SHARDS/part-0/app-commit.txt); BASE_SHA=$(cat $SHARDS/part-0/base-commit.txt)
  for f in $SHARDS/part-*/app-commit.txt; do [ "$(cat $f)" = "$HEAD_SHA" ] || { echo "$f is not $HEAD_SHA"; exit 1; }; done
  for f in $SHARDS/part-*/base-commit.txt; do [ "$(cat $f)" = "$BASE_SHA" ] || { echo "$f is not $BASE_SHA"; exit 1; }; done
  git fetch -q origin "$BASE_SHA" && git worktree add -q --detach $WORK/base "$BASE_SHA"
  node "$APP/scripts/accuracy-gate/subset.mjs" "$MODE" $WORK/m
  set -o pipefail
  for side in head base; do
    D=$([ $side = head ] && echo "$APP" || echo $WORK/base); O=$WORK/reports/$side; mkdir -p $O
    (cd "$D" && npm ci --no-audit --no-fund --loglevel=error)
    [ $side = base ] && mkdir -p $D/scripts/holdout-r3 && cp "$APP"/scripts/holdout-r3/*.mjs $D/scripts/holdout-r3/
    EX=$(ls $SHARDS/part-*/$side-*/run-*/graph-export.json)
    cd "$D"
    MANIFEST=$WORK/m/jamendo.json npx vite-node scripts/holdout-r3/score-tags.mjs $O/jamendo-tags.json $EX > /dev/null
    MANIFEST=$WORK/m/jamendo-strict.json npx vite-node scripts/holdout-r3/score-tags.mjs $O/jamendo-tags-strict.json $EX > /dev/null
    MANIFEST=$WORK/m/mtgkey.json npx vite-node scripts/holdout-r3/score-tempo-key.mjs $O/mtgkey.json $EX > /dev/null
    node -e "const f=process.argv[1],r=JSON.parse(require('fs').readFileSync(f));delete r.rows;require('fs').writeFileSync(f,JSON.stringify(r,null,1))" $O/mtgkey.json
  done
  cd "$APP" && node scripts/accuracy-gate/compare.mjs $WORK/reports/base $WORK/reports/head "$RESULTS/summary.md" || true
  cp -r $WORK/reports/base $WORK/reports/head "$RESULTS/"
  echo "mode $MODE; head $HEAD_SHA; base $BASE_SHA; hf-eval run $RUN_KEY" > "$RESULTS/tested-commits.txt"
  cat "$RESULTS/summary.md" ;;
esac
