#!/usr/bin/env bash
# Train DGE's own instrument tagger on a Hugging Face Jobs GPU (launched by .github/workflows/audio-model-train.yml).
# Fetches every dataset itself (nothing is uploaded from GitHub), trains, calibrates on validation artists, exports the
# browser model, scores DJ clip rounds 1 and 2 and the round 3 held-out Jamendo set (aggregates only), and uploads the
# run to the private model repo $HF_REPO. Env: REPO_SHA, HF_REPO, MODEL, EPOCHS, LR, BATCH, WEAK, optional SOUNDCLOUD_DATA, HF_TOKEN (secret).
# ALL_TAGS=1 adds the app-named head (FSD50K dev, NSynth train + effect renders, Freesound; judged on FSD50K eval, NSynth
# test and held-out Freesound uploaders), plus TinySOL, EGFxSet, FSLD, WaivOps drum loops, Surge presets (prepare-extra.py)
# and Slakh stems when scripts/audio-model/prepare-slakh.py exists.
# INIT_FROM=<model repo>[@<revision>[/<folder>]] starts from an earlier run's model.pt. OUT_DIR puts this run under a folder of $HF_REPO.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -q && apt-get install -yq --no-install-recommends ffmpeg git ca-certificates curl > /dev/null
pip install -q scikit-learn scipy pyarrow onnx onnxruntime huggingface_hub
W=/work; mkdir -p $W && cd $W
git clone -q https://github.com/chrisatom1998/document-graph-explorer.git dge && git -C dge checkout -q "$REPO_SHA"
git clone -q https://github.com/fschmid56/EfficientAT.git && git -C EfficientAT checkout -q a425fdce92572e602a1d5634799bd9f1f2efa806
export EFFICIENTAT=$W/EfficientAT
S=$W/dge/scripts/audio-model
# Eval manifests from their own PRs, pinned: DJ clip round 2 (#119) and the round 3 held-out set (#121).
GH=https://raw.githubusercontent.com/chrisatom1998/document-graph-explorer
mkdir -p manifests
curl -fsSL --retry 6 -o manifests/round2.json $GH/61cd34513011763468338f2d27e22a6c8b240648/docs/evaluations/dj-clips-round2-2026-10-06/openmic-manifest.json
curl -fsSL --retry 6 -o manifests/holdout-r3-jamendo.json $GH/f0f4de73246bd731435cc1f830f91d8b3145e893/docs/evaluations/holdout-r3-2026-10-06/jamendo-manifest.json
cp $W/dge/docs/evaluations/dj-clips-2026-10-06/openmic-manifest.json manifests/round1.json
nvidia-smi --query-gpu=name,memory.total --format=csv || true
nproc; free -g | head -2; df -h $W | tail -1

JM=https://raw.githubusercontent.com/MTG/mtg-jamendo-dataset/cafd8e20c265ed84f1e61f1c875327971f43a62f
for f in data/raw_30s_cleantags.tsv data/splits/split-0/autotagging_instrument-train.tsv data/splits/split-0/autotagging_instrument-validation.tsv \
         data/splits/split-0/autotagging_instrument-test.tsv \
         derived/music-classification-annotations/music-classification-annotations-clean.tsv data/download/raw_30s_audio-low_sha256_tracks.txt; do
  mkdir -p mj/$(dirname $f); curl -fsSL --retry 6 -o mj/$f $JM/$f
done
( curl -fsSL --retry 6 -o openmic.tgz "https://zenodo.org/records/1432913/files/openmic-2018-v1.0.0.tgz?download=1"
  echo "e4ccf187e2bb5ab2e115416e8aafe7f4  openmic.tgz" | md5sum -c -
  python3 $S/prepare.py openmic.tgz prep manifests/round1.json manifests/round2.json && rm openmic.tgz ) > openmic.log 2>&1 &
