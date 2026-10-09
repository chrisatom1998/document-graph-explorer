#!/usr/bin/env bash
# Train DGE's own instrument tagger on a Hugging Face Jobs GPU (launched by .github/workflows/audio-model-train.yml).
# Fetches every dataset itself (nothing is uploaded from GitHub), trains, calibrates on validation artists, exports the
# browser model, scores DJ clip rounds 1 and 2 and the round 3 held-out Jamendo set (aggregates only), and uploads the
# run to the private model repo $HF_REPO. Env: REPO_SHA, HF_REPO, MODEL, EPOCHS, LR, BATCH, WEAK, optional RARE_REPEAT, JOB_HOURS, SOUNDCLOUD_DATA, HF_TOKEN (secret).
# ALL_TAGS=1 adds the app-named head (FSD50K dev, NSynth train + effect renders, Freesound; judged on FSD50K eval, NSynth
# test and held-out Freesound uploaders), plus TinySOL, EGFxSet, FSLD, WaivOps drum loops, Surge presets (prepare-extra.py)
# and Slakh stems when scripts/audio-model/prepare-slakh.py exists. RAWSTEMS=1 adds Mixing Secrets songs (non-commercial).
# INIT_FROM=<model repo>[@<revision>[/<folder>]] starts from an earlier run's model.pt. OUT_DIR puts this run under a folder of $HF_REPO.
# Run 7 additions (all optional): RAWSTEMS_FX=<share> re-renders that share of the Mixing Secrets windows with one effect
# (source rsfx); IOWA=1 adds University of Iowa MIS notes minus the free-tag-set judge notes (prepare-iowa.py);
# CHRIS_DATA=<private dataset>:<folder> adds Chris's own train-half sounds and effect renders of them (prepare-chrisdrive.py;
# staged by stage-chrisdrive.py; non-commercial weights; never leaves the private repos); SOURCE_REPEAT=name=k,... oversamples
# sources (train.py --repeat). The run folder gets data-manifest.json naming every source and every chris-drive file used.
set -euo pipefail
START=$(date +%s)
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

# Prepared data is cached in the private dataset <user>/dge-tagger-data under prep-cache/<key>, keyed by the prepare
# scripts and label map, so a rerun with the same data skips the ~3 h prep. The upload runs alongside training.
DIRS="prep prepj holdout"; [ "${ALL_TAGS:-0}" = 1 ] && DIRS="$DIRS fsdprep nsprep fsprep xprep"
# The run 7 sources are built in every job (not cached), so their scripts stay out of the key.
KEY=$( (ls $S/prepare*.py | grep -v -e prepare-rawstems.py -e prepare-iowa.py -e prepare-chrisdrive.py | xargs cat; cat $S/labelmap.py; echo "$DIRS") | sha256sum | cut -c1-12)
# RAWSTEMS=1 adds Mixing Secrets full songs (prepare-rawstems.py, non-commercial licence), built alongside the rest.
RS_PID=
if [ "${RAWSTEMS:-0}" = 1 ]; then python3 $S/prepare-rawstems.py rsprep --workers 16 --fx "${RAWSTEMS_FX:-0}" > rawstems.log 2>&1 & RS_PID=$!; fi
IOWA_PID=
if [ "${IOWA:-0}" = 1 ]; then python3 $S/prepare-iowa.py iowaprep --workers 16 > iowa.log 2>&1 & IOWA_PID=$!; fi
CD_PID=
if [ -n "${CHRIS_DATA:-}" ]; then   # private staged copy of Chris's train half: only counts are printed
  ( python3 -c "import sys; from huggingface_hub import snapshot_download as d; r, f = sys.argv[1].split(':'); d(r, repo_type='dataset', allow_patterns=[f + '/*'], local_dir='cdstage', max_workers=8)" "$CHRIS_DATA" \
    && python3 $S/prepare-chrisdrive.py "cdstage/${CHRIS_DATA#*:}" cdprep && rm -rf cdstage ) > chrisdrive.log 2>&1 & CD_PID=$!
fi
CACHE_PID=
if python3 - "$KEY" $DIRS <<'PY'
import os, shutil, sys
from huggingface_hub import HfApi, snapshot_download
key, dirs = sys.argv[1], sys.argv[2:]
try:
    api = HfApi(); repo = api.whoami()['name'] + '/dge-tagger-data'; base = f'prep-cache/{key}'
    if not api.file_exists(repo, f'{base}/DONE', repo_type='dataset'): sys.exit(1)
    snapshot_download(repo, repo_type='dataset', allow_patterns=[f'{base}/*'], local_dir='cache', max_workers=16)
    for d in dirs: shutil.move(f'cache/{base}/{d}', d)
    print(f'using cached prepared data {repo}/{base}')
