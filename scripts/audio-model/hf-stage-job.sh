#!/usr/bin/env bash
# Round A/B/C helper jobs on Hugging Face Jobs (hf-launch.py with JOB_SCRIPT=hf-stage-job.sh). Clones the repo at REPO_SHA
# and runs one script from scripts/audio-model, nothing else: no training, no model upload.
#   STAGE_SCRIPT=stage-birds.py | stage-guitarfx.py   (cpu-upgrade: download, dedupe, split, stage to the PRIVATE repo)
#   STAGE_SCRIPT=ced-check-keys-breaks.py             (cpu-upgrade: reads the existing CED-base scores, ids and scores only)
#   STAGE_ARGS="..." extra arguments for the script (e.g. "--limit 200 --dry-run" for a smoke run)
# Every script refuses to upload unless its target repo is private, and reads the reserved test lists from this checkout.
set -euo pipefail
: "${REPO_SHA:?REPO_SHA is required}" "${STAGE_SCRIPT:?STAGE_SCRIPT is required}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q && apt-get install -yq --no-install-recommends ffmpeg git ca-certificates curl > /dev/null
pip install -q numpy pyarrow huggingface_hub soundfile ${STAGE_PIP:-}
W=/work; mkdir -p $W && cd $W
git clone -q https://github.com/chrisatom1998/document-graph-explorer.git dge && git -C dge checkout -q "$REPO_SHA"
git clone -q https://github.com/fschmid56/EfficientAT.git && git -C EfficientAT checkout -q a425fdce92572e602a1d5634799bd9f1f2efa806
export EFFICIENTAT=$W/EfficientAT TMPDIR=$W/tmp; mkdir -p $TMPDIR
nproc; free -g | head -2; df -h $W | tail -1
case "$STAGE_SCRIPT" in stage-birds.py|stage-guitarfx.py|ced-check-keys-breaks.py) ;; *) echo "unknown STAGE_SCRIPT $STAGE_SCRIPT"; exit 1;; esac
# shellcheck disable=SC2086
python3 -u dge/scripts/audio-model/$STAGE_SCRIPT ${STAGE_ARGS:-}