python3 $S/prepare-jamendo.py mj manifests/holdout-r3-jamendo.json prepj --windows 2 --parallel 6 > jamendo.log 2>&1 &
python3 $S/prepare-holdout.py manifests/holdout-r3-jamendo.json mj/data/download/raw_30s_audio-low_sha256_tracks.txt holdout/holdout-r3 > holdout.log 2>&1 &
if [ "${ALL_TAGS:-0}" = 1 ]; then
  python3 $S/prepare-fsd50k.py fsdprep --workers 32 > fsd50k.log 2>&1 &
  python3 $S/prepare-nsynth.py nsprep --workers 4 > nsynth.log 2>&1 &
  python3 $S/prepare-freesound.py fsprep > freesound.log 2>&1 &
  for x in tinysol egfx fsld waivops surge; do python3 $S/prepare-extra.py $x xprep > $x.log 2>&1 & done
  if [ -f $S/prepare-slakh.py ]; then python3 $S/prepare-slakh.py xprep > slakh.log 2>&1 & fi
fi
LOGS=$(ls *.log)
for job in $(jobs -p); do wait $job || { tail -20 $LOGS; exit 1; }; done
tail -3 $LOGS; df -h $W | tail -1

EXTRA=()
if [ -n "${SOUNDCLOUD_DATA:-}" ]; then   # "<dataset repo>:<folder>", uploaded by the workflow from its SoundCloud artifacts
  python3 -c "import sys; from huggingface_hub import snapshot_download as d; r, f = sys.argv[1].split(':'); d(r, repo_type='dataset', allow_patterns=[f + '/*'], local_dir='scdl')" "$SOUNDCLOUD_DATA"
  mv "scdl/${SOUNDCLOUD_DATA#*:}" scprep && EXTRA=(--soundcloud scprep)
fi
if [ "${ALL_TAGS:-0}" = 1 ]; then
  EXTRA+=(--fsd50k fsdprep --nsynth nsprep --freesound fsprep)
  XS=$(ls xprep/*-mel.npy | xargs -n1 basename | sed 's/-mel\.npy$//'); for x in $XS; do EXTRA+=(--extra $x=xprep); done
fi
if [ -n "${INIT_FROM:-}" ]; then   # "<repo>[@<revision>[/<folder>]]"
  python3 -c "import sys; from huggingface_hub import hf_hub_download as d; r, _, rest = sys.argv[1].partition('@'); rev, _, f = rest.partition('/'); [d(r, (f + '/' if f else '') + n, revision=rev or None, local_dir='init') for n in ('model.pt', 'log.json')]" "$INIT_FROM"
  EXTRA+=(--init "$(dirname $(find init -name model.pt | head -1))/model.pt")
fi
python3 $S/train.py run --openmic prep --jamendo prepj "${EXTRA[@]}" --model "$MODEL" --epochs "$EPOCHS" --lr "$LR" --batch "$BATCH" --weak "$WEAK" --threads 8 --hours "${TRAIN_HOURS:-0}"
CAL=(openmic=prep jamendo=prepj); EVAL=(prep/eval-round1 prep/eval-round2 holdout/holdout-r3)
[ -d scprep ] && CAL+=(soundcloud=scprep)
if [ "${ALL_TAGS:-0}" = 1 ]; then CAL+=(fsd50k=fsdprep nsynth=nsprep freesound=fsprep); for x in $XS; do CAL+=($x=xprep); done; EVAL+=(fsdprep/eval-fsd50k nsprep/eval-nsynth-test nsprep/eval-nsynth-test-fx fsprep/eval-freesound); fi
python3 $S/calibrate.py run "${CAL[@]}" | tee run/calibrate.txt
python3 $S/coverage.py run "${CAL[@]}" 
python3 $S/export.py run/model.pt run/onnx --model "$MODEL"
python3 $S/evaluate.py run/onnx/model.onnx run/thresholds.json run/eval.json "${EVAL[@]}" | tee run/eval.txt
python3 - <<EOF
import os
from huggingface_hub import HfApi
api = HfApi(); repo = os.environ['HF_REPO']
api.create_repo(repo, private=True, exist_ok=True)
api.upload_folder(repo_id=repo, folder_path='run', path_in_repo=os.environ.get('OUT_DIR') or None, allow_patterns=['onnx/*', 'thresholds.json', 'log.json', 'calibrate.txt', 'eval.*', 'coverage.*', 'model.pt'],
                  commit_message='DGE tagger run at ${REPO_SHA:0:7}: ${MODEL}, ${EPOCHS} epochs')
print('uploaded to https://huggingface.co/' + repo)
EOF
