"""Do heads learned from made-up clips (make-processed-clips.py) find the real thing?

For each processed tag: train a head on the processed clips plus every other dataset, with every
library file named after that tag removed from training. Then score it on two things:
  1. held-out processed groups (Freesound uploader / Slakh track / seed bucket) - is the edit learnable;
  2. the real library: all files whose name says this tag, against every other library file - does it transfer.
Threshold is picked on training rows only (5-fold by group), never on either test.
Usage: check-processed-tags.py <out.json> name=manifest.json@fingerprint_dir ..."""
import json, sys, os, glob, hashlib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
import importlib.util
_spec = importlib.util.spec_from_file_location('labeler', 'scripts/label-sample-library.py')
labeler = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(labeler)

FP = os.path.expanduser('~/Documents/Media/dj-training-fingerprints')
OUT = sys.argv[1]; EXTRAS = [a.split('=', 1) for a in sys.argv[2:]]
BAR = 0.45   # user's pass bar, 2026-10-05
TAGS = ['reversed vocal', 'pitched vocal', 'vocoder vocal', 'reverse cymbal', 'reverse impact', 'record stop', 'sub drop', 'noise', 'vinyl crackle']

def load(manifest, folder, source):
    meta = {c['id']: c for c in json.load(open(manifest))['clips']}; got = {}
    for f in sorted(glob.glob(f'{folder}/emb-*.jsonl')):
        for line in open(f):
            r = json.loads(line)
            if r['id'] in meta and r['id'] not in got: got[r['id']] = r['embedding']
    rows = [meta[i] for i in got]
    X = np.asarray([got[r['id']] for r in rows], np.float32); X /= np.linalg.norm(X, axis=1, keepdims=True)
    L = [set(r.get('labels') or ([r['label']] if r.get('label') else [])) for r in rows]
    if source == 'vault': L = [l & set(labeler.match(r['id'][len('vault:'):])) for l, r in zip(L, rows)]
    return X, L, np.array([f"{source}:{r.get('vendor') or r.get('group')}" for r in rows]), np.full(len(rows), source)

parts = [load(f'{FP}/vault-clap/manifest.json', f'{FP}/vault-clap', 'vault')] + [load(*s.split('@'), n) for n, s in EXTRAS]
X = np.vstack([p[0] for p in parts]); LAB = sum((p[1] for p in parts), []); G = np.concatenate([p[2] for p in parts]); SRC = np.concatenate([p[3] for p in parts])
VAULT = SRC == 'vault'; PROC = SRC == 'processed'
fit = lambda A, y: LogisticRegression(C=1.0, class_weight='balanced', max_iter=600, tol=1e-3).fit(A, y)

def score(t, p):
    tp, fp, fn = int((p & t).sum()), int((p & ~t).sum()), int((~p & t).sum())
    P = tp / (tp + fp) if tp + fp else 0.0; R = tp / (tp + fn) if tp + fn else 0.0
    return {'positive': int(t.sum()), 'tp': tp, 'fp': fp, 'precision': round(P, 3), 'recall': round(R, 3)}

out = {}
for tag in TAGS:
    pos = np.array([tag in s for s in LAB])
    pg = sorted(set(G[PROC & pos]), key=lambda g: hashlib.sha256(f'{tag}|{g}'.encode()).hexdigest())
    test_groups = set(pg[:max(1, len(pg) // 4)])                     # a quarter of processed groups, by hash
    proc_test = PROC & np.isin(G, sorted(test_groups))
    train = ~proc_test & ~(VAULT & pos)                              # the real library positives are never trained on
    a = np.where(train)[0]; oof = np.full(len(a), np.nan)
    for i, j in GroupKFold(5).split(X[a], pos[a], G[a]): oof[j] = fit(X[a][i], pos[a][i]).predict_proba(X[a][j])[:, 1]
    best = max(((min(((oof >= th) & pos[a]).sum() / max((oof >= th).sum(), 1), ((oof >= th) & pos[a]).sum() / pos[a].sum()), th)
                for th in np.arange(0.5, 0.99, 0.01)), default=(0, 0.5))
    th = float(best[1]); m = fit(X[a], pos[a])
    p = m.predict_proba(X)[:, 1] >= th
    out[tag] = {'threshold': round(th, 2), 'trainPositive': int(pos[a].sum()),
                'heldOutEdits': score(pos[proc_test], p[proc_test]), 'realLibrary': score(pos[VAULT], p[VAULT])}
    from collections import Counter   # what the library calls the files it wrongly tags (unnamed files may still be right)
    out[tag]['falseTagNames'] = Counter(l for i in np.where(VAULT & p & ~pos)[0] for l in (LAB[i] or {'(no tag)'})).most_common(6)
    r = out[tag]; print(f"{tag:15s} edits P{r['heldOutEdits']['precision']:.2f} R{r['heldOutEdits']['recall']:.2f} | "
                        f"library {r['realLibrary']['positive']:3d} named: found {r['realLibrary']['tp']}, false tags {r['realLibrary']['fp']} of {VAULT.sum()}")
json.dump(out, open(OUT, 'w'), indent=1)
