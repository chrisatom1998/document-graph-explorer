"""Train short-clip heads on the new public training pool. Test split is never read.

Selection: 5-fold group CV (uploader / instrument / participant / guitar-note) over train + calibration,
choose C and threshold on out-of-fold scores; ship only categories reaching P>=.70 and R>=.70.
Also reports OOF metrics on the FSD50K-only subset (real-world recordings) to expose dataset shortcuts.
Usage: python train_heads.py [compare|export] [out.json]"""
import json, glob, sys, os, datetime, collections
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from joblib import Parallel, delayed

W = '/home/user/media/dj-training-fingerprints/short-clips'
ROOT = '/home/user/document-graph-explorer'
MODE = sys.argv[1] if len(sys.argv) > 1 else 'compare'
TARGET = .70
feats = {}
for f in glob.glob(f'{W}/features-*.jsonl'):
    for line in open(f):
        r = json.loads(line); feats[r['id']] = np.array(r['clapRepeat'], dtype=np.float32)
man = json.load(open(f'{ROOT}/docs/evaluations/short-clips-2026-10-04/manifest.json'))
meta = json.load(open(f'{ROOT}/docs/evaluations/short-clips-2026-10-04/item-meta.json'))
assert not any(i['split'] == 'test' and i['id'] in feats for i in man['items']), 'test features must not be cached'
cal = [dict(i, meta=meta[i['id']]) for i in man['items'] if i['split'] == 'calibration']
train = json.load(open(f'{W}/train-items.json'))['items']
DEV = [i for i in train + cal if i['id'] in feats]
LAB = [{f"{r['dimension']}:{r['label']}": r['state'] for r in i['reviews']} for i in DEV]
G = np.array([i['groups']['artist'] for i in DEV]); DS = np.array([i['meta']['dataset'] for i in DEV])
X = np.stack([feats[i['id']] for i in DEV]); X /= np.linalg.norm(X, axis=1, keepdims=True) + 1e-9
MEAN, STD = X.mean(0), X.std(0) + 1e-6; Xs = (X - MEAN) / STD   # final export only; CV folds standardise on their own training rows
print('dev items', len(DEV), collections.Counter(DS), file=sys.stderr)

EMIT = {'role:kick': ('production', 'kick'), 'role:snare': ('production', 'snare'), 'role:clap': ('production', 'clap'),
        'role:hi-hat': ('production', 'hi-hat'), 'role:cymbal': ('production', 'cymbal'), 'role:finger snap': ('production', 'finger snap'),
        'role:tambourine': ('production', 'tambourine'), 'role:cowbell': ('production', 'cowbell'), 'role:shaker': ('production', 'shaker'),
        'role:percussion hit': ('production', 'percussion hit'), 'role:whoosh': ('production', 'whoosh'), 'role:impact': ('production', 'impact'),
        'role:vinyl scratch': ('production', 'vinyl scratch'), 'role:beatbox': ('production', 'beatbox'), 'role:bass hit': ('production', 'bass hit'),
        'role:synth hit': ('production', 'synth hit'), 'source:voice': ('source', 'voice'), 'source:guitar': ('source', 'guitar'),
        'source:piano': ('source', 'piano'), 'source:synthesizer': ('source', 'synthesizer'), 'source:drums': ('source', 'drums'),
        'source:bass guitar': ('source', 'bass guitar'), 'source:brass': ('source', 'horn'),
        'effect:distorted': ('character', 'distorted'), 'effect:reverberant': ('character', 'reverberant')}

def fit(Xa, y, C): return LogisticRegression(C=C, max_iter=3000, class_weight='balanced').fit(Xa, y)
def prf(pred, y):
    tp = (pred & y).sum(); P = tp / pred.sum() if pred.sum() else 0.; R = tp / y.sum() if y.sum() else 0.
    return P, R, (2 * P * R / (P + R) if P + R else 0.)
def pick(p, y):
    best = None
    for t in np.unique(np.round(np.concatenate([[.5], p[p >= .5]]), 4)):
        P, R, f1 = prf(p >= t, y)
        if best is None or (P >= TARGET and R >= TARGET, P >= TARGET, f1) > (best[1] >= TARGET and best[2] >= TARGET, best[1] >= TARGET, best[3]): best = (t, P, R, f1)
    return best
