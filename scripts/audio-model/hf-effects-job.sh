#!/usr/bin/env bash
# Train the tagger's DJ effect outputs alone on a Hugging Face Jobs GPU (JOB_SCRIPT=hf-effects-job.sh in hf-launch.py,
# from .github/workflows/audio-effects-train.yml): the DJ effect clips' train uploaders (prepare-extra.py djfx), from
# AudioSet weights; thresholds from validation uploaders; scored on the clips' held-out uploaders, the set PR #141 is
# judged on. Uploads to $HF_REPO under $OUT_DIR (default effects). Env: REPO_SHA, HF_REPO, MODEL, EPOCHS, LR, BATCH, HF_TOKEN.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -q && apt-get install -yq --no-install-recommends ffmpeg git ca-certificates curl > /dev/null
pip install -q scikit-learn scipy onnx onnxruntime huggingface_hub
W=/work; mkdir -p $W && cd $W
git clone -q https://github.com/chrisatom1998/document-graph-explorer.git dge && git -C dge checkout -q "$REPO_SHA"
git clone -q https://github.com/fschmid56/EfficientAT.git && git -C EfficientAT checkout -q a425fdce92572e602a1d5634799bd9f1f2efa806
export EFFICIENTAT=$W/EfficientAT
S=$W/dge/scripts/audio-model
nvidia-smi --query-gpu=name,memory.total --format=csv || true

python3 $S/prepare-extra.py djfx xprep
python3 $S/train.py run --extra djfx=xprep --model "$MODEL" --epochs "$EPOCHS" --lr "$LR" --batch "$BATCH" --threads 8 --dj-repeat 1
python3 $S/calibrate.py run djfx=xprep | grep -v "off: " | tee run/calibrate.txt
python3 $S/export.py run/model.pt run/onnx --model "$MODEL"
python3 $S/evaluate.py run/onnx/model.onnx run/thresholds.json run/eval.json xprep/eval-djfx | tee run/eval.txt
python3 - <<PY
import os
from huggingface_hub import HfApi
api = HfApi(); repo = os.environ['HF_REPO']
api.create_repo(repo, private=True, exist_ok=True)
api.upload_folder(repo_id=repo, folder_path='run', path_in_repo=os.environ.get('OUT_DIR') or 'effects', allow_patterns=['onnx/*', 'thresholds.json', 'log.json', 'calibrate.txt', 'eval.*', 'model.pt'],
                  commit_message='DGE DJ effects run at ${REPO_SHA:0:7}: ${MODEL}, ${EPOCHS} epochs')
print('uploaded to https://huggingface.co/' + repo)
PY
