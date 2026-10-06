#!/usr/bin/env bash
# Round 3 held-out check (the "Build a fresh audio test set" thread's holdout-r3-eval.yml) in the real built app.
# TASK_ARGS = jamendo (500 MTG-Jamendo test tracks, sound tags) or mtgkey (318 Beatport MTG key tracks, tempo/key),
# optionally @<commit> to pin the test set's scripts and manifests (default: the tip of its branch, recorded per part).
#   run:     fetch this part's audio, build the app, analyse in headless Chromium.
#   collect: score with scripts/holdout-r3/*.mjs against the app's own src and push ONLY aggregate reports to
#            docs/evaluations/holdout-r3-2026-10-06/results/<label>/ on the test set's branch.
# HELD_OUT=1: the workflow deletes this run's per-track exports from the HF dataset after collecting.
set -euo pipefail
SET=${TASK_ARGS%%@*}; PIN=$([ "$TASK_ARGS" != "$SET" ] && echo "${TASK_ARGS#*@}" || true)
BRANCH=claude/fresh-audio-test-set-9fz3nu
DOCS=docs/evaluations/holdout-r3-2026-10-06
JM=https://raw.githubusercontent.com/MTG/mtg-jamendo-dataset/cafd8e20c265ed84f1e61f1c875327971f43a62f
case "$1" in
run)
  R3=$WORK/r3; git -C "$HARNESS" fetch -q origin "${PIN:-$BRANCH}"; git -C "$HARNESS" worktree add -q --detach "$R3" FETCH_HEAD
  git -C "$R3" rev-parse HEAD > $OUT/r3-commit.txt
  if [ "$SET" = jamendo ]; then
    for f in data/splits/split-0/autotagging_instrument-test.tsv data/raw_30s_cleantags.tsv \
             derived/music-classification-annotations/music-classification-annotations-clean.tsv data/download/raw_30s_audio-low_sha256_tracks.txt; do
      mkdir -p "$WORK/mj/$(dirname $f)"; curl -fsSL --retry 6 -o "$WORK/mj/$f" "$JM/$f"
    done
    python3 $R3/scripts/holdout-r3/select-jamendo.py $WORK/mj
    python3 $HARNESS/scripts/hf-eval/fetch-jamendo-ranges.py $R3/$DOCS/jamendo-manifest.json $WORK/mj/data/download/raw_30s_audio-low_sha256_tracks.txt $PART/$PARTS $WORK/audio
    MANIFEST=$R3/$DOCS/jamendo-manifest.json
  else
    git clone -q https://github.com/GiantSteps/giantsteps-mtg-key-dataset.git $WORK/mk && git -C $WORK/mk checkout -q fd7b8c584f7bd6d720d170c325a6d42c9bf75a6b
    python3 $R3/scripts/holdout-r3/select-mtg-key.py $WORK/mk $R3/$DOCS/round2-mtg-key-tracks.txt $WORK/audio
    git -C "$R3" diff --quiet -- $DOCS/mtg-key-manifest.json || { echo "the frozen MTG key manifest changed"; exit 1; }
    MANIFEST=$R3/$DOCS/mtg-key-manifest.json
  fi
  cd "$APP"
  # The harness's driver: it handles both the old toolbar and the Resonance layout (#137).
  cp $HARNESS/scripts/short-clip-upload-eval.mjs scripts/
  npx playwright install --with-deps chromium > /dev/null
  npm run build > $WORK/build.log 2>&1 || { tail -40 $WORK/build.log; exit 1; }
  export CHROME_PATH=$(node -e "console.log(require('playwright').chromium.executablePath())")
  ls $WORK/audio | sed 's/\.wav$//' | python3 -c "import json,sys; json.dump([l.strip() for l in sys.stdin if l.strip()], open('$WORK/ids.json','w'))"
  # mtgkey: every part fetches the whole (small) set and analyses its own 1/PARTS of it.
  [ "$SET" = mtgkey ] && OWN="$PART/$PARTS" || OWN=0/1
  P=${PROCS:-$(( CPUS / 2 > 0 ? CPUS / 2 : 1 ))}; pids=()
  for p in $(seq 0 $((P - 1))); do
    ( AUDIO_DIR=$WORK/audio AUDIO_EXT=wav MANIFEST=$MANIFEST ONLY_IDS=$WORK/ids.json PORT=$((4300 + p)) \
      SHARD=$(( ${OWN%/*} * P + p ))/$(( ${OWN#*/} * P )) node scripts/short-clip-upload-eval.mjs $OUT/run-$p test 20 ) > $WORK/sub-$p.log 2>&1 &
    pids+=($!)
  done
  fail=0; for k in "${!pids[@]}"; do wait "${pids[$k]}" || { fail=1; echo "browser $k failed:"; tail -5 $WORK/sub-$k.log; }; done
  exit $fail ;;
