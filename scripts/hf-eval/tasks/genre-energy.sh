#!/usr/bin/env bash
# Genre/energy features (the "Add genre and energy tags" thread's scripts/genre-energy, from the app ref under test)
# for one list: TASK_ARGS = beatport-judge (default), beatport-tune, jamendo-fit or jamendo-judge.
#   run:     build the lists, fetch this part's audio and compute features with PROCS processes in parallel.
#   collect: merge the parts into data/<set>.json.gz on the branch claude/genre-energy-data (other files kept).
set -euo pipefail
SET=${TASK_ARGS:-beatport-judge}
case "$1" in
run)
  cd "$APP"
  ESSENTIA=https://essentia.upf.edu/models
  JM=https://raw.githubusercontent.com/MTG/mtg-jamendo-dataset/cafd8e20c265ed84f1e61f1c875327971f43a62f
  git clone -q https://github.com/GiantSteps/giantsteps-tempo-dataset.git $WORK/gs && git -C $WORK/gs checkout -q d51ab2422e76abacfaa86616a57054bc222ec9fd
  git clone -q https://github.com/GiantSteps/giantsteps-mtg-key-dataset.git $WORK/mk && git -C $WORK/mk checkout -q fd7b8c584f7bd6d720d170c325a6d42c9bf75a6b
  for f in data/splits/split-0/autotagging_moodtheme-train.tsv data/splits/split-0/autotagging_moodtheme-validation.tsv \
           data/splits/split-0/autotagging_moodtheme-test.tsv data/raw_30s_cleantags.tsv data/download/raw_30s_audio-low_sha256_tracks.txt; do
    mkdir -p "$WORK/mj/$(dirname $f)"; curl -fsSL --retry 6 -o "$WORK/mj/$f" "$JM/$f"
  done
  python3 scripts/genre-energy/build-sets.py $WORK/gs $WORK/mk $WORK/mj $WORK/lists
  mkdir -p heads
  curl -fsSL --retry 6 -o public/jamendo-model/discogs-effnet-bsdynamic-1.onnx "$ESSENTIA/feature-extractors/discogs-effnet/discogs-effnet-bsdynamic-1.onnx"
  echo "$(node -p "require('./public/jamendo-model/manifest.json').sha256['discogs-effnet-bsdynamic-1.onnx']")  public/jamendo-model/discogs-effnet-bsdynamic-1.onnx" | sha256sum -c -
  for e in onnx json; do curl -fsSL --retry 6 -o heads/mtg_jamendo_moodtheme-discogs-effnet-1.$e "$ESSENTIA/classification-heads/mtg_jamendo_moodtheme/mtg_jamendo_moodtheme-discogs-effnet-1.$e"; done
  P=${PROCS:-$CPUS}; N=$((PARTS * P)); pids=()
  for p in $(seq 0 $((P - 1))); do
    g=$((PART * P + p))
    ( python3 scripts/genre-energy/fetch.py $WORK/lists/$SET.json $g/$N $WORK/audio-$p $WORK/clips-$p.json $WORK/mj/data/download/raw_30s_audio-low_sha256_tracks.txt \
      && npx vite-node scripts/genre-energy/features.mjs $WORK/clips-$p.json $WORK/f-$p.json public/jamendo-model heads \
      && rm -rf $WORK/audio-$p ) > $WORK/sub-$p.log 2>&1 &
    pids+=($!)
  done
  fail=0; for k in "${!pids[@]}"; do wait "${pids[$k]}" || { fail=1; echo "sub-part $k failed:"; tail -20 $WORK/sub-$k.log; }; done
  tail -n 3 $WORK/sub-*.log
  python3 -c "import json,glob,sys; rows=[r for p in sorted(glob.glob(sys.argv[1] + '/f-*.json')) for r in json.load(open(p))]; json.dump(rows, open(sys.argv[2], 'w')); print(len(rows), 'rows')" $WORK "$OUT/$SET.json"
  cp $WORK/lists/$SET.json "$OUT/list.json"
  exit $fail ;;
collect)
  SHARDS=$2; RESULTS=$3; mkdir -p "$RESULTS"
  python3 - "$SHARDS" "$SET" "$RESULTS" <<'PY'
import glob, gzip, json, sys
shards, s, res = sys.argv[1:4]
rows = [r for p in sorted(glob.glob(f'{shards}/part-*/{s}.json')) for r in json.load(open(p))]
want = len(json.load(open(sorted(glob.glob(f'{shards}/part-*/list.json'))[0])))
gzip.open(f'{res}/{s}.json.gz', 'wt').write(json.dumps(rows))
print(f'{s}: {len(rows)} of {want} tracks')
PY
  if git fetch -q origin claude/genre-energy-data; then git worktree add -q --detach data-branch FETCH_HEAD
  else git worktree add -q --detach data-branch && git -C data-branch checkout -q --orphan genre-energy-data && git -C data-branch rm -rqf .; fi
  mkdir -p data-branch/data && cp "$RESULTS/$SET.json.gz" data-branch/data/
  echo "$SET: hf-eval run $RUN_KEY (app $(cat $SHARDS/part-0/app-commit.txt))" >> data-branch/data/README.txt
  cd data-branch && git add data && git commit -qm "Genre/energy features for $SET from HF eval run $RUN_KEY" && \
    for i in 1 2 3 4; do git push -q origin HEAD:refs/heads/claude/genre-energy-data && break; [ $i = 4 ] && exit 1; sleep $((2**i)); git pull -q --rebase origin claude/genre-energy-data; done ;;
esac
