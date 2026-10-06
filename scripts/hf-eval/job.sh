#!/usr/bin/env bash
# One part of an evaluation task on a Hugging Face Jobs machine (image node:24-bookworm), started by launch.py.
# Checks out the harness (scripts/hf-eval at HARNESS_SHA) and the app under test (APP_SHA), runs `npm ci` in the app,
# then `scripts/hf-eval/tasks/$TASK.sh run`, and uploads $OUT to the private dataset $HF_DATASET under
# runs/$RUN_KEY/part-$PART/ (no audio: tasks write results only).
# Env from launch.py: TASK, PART, PARTS, RUN_KEY, HF_DATASET, APP_SHA, HARNESS_SHA, optional TASK_ARGS; HF_TOKEN (secret).
set -euo pipefail
START=$(date +%s)
export DEBIAN_FRONTEND=noninteractive ONNXRUNTIME_NODE_INSTALL=skip
apt-get update -q > /dev/null && apt-get install -yq --no-install-recommends ffmpeg python3-pip > /dev/null
pip install -q --break-system-packages huggingface_hub==2.1.1
echo "part $PART/$PARTS of $TASK on $(nproc) CPUs, $(free -g | awk '/Mem/{print $2}') GB"
export WORK=/work HARNESS=/work/harness APP=/work/app OUT=/work/out
mkdir -p $WORK $OUT && cd $WORK
git clone -q https://github.com/chrisatom1998/document-graph-explorer.git harness && git -C harness checkout -q "$HARNESS_SHA"
git -C harness worktree add -q --detach "$APP" "$APP_SHA"
echo "app under test: $(git -C "$APP" log -1 --format='%H %s')"
(cd "$APP" && npm ci --no-audit --no-fund --loglevel=error)
echo "setup took $(( $(date +%s) - START )) s"
STATUS=0
bash "$HARNESS/scripts/hf-eval/tasks/$TASK.sh" run || STATUS=$?
git -C "$APP" rev-parse HEAD > $OUT/app-commit.txt
echo "{\"part\": $PART, \"seconds\": $(( $(date +%s) - START )), \"status\": $STATUS}" > $OUT/part-timing.json
python3 - <<'PY'
import os
from huggingface_hub import HfApi
api = HfApi(); repo = os.environ['HF_DATASET']
api.create_repo(repo, repo_type='dataset', private=True, exist_ok=True)
api.upload_folder(repo_id=repo, repo_type='dataset', folder_path=os.environ['OUT'],
                  path_in_repo=f"runs/{os.environ['RUN_KEY']}/part-{os.environ['PART']}", commit_message=f"{os.environ['RUN_KEY']} part {os.environ['PART']}")
PY
echo "part $PART finished with status $STATUS after $(( ($(date +%s) - START) / 60 )) min"
exit $STATUS