collect)
  SHARDS=$2; RESULTS=$3; mkdir -p "$RESULTS"
  APP_SHA=$(cat $SHARDS/part-0/app-commit.txt); R3_SHA=$(cat $SHARDS/part-0/r3-commit.txt)
  for f in $SHARDS/part-*/app-commit.txt; do [ "$(cat $f)" = "$APP_SHA" ] || { echo "$f is not $APP_SHA"; exit 1; }; done
  for f in $SHARDS/part-*/r3-commit.txt; do [ "$(cat $f)" = "$R3_SHA" ] || { echo "$f is not $R3_SHA"; exit 1; }; done
  git fetch -q origin "$R3_SHA" && git worktree add -q --detach r3 "$R3_SHA"
  cd "$APP" && npm ci --no-audit --no-fund --loglevel=error
  mkdir -p scripts/holdout-r3 && cp $HARNESS/r3/scripts/holdout-r3/*.mjs scripts/holdout-r3/
  set -o pipefail
  EXPORTS=$(ls $SHARDS/part-*/run-*/graph-export.json)
  if [ "$SET" = jamendo ]; then
    node -e "const fs=require('fs'),m=JSON.parse(fs.readFileSync(process.argv[1]));const v=(f,k)=>fs.writeFileSync(k,JSON.stringify({...m,items:m.items.filter(f).map(i=>({...i,reviews:i.reviews.filter(r=>!r.weak)}))}));
      v(()=>true,'$WORK/strict.json');v(i=>i.djTier==='dj genre','$WORK/strict-dj.json');fs.writeFileSync('$WORK/weak.json',JSON.stringify(m))" "$HARNESS/r3/$DOCS/jamendo-manifest.json"
    for v in strict strict-dj weak; do
      MANIFEST=$WORK/$v.json npx vite-node scripts/holdout-r3/score-tags.mjs "$RESULTS/jamendo-tags-$v.json" $EXPORTS | tee "$RESULTS/jamendo-tags-$v.txt"
    done
  else
    MANIFEST=$HARNESS/r3/$DOCS/mtg-key-manifest.json BENCHMARK=holdout-r3-2026-10-06/mtg-key npx vite-node scripts/holdout-r3/score-tempo-key.mjs $WORK/mtg-key-full.json $EXPORTS | tee "$RESULTS/mtg-key.txt"
    node -e "const fs=require('fs'),r=JSON.parse(fs.readFileSync(process.argv[1]));delete r.rows;fs.writeFileSync(process.argv[2],JSON.stringify(r,null,1))" $WORK/mtg-key-full.json "$RESULTS/mtg-key.json"
  fi
  echo "app $APP_REF at $APP_SHA; test set $R3_SHA; hf-eval run $RUN_KEY ($SET)" > "$RESULTS/tested-commit.txt"
  cd "$HARNESS"
  LABEL=$(echo "$APP_REF" | tr -c 'A-Za-z0-9._\n-' '-' | cut -c1-40)-${APP_SHA::7}
  git fetch -q origin "$BRANCH" && git worktree add -q --detach r3push FETCH_HEAD
  D=r3push/$DOCS/results/$LABEL; mkdir -p "$D"
  for f in "$RESULTS"/*; do b=$(basename "$f"); [ "$b" = tested-commit.txt ] && b=tested-commit-$SET-hf.txt; cp "$f" "$D/$b"; done
  cd r3push && git add "$DOCS/results/$LABEL" && git commit -qm "Record round 3 held-out $SET results for $APP_REF (HF eval run $RUN_KEY)" && \
    for i in 1 2 3 4; do git push -q origin "HEAD:$BRANCH" && break; [ $i = 4 ] && exit 1; sleep $((2**i)); git pull -q --rebase origin "$BRANCH"; done ;;
esac
