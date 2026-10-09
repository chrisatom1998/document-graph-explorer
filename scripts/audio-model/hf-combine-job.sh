#!/usr/bin/env bash
# Combine several tagger runs into the one browser model the app loads (combine.py: per tag, the run that scored best on
# held-out audio), score the result on the same held-out sets, write the browser parity reference, and publish it to the
# public model repo $PUBLIC_REPO under $LICENSE. Launched by .github/workflows/tagger-combine.yml through hf-launch.py
# (JOB_SCRIPT=hf-combine-job.sh). Env: REPO_SHA, HF_REPO (private runs), RUNS (folders of HF_REPO, the shipped run
# first), KEEP, PUBLIC_REPO, LICENSE, HF_TOKEN (secret).
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
KEY=$( (ls $S/prepare*.py | grep -v prepare-rawstems.py | xargs cat; cat $S/labelmap.py; echo "prep prepj holdout fsdprep nsprep fsprep xprep") | sha256sum | cut -c1-12)
python3 - "$KEY" $RUNS <<'PY'
import os, sys
from huggingface_hub import HfApi, snapshot_download
key, runs = sys.argv[1], sys.argv[2:]
api = HfApi(); data = api.whoami()['name'] + '/dge-tagger-data'; base = f'prep-cache/{key}'
snapshot_download(data, repo_type='dataset', local_dir='cache', max_workers=16,
                  allow_patterns=[f'{base}/{p}' for p in ('prep/eval-round*', 'holdout/*', 'fsdprep/eval-*', 'nsprep/eval-*', 'fsprep/eval-*')])
snapshot_download(os.environ['HF_REPO'], local_dir='runs', allow_patterns=[f'{r}/{f}' for r in runs for f in ('model.pt', 'log.json', 'thresholds.json', 'eval.json')])
PY
C=cache/prep-cache/$KEY
python3 $S/combine.py out $W/dge/src/audio/taggerPolicy.json $(for r in $RUNS; do echo runs/$r; done) --keep "${KEEP:-}" | tee out/combine.txt
python3 $S/evaluate.py out/model.onnx out/thresholds.json out/eval.json $C/prep/eval-round1 $C/prep/eval-round2 $C/holdout/holdout-r3 \
  $C/fsdprep/eval-fsd50k $C/nsprep/eval-nsynth-test $C/nsprep/eval-nsynth-test-fx $C/fsprep/eval-freesound > out/eval.txt
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
scored best on held-out audio. Runs: {', '.join(m['runs'])}. `picks.json` lists every tag's held-out numbers and choice,
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
