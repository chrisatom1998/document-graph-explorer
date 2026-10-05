"""Short training examples for the bass-hit one-shot head: the start of longer development clips, cut to a random
0.15-1.0 s with a 25 ms fade-out. Development clips only (train + Surge train + calibration; the frozen test split is
excluded); each crop keeps its source's labels and family group, so grouped CV never splits a crop from its source.

Why: the development set had only 3 bass-hit positives under 0.5 s (20 under 1 s) of 255, and the head missed most
bass one-shots that short (docs/evaluations/short-clips-2026-10-04/README section "Very short clips").

Outputs under $W/crops/: <id>.wav, crop-items.json (trainer item format) and feature-list-crops.json for
  REPEAT_ONLY=1 node scripts/short-clip-features.mjs $W/crops/feature-list-crops.json $W/crops/features-crops-0.jsonl
Then: CROPS=1 ONLY='role:bass hit' STATS_FROM=... MERGE_INTO=... <venv>/python scripts/train-short-clip-heads.py export
Usage: <venv>/python scripts/short-clip-crops.py"""
import importlib.util, sys, json, os, random, subprocess
import numpy as np
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
W = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints/short-clips'
OUT = f'{W}/crops'; os.makedirs(OUT, exist_ok=True)
spec = importlib.util.spec_from_file_location('heads', f'{ROOT}/scripts/train-short-clip-heads.py'); sys.argv = ['x', 'import-only']; h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
paths = {}
for f in ['feature-list.json', 'feature-list-surge.json']:
    if os.path.exists(f'{W}/{f}'): paths.update({r['id']: r['path'] for r in json.load(open(f'{W}/{f}'))})
test = {i['id'] for i in json.load(open(f'{ROOT}/docs/evaluations/short-clips-2026-10-04/manifest.json'))['items'] if i['split'] == 'test'}
rng = random.Random(20261005)
CAT = 'role:bass hit'
rows = [(i, l, g) for i, l, g in zip(h.DEV, h.DEV_LAB, h.DEV_GROUPS) if i['id'] in paths and i['id'] not in test and h.feats[i['id']]['seconds'] >= .6]
pos = [r for r in rows if r[1].get(CAT) == 'present']
neg = [r for r in rows if r[1].get(CAT) == 'absent']; rng.shuffle(neg); neg = neg[:2500]
items = []
for item, lab, group in pos + neg:
    secs = h.feats[item['id']]['seconds']; L = round(rng.uniform(.15, min(1.0, secs - .05)), 3)
    cid = f"crop-{item['id']}"; dst = f'{OUT}/{cid}.wav'
    if not os.path.exists(dst):
        subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', paths[item['id']], '-t', str(L), '-af', f'afade=t=out:st={L - .025:.3f}:d=0.025', dst], check=True)
    items.append({'id': cid, 'source': item['id'], 'seconds': L, 'groups': {'artist': str(group)},
                  'reviews': [{'dimension': k.split(':', 1)[0], 'label': k.split(':', 1)[1], 'state': v} for k, v in lab.items()]})
json.dump({'seed': 20261005, 'items': items}, open(f'{OUT}/crop-items.json', 'w'))
json.dump([{'id': i['id'], 'path': f"{OUT}/{i['id']}.wav"} for i in items], open(f'{OUT}/feature-list-crops.json', 'w'))
print(len(pos), 'bass sources,', len(neg), 'other sources,', len(items), 'crops; lengths', np.percentile([i['seconds'] for i in items], [0, 50, 100]))