except SystemExit: raise
except Exception as e:
    print(f'prep cache unavailable ({e}); preparing from scratch'); [shutil.rmtree(d, True) for d in dirs]; sys.exit(1)
PY
then echo "data from cache took $(( ($(date +%s) - START) / 60 )) min"
else
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
  LOGS=$(ls *.log | grep -v -e rawstems.log -e iowa.log -e chrisdrive.log)
  # The raw-stems, Iowa and chris-drive preps are waited on (and their logs shown) separately below.
  for job in $(jobs -p); do case " ${RS_PID:-} ${IOWA_PID:-} ${CD_PID:-} " in *" $job "*) continue;; esac; wait $job || { tail -n 20 $LOGS; exit 1; }; done
  tail -n 3 $LOGS; echo "data prep took $(( ($(date +%s) - START) / 60 )) min"; df -h $W | tail -1
  python3 - "$KEY" $DIRS > cache-upload.txt 2>&1 <<'PY' &
import sys
from huggingface_hub import HfApi
key, dirs = sys.argv[1], sys.argv[2:]
api = HfApi(); repo = api.whoami()['name'] + '/dge-tagger-data'; base = f'prep-cache/{key}'
api.create_repo(repo, repo_type='dataset', private=True, exist_ok=True)
for d in dirs: api.upload_folder(repo_id=repo, repo_type='dataset', folder_path=d, path_in_repo=f'{base}/{d}', commit_message=f'Prepared data {key}: {d}')
api.upload_file(path_or_fileobj=b'ok', path_in_repo=f'{base}/DONE', repo_id=repo, repo_type='dataset', commit_message=f'Prepared data {key} complete')
print(f'cached prepared data at {repo}/{base}')
PY
  CACHE_PID=$!
fi

EXTRA=()
if [ -n "$RS_PID" ]; then wait $RS_PID || { tail -n 30 rawstems.log; exit 1; }; tail -n 5 rawstems.log; EXTRA+=(--extra rawstems=rsprep); fi
[ -f rsprep/rsfx.json ] && EXTRA+=(--extra rsfx=rsprep)
if [ -n "$IOWA_PID" ]; then wait $IOWA_PID || { tail -n 30 iowa.log; exit 1; }; tail -n 4 iowa.log; EXTRA+=(--extra iowa=iowaprep); fi
if [ -n "$CD_PID" ]; then wait $CD_PID || { tail -n 5 chrisdrive.log; exit 1; }; tail -n 4 chrisdrive.log; EXTRA+=(--extra chrisdrive=cdprep --extra chrisfx=cdprep); fi
echo "all data ready after $(( ($(date +%s) - START) / 60 )) min"
if [ -n "${SOUNDCLOUD_DATA:-}" ]; then   # "<dataset repo>:<folder>", uploaded by the workflow from its SoundCloud artifacts
  python3 -c "import sys; from huggingface_hub import snapshot_download as d; r, f = sys.argv[1].split(':'); d(r, repo_type='dataset', allow_patterns=[f + '/*'], local_dir='scdl')" "$SOUNDCLOUD_DATA"
  mv "scdl/${SOUNDCLOUD_DATA#*:}" scprep && EXTRA+=(--soundcloud scprep)
