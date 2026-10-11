#!/usr/bin/env bash
# Effect pairs v2 on a Hugging Face Jobs CPU (cpu-upgrade): plan + render with build_pairs_v2.py, then stage to the
# private dataset cmjatom/dge-private-train under coverage/effect-pairs/v2/. Train-only sources; no held-out audio is
# read. Env: REPO_SHA, HF_TOKEN (write). Launch:
#   hf jobs run --flavor cpu-upgrade --timeout 2h --secrets HF_TOKEN -e REPO_SHA=<sha> python:3.12 \
#     bash -c "curl -sL https://raw.githubusercontent.com/chrisatom1998/document-graph-explorer/<sha>/scripts/audio-model/coverage/effects/hf-pairs-v2-job.sh | bash"
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -q && apt-get install -yq --no-install-recommends ffmpeg git ca-certificates > /dev/null
pip install -q numpy scipy soundfile pedalboard huggingface_hub
W=/work; mkdir -p $W && cd $W
git clone -q https://github.com/chrisatom1998/document-graph-explorer.git dge && git -C dge checkout -q "$REPO_SHA"
FX=$W/dge/scripts/audio-model/coverage/effects
python3 - <<'PY'
import os, sys
from huggingface_hub import HfApi, hf_hub_download
api = HfApi(); R = 'cmjatom/dge-private-train'
if not api.repo_info(R, repo_type='dataset').private: sys.exit('repo not private; refusing')
for f in ['round13/manifest-v1.csv', 'run9/v1-audit/manifest-audited.csv', 'coverage/effect-pairs/plan.csv'] + \
         [f'empty-tags/v1/{p}/manifest.csv' for p in ('nsynth', 'csd')]:
    hf_hub_download(R, f, repo_type='dataset', local_dir='/work/src')
PY
python3 $FX/build_pairs_v2.py plan /work/src /work/plan.csv
python3 - <<'PY'
import csv
from huggingface_hub import hf_hub_download
need = set()
for r in csv.DictReader(open('/work/plan.csv')):
    need.add(f"{r['part']}/{r['file'].split('/')[0]}")
    if r['carrier_file']: need.add(f"{r['carrier_part']}/{r['carrier_file'].split('/')[0]}")
for f in sorted(need):
    print('get', f, flush=True); hf_hub_download('cmjatom/dge-private-train', f, repo_type='dataset', local_dir='/work/src')
PY
python3 $FX/build_pairs_v2.py render /work/plan.csv /work/src /work/out --workers 8
python3 $FX/check_pairs.py /work/out | tee /work/out/check.txt
cp /work/plan.csv /work/out/plan.csv; mkdir -p /work/out/code
cp $FX/effects.py $FX/effects_v2.py $FX/build_pairs.py $FX/build_pairs_v2.py $FX/select_sources.py $FX/check_pairs.py $FX/hf-pairs-v2-job.sh /work/out/code/
python3 - <<'PY'
import os
from huggingface_hub import HfApi
api = HfApi()
api.upload_folder(repo_id='cmjatom/dge-private-train', repo_type='dataset', folder_path='/work/out', path_in_repo='coverage/effect-pairs/v2',
                  commit_message=f"effect pairs v2 (8 tags) from {os.environ['REPO_SHA'][:9]}")
print('uploaded')
PY
