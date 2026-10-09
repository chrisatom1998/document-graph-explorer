#!/usr/bin/env bash
# The 417-song whole-song tag judge (.github/workflows/whole-songs-eval.yml) in the real built app on HF Jobs.
# Each part fetches the MedleyDB/MoisesDB mixes, keeps its 1/PARTS of the songs (scripts/whole-songs/fetch-audio.py)
# and analyses them in several headless browsers; collect scores every part's export together with
# scripts/whole-songs/score.mjs against the app's own src. Judge only: never tune on these results.
set -euo pipefail
DOCS=docs/evaluations/whole-songs-2026-10-09
case "$1" in
run)
  cd "$APP"
  python3 "$HARNESS/scripts/whole-songs/fetch-audio.py" "$HARNESS/$DOCS/manifest.json" \
    'https://huggingface.co/datasets/seungheondoh/cmd-{set}-metadata/resolve/main/{set}.tar.gz' $WORK/audio "$PARTS" "$PART"
  cp "$HARNESS/scripts/short-clip-upload-eval.mjs" scripts/
  npx playwright install --with-deps chromium > /dev/null
  npm run build > $WORK/build.log 2>&1 || { tail -40 $WORK/build.log; exit 1; }
  export CHROME_PATH=$(node -e "console.log(require('playwright').chromium.executablePath())")
  P=${PROCS:-$(( CPUS / 2 > 0 ? CPUS / 2 : 1 ))}; pids=(); fail=0
  # Browser p gets every P-th song of this part, in its own folder and manifest.
  python3 - "$HARNESS/$DOCS/manifest.json" $WORK/audio/$PART $WORK $P <<'PY'
import json, os, shutil, sys
m, src, work, p = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3], int(sys.argv[4])
have = sorted(f[:-4] for f in os.listdir(src))
for b in range(p):
    ids = set(have[b::p]); os.makedirs(f'{work}/b{b}', exist_ok=True)
    for i in ids: shutil.move(f'{src}/{i}.mp3', f'{work}/b{b}/{i}.mp3')
    json.dump({**m, 'items': [i for i in m['items'] if i['id'] in ids]}, open(f'{work}/m{b}.json', 'w'))
    print(f'browser {b}: {len(ids)} songs')
PY
  for p in $(seq 0 $((P - 1))); do
    ( AUDIO_DIR=$WORK/b$p AUDIO_EXT=mp3 MANIFEST=$WORK/m$p.json PORT=$((4300 + p)) \
      node scripts/short-clip-upload-eval.mjs $OUT/run-$p test 4 ) > $WORK/sub-$p.log 2>&1 &
    pids+=($!)
  done
  for k in "${!pids[@]}"; do wait "${pids[$k]}" || { fail=1; echo "browser $k failed:"; tail -5 $WORK/sub-$k.log; }; done
  exit $fail ;;
collect)
  SHARDS=$2; R=$3; mkdir -p "$R"
  APP_SHA=$(cat $SHARDS/part-0/app-commit.txt)
  for f in $SHARDS/part-*/app-commit.txt; do [ "$(cat $f)" = "$APP_SHA" ] || { echo "$f is not $APP_SHA"; exit 1; }; done
  cd "$APP" && npm ci --no-audit --no-fund --loglevel=error
  mkdir -p scripts/whole-songs && cp "$HARNESS/scripts/whole-songs/score.mjs" scripts/whole-songs/
  set -o pipefail
  MANIFEST=$HARNESS/$DOCS/manifest.json npx vite-node scripts/whole-songs/score.mjs "$R/tags.json" $SHARDS/part-*/run-*/graph-export.json | tee "$R/tags.txt"
  echo "app $APP_SHA; hf-eval run $RUN_KEY" > "$R/tested-commit.txt" ;;
esac
