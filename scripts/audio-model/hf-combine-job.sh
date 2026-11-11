#!/usr/bin/env bash
# Combine several tagger runs into the one browser model the app loads (combine.py: per tag, the run that scored best on
# validation clips), score the result once on the held-out test sets, write the browser parity reference, and publish it to the
# public model repo $PUBLIC_REPO under $LICENSE. Launched by .github/workflows/tagger-combine.yml through hf-launch.py
# (JOB_SCRIPT=hf-combine-job.sh). Env: REPO_SHA, HF_REPO (private runs), RUNS (folders of HF_REPO, the shipped run
# first), KEEP, ALLOW_HAND_PICKS (1 to accept ONLY/PIN), ONLY (optional: RUN=output,output entries separated by ';', the only outputs each named run may take), PIN (same format: outputs forced to a named run),
# PUBLIC_REPO, LICENSE, HF_TOKEN (secret).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -q && apt-get install -yq --no-install-recommends git ca-certificates > /dev/null
pip install -q scikit-learn scipy onnx onnxruntime huggingface_hub
W=/work; mkdir -p $W && cd $W
git clone -q https://github.com/chrisatom1998/document-graph-explorer.git dge && git -C dge checkout -q "$REPO_SHA"
git clone -q https://github.com/fschmid56/EfficientAT.git && git -C EfficientAT checkout -q a425fdce92572e602a1d5634799bd9f1f2efa806
export EFFICIENTAT=$W/EfficientAT
S=$W/dge/scripts/audio-model
# The held-out sets come from the training jobs' prep cache (same key as hf-job.sh with ALL_TAGS=1).
KEY=$( (ls $S/prepare*.py | grep -v -e prepare-rawstems.py -e prepare-iowa.py -e prepare-chrisdrive.py -e prepare-vcsl.py -e prepare-slakh-more.py -e prepare-sao.py -e prepare-fsnew.py -e prepare-run9.py -e prepare-round10.py | xargs cat; cat $S/labelmap.py; echo "prep prepj holdout fsdprep nsprep fsprep xprep") | sha256sum | cut -c1-12)
python3 - "$KEY" $RUNS <<'PY'
import os, sys
from huggingface_hub import HfApi, snapshot_download
key, runs = sys.argv[1], sys.argv[2:]
api = HfApi(); data = api.whoami()['name'] + '/dge-tagger-data'
# A training-only prepare change (e.g. #278 in prepare-freesound.py) moves the key while the held-out sets stay the same.
# Then fall back to the one cached key that has them, and say so.
have = [f.path.split('/')[-1] for f in api.list_repo_tree(data, repo_type='dataset', path_in_repo='prep-cache') if f.path.split('/')[-1] != 'src']
if key not in have:
    assert len(have) == 1, f'prep-cache key {key} missing and no single fallback: {have}'
    print(f'NOTE: prep-cache/{key} not built; using held-out sets from prep-cache/{have[0]}', flush=True); key = have[0]
open('prep-key.txt', 'w').write(key); base = f'prep-cache/{key}'
snapshot_download(data, repo_type='dataset', local_dir='cache', max_workers=16,
                  allow_patterns=[f'{base}/{p}' for p in ('prep/eval-round*', 'holdout/*', 'fsdprep/eval-*', 'nsprep/eval-*', 'fsprep/eval-*')])
snapshot_download(os.environ['HF_REPO'], local_dir='runs', allow_patterns=[f'{r}/{f}' for r in runs for f in ('model.pt', 'log.json', 'thresholds.json', 'eval.json')])
PY
KEY=$(cat prep-key.txt); C=cache/prep-cache/$KEY
# Re-score every input with the same FSD50K labels before comparing old and new runs.
# Keep each run's frozen thresholds and all other benchmark rows.
python3 $S/refresh-fsd50k-eval.py $C/fsdprep/eval-fsd50k $(for r in $RUNS; do echo runs/$r; done)
mkdir -p out
ONLY_ARGS=()
if [ -n "${ONLY:-}" ]; then IFS=';' read -ra ONLY_PARTS <<< "$ONLY"; for o in "${ONLY_PARTS[@]}"; do ONLY_ARGS+=(--only "$o"); done; fi
if [ -n "${PIN:-}" ]; then IFS=';' read -ra PIN_PARTS <<< "$PIN"; for o in "${PIN_PARTS[@]}"; do ONLY_ARGS+=(--pin "$o"); done; fi
# combine.py picks on validation clips only and refuses hand picks unless the request opts in (allow_hand_picks).
if [ "${ALLOW_HAND_PICKS:-}" = 1 ]; then ONLY_ARGS+=(--allow-hand-picks); fi
python3 $S/combine.py out $W/dge/src/audio/taggerPolicy.json $(for r in $RUNS; do echo runs/$r; done) --keep "${KEEP:-}" "${ONLY_ARGS[@]}" | tee out/combine.txt
python3 $S/evaluate.py out/model.onnx out/thresholds.json out/eval.json $C/prep/eval-round1 $C/prep/eval-round2 $C/holdout/holdout-r3 \
  $C/fsdprep/eval-fsd50k $C/nsprep/eval-nsynth-test $C/nsprep/eval-nsynth-test-fx $C/fsprep/eval-freesound | tee out/eval.txt
mkdir -p pub/onnx && mv out/model.onnx out/model.json pub/onnx/ && cp out/thresholds.json out/picks.json out/eval.json out/eval.txt out/combine.txt pub/
python3 $S/parity.py pub/onnx/model.onnx pub/parity.json
python3 - <<'PY'
import json, os
from huggingface_hub import HfApi
m = json.load(open('pub/onnx/model.json')); lic = os.environ.get('LICENSE', 'mit')
nc = lic.startswith('cc-by-nc')
open('pub/README.md', 'w').write(f"""---
license: {lic}
tags: [audio-classification, onnx, efficientat]
---
# DGE all-tags tagger (combined)

The sound tagger of [Document Graph Explorer](https://github.com/chrisatom1998/document-graph-explorer): EfficientAT
networks fine-tuned by `scripts/audio-model/`, combined by `combine.py` so each of the app's tags comes from the run that
scored best on validation clips (the held-out sets are scored once, after choosing). Runs: {', '.join(m['runs'])}. `picks.json` lists every tag's choice and validation numbers,
`eval.txt` the combined model's held-out scores. Input: 10 s of 32 kHz mono (`samples32k`); output: `scores` (sigmoid).

Base networks and AudioSet weights: EfficientAT (Florian Schmid et al.), MIT.
""" + ("""
**Licence: CC BY-NC-SA 4.0, non-commercial only.** One of the runs was trained on Mixing Secrets multitrack songs
(RawStems), whose licence allows non-commercial research and education only.
""" if nc else ''))
api = HfApi(); repo = os.environ['PUBLIC_REPO']
api.create_repo(repo, private=False, exist_ok=True)
info = api.upload_folder(repo_id=repo, folder_path='pub', commit_message=f"Combined tagger: {', '.join(m['runs'])}")
print('published', repo, 'revision', info.oid.translate(str.maketrans('0123456789', 'ABCDEFGHIJ')), '(digits as letters A-J)')
PY
