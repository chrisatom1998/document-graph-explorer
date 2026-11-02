#!/usr/bin/env bash
# Download the tag-baseline clips (FSD50K eval, a judge set) to a local folder outside the repo.
# Usage: scripts/tag-baseline/fetch.sh <work-dir> [build_set.py options]   (writes <work-dir>/meta, <work-dir>/set, <work-dir>/audio)
# With --split dev-val it fetches the FSD50K dev metadata and clips instead (a tuning set, see build_set.py).
# The audio is never committed or uploaded anywhere. Only ids, labels and metadata live in the repo.
set -euo pipefail
W=${1:?work dir}; HERE=$(cd "$(dirname "$0")" && pwd)
REV=$(python3 -c "import sys; sys.path.insert(0, '$HERE'); import build_set; print(build_set.REVISION)")
B="https://huggingface.co/datasets/Fhrozen/FSD50k/resolve/$REV"
mkdir -p "$W/meta" "$W/audio"
S=eval; [[ " ${*:2} " == *" dev-val "* || " ${*:2} " == *"--split=dev-val"* ]] && S=dev
[ -s "$W/meta/$S.csv" ] || curl -fsSL --retry 5 -o "$W/meta/$S.csv" "$B/labels/$S.csv"
[ -s "$W/meta/${S}_clips_info_FSD50K.json" ] || curl -fsSL --retry 5 -o "$W/meta/${S}_clips_info_FSD50K.json" "$B/metadata/${S}_clips_info_FSD50K.json"
python3 "$HERE/build_set.py" "$W/meta" "$W/set" "${@:2}"
python3 -c "import json,sys; [print(i['id'].split(':',1)[1]) for i in json.load(open('$W/set/items.json'))['items']]" |
  xargs -P 8 -I{} sh -c "[ -s '$W/audio/{}.wav' ] || curl -fsSL --retry 5 -o '$W/audio/{}.wav' '$B/clips/$S/{}.wav'"
echo "audio: $(ls "$W/audio" | wc -l) files in $W/audio"
