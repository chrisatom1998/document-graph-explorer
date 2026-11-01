"""Write few-shot neighbour heads into public/sound-model/learned.json (Oct 11 2026, docs/evaluations/knn-heads-2026-10-11).

Usage: python3 -I build.py <pool.npz> <banks.json> <picks.json> [learned.json]

- pool.npz: training clips' app CLAP vectors (pool_id, clap [N, 512], tags 'a|b') from the round 11 feature bucket.
- banks.json: the exact example and background pool ids the held-out check scored ({background: [...], tags: {tag: [...]}}).
  Those ids already passed the private exclude list, and no pool clip within cosine 0.995 of a test clip was eligible.
- picks.json: {tag: {group, cutoff}} for the tags that passed the check.
Vectors are stored as int8 of the unit vector (cosine ignores scale).
"""
import base64, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from learned_store import load_learned, write_learned
import numpy as np
pool, banks_path, picks_path = sys.argv[1:4]
out = sys.argv[4] if len(sys.argv) > 4 else 'public/sound-model/learned.json'
K = 5
z = np.load(pool); banks = json.load(open(banks_path)); picks = json.load(open(picks_path))
row = {str(p): i for i, p in enumerate(z['pool_id'])}
X = z['clap'].astype(np.float32); X /= np.maximum(np.linalg.norm(X, axis=1, keepdims=True), 1e-8)
tags = [set(str(s).split('|')) for s in z['tags']]
q8 = lambda V: base64.b64encode(np.clip(np.round(V / np.abs(V).max(1, keepdims=True) * 127), -127, 127).astype(np.int8).tobytes()).decode()
bg = [row[p] for p in banks['background']]
heads = []
for tag in sorted(picks):
    heads.append({'group': picks[tag]['group'], 'label': tag, 'examples': q8(X[[row[p] for p in banks['tags'][tag]]]),
                  'skipBackground': [k for k, j in enumerate(bg) if tag in tags[j]], 'cutoff': round(float(picks[tag]['cutoff']), 5)})
model = load_learned(out)
model['neighbours'] = {'k': K, 'background': q8(X[bg]), 'heads': heads}
model['revision'] = model['revision'].split('+knn-heads')[0] + '+knn-heads-2026-10-11'
digest = write_learned(out, model)
print(f'{len(heads)} neighbour heads, background {len(bg)}, integrity {digest[:12]}')
