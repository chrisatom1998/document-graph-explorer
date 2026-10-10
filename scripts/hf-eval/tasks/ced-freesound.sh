#!/usr/bin/env bash
# CED-base (AudioSet, Apache 2.0) scores every clip of the Freesound mirror benjamin-paine/freesound-laion-640k,
# so the "Raise sound tag accuracy" thread can pick confident extra training clips for weak tags. GPU flavor (l4x1).
# Each part takes every PARTS-th parquet shard; outputs one .npz per shard (ids, uploader, licence, length and the
# 527 AudioSet probabilities, no audio). task_args: extra env, e.g. "COUNT=2" for a dry run, "STOP_AFTER_MIN=40".
set -euo pipefail
case "$1" in
run)
  pip install -q --break-system-packages "torch>=2.3" "torchaudio>=2.3" "transformers>=4.40,<5" "pyarrow>=15" numpy "soundfile>=0.12" soxr
  for kv in ${TASK_ARGS:-}; do export "$kv"; done
  WORKERS=${WORKERS:-$CPUS} OUT=$OUT python3 "$HARNESS/scripts/hf-eval/ced-freesound.py" ;;
collect)
  SHARDS=$2; R=$3; mkdir -p "$R"
  pip install -q numpy
  python3 - "$SHARDS" "$R" <<'PY'
import glob, json, os, sys
import numpy as np
shards, r = sys.argv[1:3]
files = sorted(glob.glob(f'{shards}/part-*/*.npz'))
rows = sum(int(np.load(f, allow_pickle=False)['freesound_id'].shape[0]) for f in files)
labels = glob.glob(f'{shards}/part-*/labels.txt')
if labels: open(f'{r}/labels.txt', 'w').write(open(labels[0]).read())
s = {'shards_done': len(files), 'shards_total': 1475, 'clips_scored': rows, 'run_key': os.environ.get('RUN_KEY', '')}
json.dump(s, open(f'{r}/summary.json', 'w'), indent=1); print(s)
PY
  ;;
esac
