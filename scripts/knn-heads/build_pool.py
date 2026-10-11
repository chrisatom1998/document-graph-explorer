"""Join round 11 CLAP/CED training features with their labels into one example pool (training data only).
Writes pool.npz (pool_id, clap, ced, tags) and pool.csv (original manifest columns + pool_id) for filter_training.py."""
import csv, glob, json, os, sys
import numpy as np
WORK = os.environ.get('KNN_WORK', '/tmp/knn')  # container scratch: features, test embeddings, model files
csv.field_size_limit(1 << 30)
F = f"{WORK}/feat/round11"; OUT = f"{WORK}/pool"
os.makedirs(OUT, exist_ok=True)
man = {}
def add(prefix, path, key='file', idcol=None, tagcol='tags'):
    for r in csv.DictReader(open(path)):
        man[prefix + r[key]] = (r, r.get(tagcol) or '')
for p in glob.glob(f'{F}/run9/manifests/*.csv'):
    add(os.path.basename(p)[len('run9__v1__'):-4] + '/', p)
for p in glob.glob(f'{F}/emptytags/manifests/*.csv'):
    part = os.path.basename(p)[len('empty-tags__v1__'):-4].replace('freesound__', '')
    add(part + '/', p)
for r in csv.DictReader(open('/mnt/project-files/datasets/commercial-train/labels/labels.csv')):
    man['commercial/' + r['path']] = (r, r['present_tags'])
ids, clap, ced, tags, rows, miss = [], [], [], [], [], 0
for f in sorted(glob.glob(f'{F}/run9/*.npz') + glob.glob(f'{F}/emptytags/*.npz') + glob.glob(f'{F}/commercial/*.npz')):
    z = np.load(f); d = {'id': z['id'], 'clap': z['clap'], 'ced_emb': z['ced_emb']}
    for i, k in enumerate(d['id']):
        m = man.get(str(k))
        if m is None: miss += 1; continue
        r, t = m
        tl = sorted({x.strip() for x in t.replace('|', ';').split(';') if x.strip()})
        if not tl: continue
        ids.append(str(k)); clap.append(d['clap'][i].copy()); ced.append(d['ced_emb'][i].copy()); tags.append('|'.join(tl))
        rows.append(dict(r, pool_id=str(k)))
print('pool', len(ids), 'unmatched', miss)
np.savez(f'{OUT}/pool.npz', pool_id=np.array(ids), clap=np.stack(clap), ced=np.stack(ced), tags=np.array(tags))
cols = sorted({c for r in rows for c in r})
with open(f'{OUT}/pool.csv', 'w', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=['pool_id'] + [c for c in cols if c != 'pool_id']); w.writeheader(); w.writerows(rows)