fi
if [ "${ALL_TAGS:-0}" = 1 ]; then
  EXTRA+=(--fsd50k fsdprep --nsynth nsprep --freesound fsprep)
  XS=$(ls xprep/*-mel.npy | xargs -n1 basename | sed 's/-mel\.npy$//'); for x in $XS; do EXTRA+=(--extra $x=xprep); done
fi
if [ -n "${INIT_FROM:-}" ]; then   # "<repo>[@<revision>[/<folder>]]"
  python3 -c "import sys; from huggingface_hub import hf_hub_download as d; r, _, rest = sys.argv[1].partition('@'); rev, _, f = rest.partition('/'); [d(r, (f + '/' if f else '') + n, revision=rev or None, local_dir='init') for n in ('model.pt', 'log.json')]" "$INIT_FROM"
  EXTRA+=(--init "$(dirname $(find init -name model.pt | head -1))/model.pt")
fi
# Training gets what is left of the job's time limit (JOB_HOURS) after data prep, keeping 45 min for calibration, export,
# evaluation and upload, and never more than TRAIN_HOURS.
HOURS=$(python3 -c "import sys; t, j, e = map(float, sys.argv[1:]); left = j - e / 3600 - 0.75; print(round(max(0.5, min(t, left) if t else left), 2))" "${TRAIN_HOURS:-0}" "${JOB_HOURS:-7}" "$(( $(date +%s) - START ))")
echo "training budget ${HOURS} h"
python3 $S/train.py run --openmic prep --jamendo prepj "${EXTRA[@]}" --model "$MODEL" --epochs "$EPOCHS" --lr "$LR" --batch "$BATCH" --weak "$WEAK" --rare-repeat "${RARE_REPEAT:-1}" --repeat "${SOURCE_REPEAT:-}" --threads 8 --hours "$HOURS"
# Which data trained this model, so it can be rebuilt without any one source (chris-drive rows keep source=chris-drive).
python3 - "${EXTRA[@]}" <<'EOF'
import json, os, sys
a = sys.argv[1:]; srcs = {}
for k, v in zip(a, a[1:]):
    if k == '--extra': n, d = v.split('=', 1); srcs[n] = d
    elif k in ('--fsd50k', '--nsynth', '--freesound', '--soundcloud'): srcs[k[2:]] = v
man = {'repoSha': os.environ.get('REPO_SHA'), 'initFrom': os.environ.get('INIT_FROM'), 'sources': {}}
for n, d in sorted(srcs.items()):
    js = os.path.join(d, f'{n}.json')
    if not os.path.exists(js): continue
    j = json.load(open(js)); items = j['items']
    man['sources'][n] = {'description': j.get('source'), 'windows': len(items), 'validation': sum(bool(i.get('val')) for i in items)}
    if n in ('chrisdrive', 'chrisfx', 'iowa'): man['sources'][n]['ids'] = sorted({i['id'].split('#')[0].split('@')[0] for i in items})
if os.path.exists('cdprep/chrisdrive-files.json'): man['chrisDrive'] = json.load(open('cdprep/chrisdrive-files.json'))
json.dump(man, open('run/data-manifest.json', 'w'), indent=1)
print('data manifest: ' + ', '.join(f"{n} {s['windows']}" for n, s in man['sources'].items()))
EOF
# Upload the weights now, so a job that runs out of time while scoring still leaves them in the repo.
python3 - <<EOF
import os
from huggingface_hub import HfApi
api = HfApi(); repo = os.environ['HF_REPO']; api.create_repo(repo, private=True, exist_ok=True)
api.upload_folder(repo_id=repo, folder_path='run', path_in_repo=os.environ.get('OUT_DIR') or None, allow_patterns=['model.pt', 'log.json', 'data-manifest.json'],
                  delete_patterns=['onnx/*', 'thresholds.json', 'calibrate.txt', 'eval.*', 'coverage.*', 'data-manifest.json'],   # an earlier run's scores never sit beside new weights
                  commit_message='DGE tagger run at ${REPO_SHA:0:7}: ${MODEL} weights, before scoring')
EOF
CAL=(openmic=prep jamendo=prepj); EVAL=(prep/eval-round1 prep/eval-round2 holdout/holdout-r3)
[ -d scprep ] && CAL+=(soundcloud=scprep)
[ -n "$RS_PID" ] && CAL+=(rawstems=rsprep)
[ -f rsprep/rsfx.json ] && CAL+=(rsfx=rsprep)
[ -n "$IOWA_PID" ] && CAL+=(iowa=iowaprep)
[ -n "$CD_PID" ] && CAL+=(chrisdrive=cdprep chrisfx=cdprep)
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
api.upload_folder(repo_id=repo, folder_path='run', path_in_repo=os.environ.get('OUT_DIR') or None, allow_patterns=['onnx/*', 'thresholds.json', 'log.json', 'calibrate.txt', 'eval.*', 'coverage.*', 'model.pt', 'data-manifest.json'],
                  commit_message='DGE tagger run at ${REPO_SHA:0:7}: ${MODEL}, ${EPOCHS} epochs')
print('uploaded to https://huggingface.co/' + repo)
EOF
if [ -n "$CACHE_PID" ]; then wait $CACHE_PID || echo "prep cache upload failed (training results are unaffected)"; tail -n 2 cache-upload.txt; fi
