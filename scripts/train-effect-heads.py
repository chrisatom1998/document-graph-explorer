"""Trains one logistic head per effect label on the app's 512-number CLAP fingerprints.

Every dry source note is kept wholly inside one split, so a note heard clean in training
is never heard with an effect in testing. 20% of notes are held out from fitting AND from
threshold choice. Heads are exported in the exact form learnedDjModel.ts evaluates:
logit = bias + sum(w_i * v_i / |v|), shown when sigmoid(logit) >= threshold (0.5..1).
Usage: train-effect-heads.py <manifest.json> <embeddings dir> <out dir>"""
import json, sys, glob, hashlib, datetime, os
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold, GroupShuffleSplit

MANIFEST, EMB, OUT = sys.argv[1:4]
os.makedirs(OUT, exist_ok=True)
TARGET = 0.70
man = json.load(open(MANIFEST)); labels = man['labels']
meta = {c['id']: c for c in man['clips']}
ids, X, seen = [], [], set()
for f in sorted(glob.glob(f'{EMB}/emb-*.jsonl')):
    for line in open(f):
        r = json.loads(line)
        # A resumed or re-sharded run can fingerprint a clip twice; count it once.
        if r['id'] in meta and r['id'] not in seen: seen.add(r['id']); ids.append(r['id']); X.append(r['embedding'])
X = np.asarray(X, dtype=np.float64)
X /= np.linalg.norm(X, axis=1, keepdims=True)          # the app normalises before scoring
y = np.array([meta[i]['label'] for i in ids]); g = np.array([meta[i]['group'] for i in ids])
src = np.array([meta[i]['source'] for i in ids])
print(f'clips with fingerprints: {len(ids)} of {len(meta)}   dry-note groups: {len(set(g))}')

train_idx, test_idx = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=20261004).split(X, y, g))
assert not set(g[train_idx]) & set(g[test_idx]), 'note leaked across splits'

def choose_threshold(t, p):
    """Highest-F1 threshold with precision >= 70%; the app refuses thresholds below 0.5."""
    best = None
    for th in np.unique(np.round(p, 4)):
        if th < 0.5: continue
        pred = p >= th; tp = int((pred & t).sum()); fp = int((pred & ~t).sum()); fn = int((~pred & t).sum())
        if not tp: continue
        P, R = tp / (tp + fp), tp / (tp + fn); F = 2 * P * R / (P + R)
        if P >= TARGET and (best is None or F > best[0]): best = (F, float(th))
    return best[1] if best else None

heads, report = [], {}
for label in labels:
    t_all = (y == label)
    Xtr, ttr, gtr = X[train_idx], t_all[train_idx], g[train_idx]
    if ttr.sum() < 20 or (~ttr).sum() < 20 or len(set(gtr[ttr])) < 5:
        report[label] = {'trainPositive': int(ttr.sum()), 'testPositive': int(t_all[test_idx].sum()), 'threshold': None,
                         'verdict': 'too few training examples'}
        continue
    # Out-of-fold scores on training notes pick the threshold; the test notes stay untouched.
    oof = np.zeros(len(train_idx))
    for a, b in GroupKFold(n_splits=5).split(Xtr, ttr, gtr):
        m = LogisticRegression(C=1.0, class_weight='balanced', max_iter=500, tol=1e-3).fit(Xtr[a], ttr[a])
        oof[b] = m.predict_proba(Xtr[b])[:, 1]
    th = choose_threshold(ttr, oof)
    model = LogisticRegression(C=1.0, class_weight='balanced', max_iter=500, tol=1e-3).fit(Xtr, ttr)
    pt = model.predict_proba(X[test_idx])[:, 1]; tt = t_all[test_idx]
    entry = {'trainPositive': int(ttr.sum()), 'testPositive': int(tt.sum()), 'testNegative': int((~tt).sum()), 'threshold': th}
    if th is None:
        entry['verdict'] = 'no threshold reaches 70% precision on training notes'
    else:
        pred = pt >= th; tp = int((pred & tt).sum()); fp = int((pred & ~tt).sum()); fn = int((~pred & tt).sum())
        P = tp / (tp + fp) if tp + fp else 0.0; R = tp / (tp + fn) if tp + fn else 0.0
        entry.update(tp=tp, fp=fp, fn=fn, precision=P, recall=R, passes=P >= TARGET and R >= TARGET)
        # Per-source check: a head that only works on one dataset has learned that dataset.
        entry['bySource'] = {}
        for s in sorted(set(src)):
            k = src[test_idx] == s; ps, ts = pred[k], tt[k]
            tps = int((ps & ts).sum()); fps = int((ps & ~ts).sum()); fns = int((~ps & ts).sum())
            entry['bySource'][s] = {'precision': tps / (tps + fps) if tps + fps else None, 'recall': tps / (tps + fns) if tps + fns else None}
        heads.append({'group': 'character', 'label': label, 'weights': [round(float(w), 7) for w in model.coef_[0]],
                      'bias': round(float(model.intercept_[0]), 7), 'threshold': round(th, 4)})
    report[label] = entry

print(f"\n{'effect':<13}{'test+':>6}{'thresh':>8}{'precision':>11}{'recall':>8}   verdict")
for label, e in report.items():
    if e['threshold'] is None: print(f"{label:<13}{e['testPositive']:>6}{'-':>8}{'-':>11}{'-':>8}   {e['verdict']}"); continue
    print(f"{label:<13}{e['testPositive']:>6}{e['threshold']:>8.3f}{e['precision']*100:>10.1f}%{e['recall']*100:>7.1f}%   {'PASS' if e['passes'] else 'fails'}")
print(f"\npassing 70/70 on held-out notes: {sum(1 for e in report.values() if e.get('passes'))}/{len(labels)}")

json.dump({'kind': 'effect-heads-report-v1', 'trainedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'clips': len(ids), 'heldOutNotes': len(set(g[test_idx])), 'target': TARGET, 'labels': report},
          open(f'{OUT}/report.json', 'w'), indent=1)
json.dump(heads, open(f'{OUT}/heads.json', 'w'))
print(f'wrote {OUT}/report.json and {len(heads)} heads')
