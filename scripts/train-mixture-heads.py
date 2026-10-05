"""Heads trained only on layered mixtures (build-mixtures.py), scored on the held-out test mixtures.

These are candidate "in a song" heads: the isolated heads score near 0% once a drum loop plays
underneath, and adding mixtures to isolated training trades isolated accuracy for little mixture gain.
Threshold from 5-fold out-of-fold scores grouped by target source; the test set shares no target
group or drum kit with training. Saves weights for every head at or above the 50% maybe bar.
Usage: train-mixture-heads.py <train manifest@dir> <test manifest@dir> <out.json>"""
import json, sys, glob, datetime
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold

FULL, MAYBE, MIN_TEST = 0.65, 0.5, 15
fit = lambda A, y: LogisticRegression(C=1.0, class_weight='balanced', max_iter=800, tol=1e-3).fit(A, y)

def load(spec):
    manifest, folder = spec.split('@'); emb = {}
    clips = json.load(open(manifest))['clips']; want = {c['id'] for c in clips}
    for f in sorted(glob.glob(f'{folder}/emb-*.jsonl')):
        for line in open(f):
            r = json.loads(line)
            if r['id'] in want: emb[r['id']] = r['embedding']
    clips = [c for c in clips if c['id'] in emb]
    X = np.asarray([emb[c['id']] for c in clips], dtype=np.float32); X /= np.linalg.norm(X, axis=1, keepdims=True)
    return X, [set(c['labels']) - {'drum loop'} for c in clips], np.array([c['group'] for c in clips]), np.array([c['levelDb'] for c in clips])

X, L, G, _ = load(sys.argv[1]); T, TL, _, TLV = load(sys.argv[2])
print(f'train {len(L)} mixes, test {len(TL)} mixes')
results = []
for name in sorted({l for s in TL for l in s}):
    y = np.array([name in s for s in L]); t = np.array([name in s for s in TL])
    if t.sum() < MIN_TEST or y.sum() < 30: continue
    p = np.full(len(y), np.nan)
    for a, b in GroupKFold(n_splits=5).split(X, y, G): p[b] = fit(X[a], y[a]).predict_proba(X[b])[:, 1]
    def balanced(th):
        pr = p >= th; tp = (pr & y).sum(); return min(tp / max(pr.sum(), 1), tp / y.sum())
    th = float(max(np.arange(0.5, 0.995, 0.005), key=balanced))
    m = fit(X, y); pr = m.predict_proba(T)[:, 1] >= th; tp = int((pr & t).sum()); fp = int((pr & ~t).sum())
    P, R = tp / max(tp + fp, 1), tp / t.sum(); buried = t & (TLV < -3)
    r = {'label': name, 'threshold': round(th, 4), 'trainPositive': int(y.sum()), 'testPositive': int(t.sum()), 'tp': tp, 'fp': fp,
         'precision': P, 'recall': R, 'buriedRecall': float((pr & buried).sum() / max(buried.sum(), 1))}
    if min(P, R) >= MAYBE: r['head'] = {'weights': [round(float(w), 6) for w in m.coef_[0]], 'bias': round(float(m.intercept_[0]), 6)}
    results.append(r)
for r in sorted(results, key=lambda r: -min(r['precision'], r['recall'])):
    s = min(r['precision'], r['recall'])
    print(f"{r['label']:<17} +{r['testPositive']:<3} precision {r['precision']:4.0%}  recall {r['recall']:4.0%}  buried {r['buriedRecall']:4.0%}  "
          + ('PASS' if s >= FULL else 'maybe' if s >= MAYBE else ''))
json.dump({'kind': 'mixture-heads-v1', 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'train': sys.argv[1], 'test': sys.argv[2],
           'bars': {'full': FULL, 'maybe': MAYBE}, 'results': results}, open(sys.argv[3], 'w'), indent=1)
