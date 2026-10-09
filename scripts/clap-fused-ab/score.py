"""Scores two CLAP encoders on the same held-out clips: zero-shot (prompt similarity) and retrained logistic heads.

Judge-only: every choice (prompt threshold, head C, head threshold) is made on the FIT split; the EVAL split is only
scored. DJ effects: fit = training uploaders, eval = held-out uploaders (docs/evaluations/dj-effects-2026-10-06/clips.json).
Short clips: fit = calibration split, eval = frozen test split (docs/evaluations/short-clips-2026-10-04/manifest.json).
Thresholds maximise min(precision, recall) on fit scores (heads: grouped 5-fold out-of-fold), the project's 70/70 target.
Usage: score.py dj|short <emb dir> <prompts dir> <out.json>
  <emb dir>/<model>/*.jsonl  {id, embedding};  <prompts dir>/<model>.json  [{label, prompt, vector}]"""
import glob, json, os, sys, datetime
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, average_precision_score
from sklearn.model_selection import GroupKFold

KIND, EMB, PROMPTS, OUT = sys.argv[1:5]
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
TARGET, MIN_EVAL, MIN_FIT = 0.70, 10, 10
MODELS = {'current': 'laion/larger_clap_music_and_speech', 'fused': 'laion/clap-htsat-fused'}

def labels_dj():
    spec = json.load(open(f'{ROOT}/scripts/dj-effects/labels.json')); overlap = [set(s) for s in spec['overlap']]
    related = lambda a, b: a == b or any(a in s and b in s for s in overlap)
    clips = json.load(open(f'{ROOT}/docs/evaluations/dj-effects-2026-10-06/clips.json'))['clips']
    out = {}
    for L in sorted({l for c in clips for l in c['labels']}):
        rows = {}
        for c in clips:
            if L in c['labels']: rows[c['id']] = 1
            elif not any(related(L, m) for m in c['labels']): rows[c['id']] = 0
        out[L] = rows
    meta = {c['id']: ('fit' if c['split'] == 'train' else 'eval', c['username']) for c in clips}
    return out, meta

def labels_short():
    items = json.load(open(f'{ROOT}/docs/evaluations/short-clips-2026-10-04/manifest.json'))['items']
    out = {}
    for i in items:
        for r in i['reviews']:
            if r['state'] in ('present', 'absent'): out.setdefault(f"{r['dimension']}:{r['label']}", {})[i['id']] = int(r['state'] == 'present')
    meta = {i['id']: ('fit' if i['split'] == 'calibration' else 'eval', i['groups']['sampleFamily']) for i in items}
    return out, meta

LABELS, META = labels_dj() if KIND == 'dj' else labels_short()
l2 = lambda X: X / np.linalg.norm(X, axis=-1, keepdims=True)

def load(model):
    E = {}
    for f in glob.glob(f'{EMB}/{model}/*.jsonl'):
        for line in open(f):
            if line.strip(): r = json.loads(line); E[r['id']] = r['embedding']
    P = {}
    for p in json.load(open(f'{PROMPTS}/{model}.json')): P.setdefault(p['label'], p['vector'])
    return E, P

def prf(t, pred):
    tp = int((pred & t).sum()); fp = int((pred & ~t).sum()); fn = int((~pred & t).sum())
    return round(tp / (tp + fp), 3) if tp + fp else 0.0, round(tp / (tp + fn), 3) if tp + fn else 0.0

def threshold(t, s):
    best = None
    for th in np.unique(np.round(s, 4)):
        pred = s >= th; tp = int((pred & t).sum())
        if not tp: continue
        P, R = tp / pred.sum(), tp / t.sum(); key = (min(P, R), 2 * P * R / (P + R))
        if best is None or key > best[0]: best = (key, float(th))
    return best[1] if best else float('inf')

def evaluate(t_fit, s_fit, t_ev, s_ev):
    th = threshold(t_fit, s_fit); P, R = prf(t_ev, s_ev >= th)
    return {'auc': round(roc_auc_score(t_ev, s_ev), 3), 'ap': round(average_precision_score(t_ev, s_ev), 3),
            'threshold': round(th, 4), 'precision': P, 'recall': R, 'pass': P >= TARGET and R >= TARGET}

