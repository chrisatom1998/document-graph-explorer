"""Train the pilot's CLAP heads (the app's learned-head format) from the accepted manifests.

Usage: python3 -I scripts/licensed-pilot/train_heads.py <out-dir> <emb.jsonl>[,<emb.jsonl>...] <manifest.csv> [<manifest.csv>...]
Manifests: accepted.csv (build_manifest.py) and negatives.csv (negatives_from_mirror.py), after dedupe.py dropped rows.
Writes <out-dir>/heads.json ({kind, heads:[{group,label,weights[512],bias,threshold}]}) and <out-dir>/report.json.

Same recipe as scripts/dj-effects/train.py: logistic regression on the unit-normalised 512-number CLAP embedding the
app computes (scripts/embed-clap.mjs), class-balanced. Only explicit positives (1) and explicit negatives (0) train a
label; unknown rows sit out. Threshold: the one maximising min(precision, recall) over 5-fold out-of-fold scores with
whole fold groups held out (a bass pitch with all its dynamics and round robins, a Kenney sound stem with its
variations, a Freesound uploader), never below 0.5. Out-of-fold scores are reported for <=2.25 s and longer clips
separately; they only pick the threshold. The locked holdout (score_app.py) judges the result.
"""
import csv, json, os, sys
from collections import Counter
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold

OUT, EMB, *MANIFESTS = sys.argv[1:]
os.makedirs(OUT, exist_ok=True)
GROUP = {'bass guitar': 'source', 'foley hit': 'production', 'laser': 'production'}
C = float(os.environ.get('C', '1'))
emb = {}
for f in EMB.split(','):
    for line in open(f):
        r = json.loads(line); emb.setdefault(r['id'], r['embedding'])
rows = [r for m in MANIFESTS for r in csv.DictReader(open(m)) if r['id'] in emb]
missing = sum(1 for m in MANIFESTS for r in csv.DictReader(open(m)) if r['id'] not in emb)
X = np.asarray([emb[r['id']] for r in rows], dtype=np.float64); X /= np.linalg.norm(X, axis=1, keepdims=True)
G = np.array([r['fold_group'] for r in rows]); short = np.array([float(r['duration_s']) <= 2.25 for r in rows])

def prf(t, p):
    tp = int((t & p).sum()); fp = int((~t & p).sum()); fn = int((t & ~p).sum())
    P = tp / (tp + fp) if tp + fp else 0.0; R = tp / (tp + fn) if tp + fn else 0.0
    return {'precision': round(P, 3), 'recall': round(R, 3), 'f1': round(2 * P * R / (P + R), 3) if P + R else 0.0, 'tp': tp, 'fp': fp, 'fn': fn, 'support': int(t.sum())}

heads, report = [], {'missing_embeddings': missing, 'C': C, 'labels': {}}
for label, group in GROUP.items():
    state = np.array([r[label] for r in rows]); use = (state == '1') | (state == '0')
    A, y, g, s = X[use], state[use] == '1', G[use], short[use]
    npos_groups = len(set(g[y]))
    info = {'positives': int(y.sum()), 'negatives': int((~y).sum()), 'positive_groups': npos_groups, 'negative_groups': len(set(g[~y])),
            'by_family': dict(Counter(r['family'] if 'family' in r else 'freesound-cc0' for r, u, st in zip(rows, use, state) if u and st == '1'))}
    if npos_groups < 3: info['skipped'] = 'fewer than 3 positive fold groups'; report['labels'][label] = info; continue
    oof = np.zeros(len(y))
    for tr, te in GroupKFold(n_splits=min(5, npos_groups)).split(A, y, g):
        m = LogisticRegression(C=C, class_weight='balanced', max_iter=2000).fit(A[tr], y[tr]); oof[te] = m.predict_proba(A[te])[:, 1]
    best = max((min(prf(y, oof >= t)['precision'], prf(y, oof >= t)['recall']), t) for t in np.unique(np.round(oof, 4)) if t >= 0.5) if (oof >= 0.5).any() else (0, 0.5)
    th = float(best[1])
    m = LogisticRegression(C=C, class_weight='balanced', max_iter=2000).fit(A, y)
    info.update(threshold=round(th, 4), oof_all=prf(y, oof >= th), oof_short=prf(y[s], oof[s] >= th), oof_long=prf(y[~s], oof[~s] >= th))
    heads.append({'group': group, 'label': label, 'weights': [round(float(w), 6) for w in m.coef_[0]], 'bias': round(float(m.intercept_[0]), 6), 'threshold': round(th, 4)})
    report['labels'][label] = info
json.dump({'kind': 'licensed-pilot-heads-v1', 'encoder': 'Xenova/larger_clap_music_and_speech@e9fd5ac1dbf3280936a7fc3ec8a020453ff184db', 'heads': heads},
          open(os.path.join(OUT, 'heads.json'), 'w'))
json.dump(report, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)
print(json.dumps(report, indent=1))
