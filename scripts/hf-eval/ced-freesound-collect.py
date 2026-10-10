"""Collect step of tasks/ced-freesound.sh: merge the per-shard CED scores and list candidate clips per DGE tag.

Usage: ced-freesound-collect.py <parts dir> <results dir> <tag map json>
Writes <results dir>/summary.json and labels.txt (counts only), and uploads candidates.csv (tag, freesound_id,
username, license, seconds, score) to the private dataset <HF user>/dge-eval-runs under runs/<RUN_KEY>/.
"""
import csv
import glob
import io
import json
import os
import sys

import numpy as np

shards, r, mapf = sys.argv[1:4]
tags = json.load(open(mapf))['tags']
files = sorted(glob.glob(f'{shards}/part-*/*.npz'))
ids, users, lic, secs, probs = [], [], [], [], []
for f in files:
    z = np.load(f, allow_pickle=False)
    ids.append(z['freesound_id']); users.append(z['username']); lic.append(z['license'])
    secs.append(z['seconds']); probs.append(z['probs'])
if not files:
    sys.exit('no shard results found')
ids, users, lic, secs = (np.concatenate(a) for a in (ids, users, lic, secs))
P = np.concatenate(probs).astype(np.float32)

out = io.StringIO()
w = csv.writer(out)
w.writerow(['tag', 'freesound_id', 'username', 'license', 'seconds', 'score'])
counts = {}
for tag, cls in tags.items():
    s = P[:, cls].max(axis=1)
    idx = np.where(s >= 0.3)[0]
    idx = idx[np.argsort(-s[idx])][:1000]
    counts[tag] = {'>=0.3': int((s >= 0.3).sum()), '>=0.5': int((s >= 0.5).sum()), '>=0.7': int((s >= 0.7).sum())}
    for i in idx:
        w.writerow([tag, int(ids[i]), users[i], int(lic[i]), round(float(secs[i]), 2), round(float(s[i]), 3)])

labels = glob.glob(f'{shards}/part-*/labels.txt')
if labels:
    open(f'{r}/labels.txt', 'w').write(open(labels[0]).read())
summary = {'shards_done': len(files), 'shards_total': 1475, 'clips_scored': int(len(ids)),
           'run_key': os.environ.get('RUN_KEY', ''), 'per_tag': counts}
json.dump(summary, open(f'{r}/summary.json', 'w'), indent=1)
print(json.dumps({k: v for k, v in summary.items() if k != 'per_tag'}))
for t, c in counts.items():
    print(f'{t:20s} {c}')

from huggingface_hub import HfApi  # noqa: E402

api = HfApi()
repo = api.whoami()['name'] + '/dge-eval-runs'
path = f"runs/{os.environ['RUN_KEY']}/candidates.csv"
api.upload_file(path_or_fileobj=out.getvalue().encode(), path_in_repo=path, repo_id=repo, repo_type='dataset',
                commit_message=f"{os.environ['RUN_KEY']} CED candidates")
print(f'candidates uploaded to {repo}/{path}')
