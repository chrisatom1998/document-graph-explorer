#!/usr/bin/env bash
# Download the tag-baseline clips (FSD50K eval, a judge set) to a local folder outside the repo.
# Usage: scripts/tag-baseline/fetch.sh <work-dir>      (writes <work-dir>/meta, <work-dir>/set, <work-dir>/audio)
# The audio is never committed or uploaded anywhere. Only ids, labels and metadata live in the repo.
set -euo pipefail
W=${1:?work dir}; HERE=$(cd "$(dirname "$0")" && pwd)
REV=$(python3 -c "import sys; sys.path.insert(0, '$HERE'); import build_set; print(build_set.REVISION)")
B="https://huggingface.co/datasets/Fhrozen/FSD50k/resolve/$REV"
mkdir -p "$W/meta" "$W/audio"
curl -fsSL --retry 5 -o "$W/meta/eval.csv" "$B/labels/eval.csv"
curl -fsSL --retry 5 -o "$W/meta/eval_clips_info_FSD50K.json" "$B/metadata/eval_clips_info_FSD50K.json"
python3 "$HERE/build_set.py" "$W/meta" "$W/set" "${@:2}"
python3 -c "import json,sys; [print(i['id'].split(':',1)[1]) for i in json.load(open('$W/set/items.json'))['items']]" |
  xargs -P 8 -I{} sh -c "[ -s '$W/audio/{}.wav' ] || curl -fsSL --retry 5 -o '$W/audio/{}.wav' '$B/clips/eval/{}.wav'"
echo "audio: $(ls "$W/audio" | wc -l) files in $W/audio"