def head_scores(X, t, g, Xev):
    k = min(5, len(set(g)), int(t.sum()))
    best = None
    for C in (0.3, 1, 3, 10, 30):
        oof = np.zeros(len(t))
        for a, b in GroupKFold(k).split(X, t, g):
            if t[a].all() or not t[a].any(): continue
            oof[b] = LogisticRegression(C=C, max_iter=3000, class_weight='balanced').fit(X[a], t[a]).predict_proba(X[b])[:, 1]
        ap = average_precision_score(t, oof)
        if best is None or ap > best[0]: best = (ap, C, oof)
    m = LogisticRegression(C=best[1], max_iter=3000, class_weight='balanced').fit(X, t)
    return best[2], m.predict_proba(Xev)[:, 1], best[1]

data = {m: load(m) for m in MODELS}
common = set.intersection(*(set(E) for E, _ in data.values()))
results, prompts_used = {}, {}
for L, rows in LABELS.items():
    ids = sorted(i for i in rows if i in common)
    t = np.array([rows[i] for i in ids], bool); split = np.array([META[i][0] for i in ids]); g = np.array([META[i][1] for i in ids])
    fit, ev = split == 'fit', split == 'eval'
    if t[ev].sum() < MIN_EVAL or (~t[ev]).sum() < MIN_EVAL: continue
    res = {'evalPos': int(t[ev].sum()), 'evalNeg': int((~t[ev]).sum()), 'fitPos': int(t[fit].sum()), 'fitNeg': int((~t[fit]).sum())}
    for m in MODELS:
        E, P = data[m]; X = l2(np.array([E[i] for i in ids], float))
        name = L.split(':')[-1]
        if name in P:
            z = X @ l2(np.array(P[name], float))
            res[f'{m}.zeroShot'] = evaluate(t[fit], z[fit], t[ev], z[ev]) if t[fit].sum() else {'auc': round(roc_auc_score(t[ev], z[ev]), 3), 'ap': round(average_precision_score(t[ev], z[ev]), 3)}
        if t[fit].sum() >= MIN_FIT and (~t[fit]).sum() >= MIN_FIT:
            oof, sev, C = head_scores(X[fit], t[fit], g[fit], X[ev])
            res[f'{m}.head'] = {**evaluate(t[fit], oof, t[ev], sev), 'C': C}
    results[L] = res

def summary(kind):
    s = {}
    for m in MODELS:
        rs = [r[f'{m}.{kind}'] for r in results.values() if f'{m}.{kind}' in r and all(f'{x}.{kind}' in r for x in MODELS)]
        if not rs: continue
        s[m] = {'labels': len(rs), 'meanAuc': round(float(np.mean([r['auc'] for r in rs])), 3), 'meanAp': round(float(np.mean([r['ap'] for r in rs])), 3),
                'pass7070': sum(bool(r.get('pass')) for r in rs)}
    both = [L for L, r in results.items() if all(f'{x}.{kind}' in r for x in MODELS)]
    s['newlyPassingWithFused'] = [L for L in both if results[L][f'fused.{kind}'].get('pass') and not results[L][f'current.{kind}'].get('pass')]
    s['lostWithFused'] = [L for L in both if results[L][f'current.{kind}'].get('pass') and not results[L][f'fused.{kind}'].get('pass')]
    s['fusedBetterAp'] = sum(results[L]['fused.' + kind]['ap'] > results[L]['current.' + kind]['ap'] for L in both)
    return s

out = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'set': KIND, 'models': MODELS,
       'clipsWithBothFingerprints': len(common), 'target': TARGET,
       'summary': {'zeroShot': summary('zeroShot'), 'head': summary('head')}, 'labels': results}
json.dump(out, open(OUT, 'w'), indent=1)
print(json.dumps(out['summary'], indent=1))
for L, r in results.items():
    cell = lambda k: (lambda x: f"AP {x['ap']:.2f} P{x.get('precision', 0):.2f} R{x.get('recall', 0):.2f}{'*' if x.get('pass') else ' '}")(r[k]) if k in r else '-' * 22
    print(f"{L:28s} +{r['evalPos']:4d} | zs cur {cell('current.zeroShot')} fus {cell('fused.zeroShot')} | head cur {cell('current.head')} fus {cell('fused.head')}")