def one(cat, Cs=(0.03, 0.3)):
    m = np.array([cat in l for l in LAB]); y = np.array([l.get(cat) == 'present' for l in LAB])[m]
    if y.sum() < 10 or (~y).sum() < 10: return cat, None
    Xr, gm, dm = X[m], G[m], DS[m]; Xm = Xs[m]; best = None
    for C in Cs:
        p = np.zeros(len(y))
        for a, b in GroupKFold(5).split(Xr, y, gm):
            if not 2 <= y[a].sum() < len(a) - 1: continue
            # LEGACY_GLOBAL_NORM=1 reproduces the shipped 2026-10-05 heads, selected with all-development statistics.
            mu, sd = (MEAN, STD) if os.environ.get('LEGACY_GLOBAL_NORM') else (Xr[a].mean(0), Xr[a].std(0) + 1e-6)
            p[b] = fit((Xr[a] - mu) / sd, y[a], C).predict_proba((Xr[b] - mu) / sd)[:, 1]
        t, P, R, f1 = pick(p, y)
        if best is None or (P >= TARGET and R >= TARGET, f1) > (best[2] >= TARGET and best[3] >= TARGET, best[4]): best = (C, t, P, R, f1, p)
    C, t, P, R, f1, p = best
    by = {}
    for d in sorted(set(dm)):
        k = dm == d
        if y[k].sum() or (p[k] >= t).sum():
            Pd, Rd, _ = prf(p[k] >= t, y[k]); by[d] = dict(pos=int(y[k].sum()), neg=int((~y[k]).sum()), fired=int((p[k] >= t).sum()), P=round(float(Pd), 3), R=round(float(Rd), 3))
    return cat, dict(C=C, threshold=float(t), precision=round(float(P), 3), recall=round(float(R), 3), f1=round(float(f1), 3),
                     pos=int(y.sum()), neg=int((~y).sum()), posFamilies=len(set(gm[y])), byDataset=by, model=fit(Xm, y, C))

res = dict(r for r in Parallel(n_jobs=4)(delayed(one)(c) for c in EMIT) if r[1])
report = {c: {k: v for k, v in r.items() if k != 'model'} | {'ships': r['precision'] >= TARGET and r['recall'] >= TARGET} for c, r in sorted(res.items())}
for c, r in report.items():
    print(f"{c:22s} P {r['precision']:.2f} R {r['recall']:.2f} pos {r['pos']:5d} fam {r['posFamilies']:4d} {'SHIP' if r['ships'] else '----'}  " +
          ' '.join(f"{d}:{v['P']:.2f}/{v['R']:.2f}({v['pos']})" for d, v in r['byDataset'].items()))
if MODE == 'export':
    out = sys.argv[2]
    heads = [{'group': EMIT[c][0], 'label': EMIT[c][1], 'weights': [round(float(w), 6) for w in res[c]['model'].coef_[0]],
              'bias': round(float(res[c]['model'].intercept_[0]), 6), 'threshold': round(max(.5, res[c]['threshold']), 4)}
             for c in sorted(res) if report[c]['ships']]
    model = {'version': 1, 'kind': 'short-clip-heads', 'revision': f'short-clip-{datetime.date.today().isoformat()}-public-v2',
             'clapEncoder': 'Xenova/larger_clap_music_and_speech@e9fd5ac1dbf3280936a7fc3ec8a020453ff184db', 'eventFeatures': 'event-shape-v1',
             'blocks': ['clapRepeat'], 'maxSeconds': 2.25, 'mean': [round(float(v), 6) for v in MEAN], 'std': [round(float(v), 6) for v in STD], 'heads': heads}
    json.dump(model, open(out, 'w'), separators=(',', ':'))
    json.dump({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'target': TARGET, 'devItems': dict(collections.Counter(DS)),
               'selection': 'group 5-fold OOF over train+calibration; test never read', 'categories': report}, open(out.replace('.json', '-selection.json'), 'w'), indent=1)
    print('wrote', out, len(heads), 'heads')
