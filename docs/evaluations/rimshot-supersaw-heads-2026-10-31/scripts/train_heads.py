"""Fit rimshot / supersaw heads on app q8 CLAP fingerprints of TRAINING clips only (freesound-laion-640k mirror clips
filtered against the private exclude list, plus DSP renders for supersaw). C, hard-negative weight and (supersaw) renders
on/off are chosen on 5-fold out-of-fold scores of the REAL clips, folds by uploader; renders only sit in training folds.
Threshold: lowest OOF cutoff with precision >= MIN_P (0.7) on real clips, never below 0.5.
Usage: train_heads.py <tag> <manifest.json>... --emb <dir> --out <head.json> [--one-shot]"""
import json, sys, glob, os, argparse
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.metrics import average_precision_score
ap = argparse.ArgumentParser(); ap.add_argument('tag'); ap.add_argument('manifests', nargs='+'); ap.add_argument('--emb'); ap.add_argument('--out')
ap.add_argument('--hard', default='drum-hit'); ap.add_argument('--one-shot', action='store_true', help='also run the head on clips of 2.25 s or less'); a = ap.parse_args(); MIN_P = float(os.environ.get('MIN_P', 0.7))
meta = {}
for m in a.manifests: meta.update({c['id']: c for c in json.load(open(m))['clips']})
emb = {}
for f in sorted(glob.glob(f'{a.emb}/emb-*.jsonl')):
    for line in open(f):
        r = json.loads(line)
        if r['id'] in meta: emb[r['id']] = r['embedding']
ids = sorted(emb); X = np.asarray([emb[i] for i in ids]); X = X / np.linalg.norm(X, axis=1, keepdims=True)
other = {'rimshot': 'supersaw', 'supersaw': 'rimshot'}[a.tag]
keep = np.array([other not in meta[i]['labels'] for i in ids])   # the other tag's positives are not negatives evidence here
ids = [i for i, k in zip(ids, keep) if k]; X = X[keep]
y = np.array([a.tag in meta[i]['labels'] for i in ids]); kind = np.array([meta[i].get('kind', 'real') for i in ids])
G = np.array([meta[i]['group'] for i in ids]); real = ~np.char.startswith(kind.astype(str), 'render')
print(f'{a.tag}: real {real.sum()} ({y[real].sum()} pos, {(kind == a.hard).sum()} hard negatives), renders {(~real).sum()} ({y[~real].sum()} pos)')
def fit(mask, C, hw):
    w = np.where(np.isin(kind[mask], [a.hard, 'render-neg']), hw, 1.0)
    m = LogisticRegression(C=C, class_weight='balanced', max_iter=5000); m.fit(X[mask], y[mask], sample_weight=w); return m
def oof(variant, C, hw):
    p = np.full(len(ids), np.nan); ri = np.where(real)[0]
    for tr, te in GroupKFold(5).split(ri, y[ri], G[ri]):
        mask = np.zeros(len(ids), bool); mask[ri[tr]] = True
        if variant != 'real': mask |= ~real
        p[ri[te]] = fit(mask, C, hw).predict_proba(X[ri[te]])[:, 1]
    return p
def thr(t, p):
    for th in np.unique(np.round(p, 4)):
        if th < 0.5: continue
        pred = p >= th; tp = (pred & t).sum(); fp = (pred & ~t).sum()
        if tp and tp / (tp + fp) >= MIN_P: return float(th), int(tp), int(fp), int(t.sum())
    return None
best = None
for variant in (['real', 'renders'] if (~real).any() else ['real']):
    for hw in [1.0, 3.0]:
        for C in [0.3, 1, 3, 10, 30]:
            p = oof(variant, C, hw); t = y[real]; pr = p[real]
            apv = average_precision_score(t, pr); hh = kind[real] == a.hard; hfa = (pr[hh] >= 0.5).mean() if hh.any() else 0
            th = thr(t, pr); print(f'{variant:8s} hw {hw} C {C:>4}: OOF AP {apv:.3f}  hard FA@0.5 {hfa:.3f}  thr {th}')
            if th and (best is None or apv > best[0]): best = (apv, variant, hw, C, th)
print('best', best)
apv, variant, hw, C, (th, tp, fp, npos) = best
mask = real | (~real if variant != 'real' else np.zeros(len(ids), bool))
m = fit(mask, C, hw)
head = {'group': 'production', 'label': a.tag, 'weights': [round(float(v), 6) for v in m.coef_[0]], 'bias': round(float(m.intercept_[0]), 6), 'threshold': round(th, 4)}
if a.one_shot: head['oneShot'] = True
json.dump({'head': head, 'choice': {'variant': variant, 'hardWeight': hw, 'C': C, 'oofAP': apv, 'oofThreshold': th, 'oofTP': tp, 'oofFP': fp, 'oofPositives': npos},
           'trainClips': {'real': int(real.sum()), 'realPositives': int(y[real].sum()), 'renders': int((~real).sum())}}, open(a.out, 'w'))
