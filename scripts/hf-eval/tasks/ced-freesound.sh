#!/usr/bin/env bash
# CED-base (AudioSet, Apache 2.0) scores every clip of the Freesound mirror benjamin-paine/freesound-laion-640k,
# so the "Raise sound tag accuracy" thread can pick confident extra training clips for weak tags. GPU flavor (l4x1).
# Each part takes every PARTS-th parquet shard; outputs one .npz per shard (ids, uploader, licence, length and the
# 527 AudioSet probabilities, no audio). task_args: extra env, e.g. "COUNT=2" for a dry run, "STOP_AFTER_MIN=40".
# collect: per tag in data/ced-tag-map.json, clips whose best mapped AudioSet score is >= 0.3 (best first, at most
# 1,000) go to runs/<run key>/candidates.csv in the private dataset only; Freesound ids and uploaders stay out of the
# public repo and the workflow artifact.
set -euo pipefail
case "$1" in
run)
  pip install -q --break-system-packages "torch>=2.3" "torchaudio>=2.3" "transformers>=4.40,<5" "pyarrow>=15" numpy "soundfile>=0.12" soxr
  for kv in ${TASK_ARGS:-}; do export "$kv"; done
  WORKERS=${WORKERS:-$CPUS} OUT=$OUT python3 "$HARNESS/scripts/hf-eval/ced-freesound.py" ;;
collect)
  SHARDS=$2; R=$3; mkdir -p "$R"
  pip install -q --break-system-packages numpy huggingface_hub 2>/dev/null || pip install -q numpy huggingface_hub
  python3 "$HARNESS/scripts/hf-eval/ced-freesound-collect.py" "$SHARDS" "$R" "$HARNESS/scripts/hf-eval/data/ced-tag-map.json" ;;
esac
