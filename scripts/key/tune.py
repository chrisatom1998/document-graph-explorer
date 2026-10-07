"""Fit and score key models on the features scripts/key/features.mjs records (docs/evaluations/key-2026-10-06/features).

Usage: python3 scripts/key/tune.py [cv | fit | score]
Round 3's reserved MTG key tracks (r3_held) are dropped from tune-mtg on load; the 500 round 2 tracks are mtg-500.
  cv    : track-grouped 5-fold cross-validation of model variants on the tuning sets only (tune-mtg, tune-gtzan).
  fit   : fit the chosen variant on all tuning rows and write src/audio/keyModel.json
          (args: transform bins bass|nobass l2 gtzan-weight show-threshold).
  score : score the app, Essentia's edma profile and the fitted model on every set (held-out sets included).

The model scores each of the 24 keys as w_mode . (chroma rotated to that tonic) + a per-mode bias: a
transposition-invariant softmax over the 24 keys (2 x 36 weights + 2 biases for the shipped variant). Pitch classes are C-indexed here and in the app.
"""
import glob, gzip, hashlib, json, math, os, sys
import numpy as np
from scipy.optimize import minimize

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
FEATURES = os.path.join(ROOT, os.environ.get('KEY_FEATURES', 'docs/evaluations/key-2026-10-06/features'))
MODEL = os.path.join(ROOT, 'src/audio/keyModel.json')
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

def r3_held(track):
    """Round 3's reserved half of the unused MTG key tracks (the fresh audio test set thread); never tuned on."""
    name = track.split(':', 1)[1]
    return track.startswith('mtg:') and int(hashlib.sha256(f'dge-holdout-r3-2026-10-06|{name}'.encode()).hexdigest()[:8], 16) % 2 == 0

def load():
    sets = {}
    for p in sorted(glob.glob(f'{FEATURES}/*.json.gz')):
        rows = [r for r in json.load(gzip.open(p, 'rt')) if not r.get('error')]
        if os.path.basename(p).startswith('tune-mtg'): rows = [r for r in rows if not r3_held(r['track'])]
        sets[os.path.basename(p)[:-len('.json.gz')]] = rows
    return sets

def gate(e):
    """The app's excerpt gate: no single repeated pitch, at least 3 s, at least three pitch classes."""
    return not (e.get('pitch') and e['pitch']['confidence'] >= 0.9) and e['seconds'] >= 3 and e['diverse'] and e['full']

def fold(full36):
    """36 bins from A (a third of a semitone each) -> 12 C-indexed pitch classes."""
    f = np.asarray(full36, float)
    a = np.array([f[(3 * k - 1) % 36] + f[3 * k] + f[(3 * k + 1) % 36] for k in range(12)])   # A-indexed
    return np.roll(a, 9)   # index 0 = C (A is pitch class 9)

def norm(v, how):
    v = np.asarray(v, float)
    if how == 'sqrt': v = np.sqrt(np.maximum(v, 0))
    if how == 'log': v = np.log1p(10 * np.maximum(v, 0))
    v = v - v.mean()
    n = np.linalg.norm(v)
    return v / n if n > 0 else v

def design(e, how, bins, bass):
    """X[t] = features rotated so that tonic t sits at index 0; shape (12, d). bins 36 keeps the third-of-a-semitone
    resolution (index 0 = the bin centred on C) and rotates by whole semitones."""
    if bins == 36:
        c = norm(np.roll(np.asarray(e['full'], float), 27), how)   # bin 9 (C, from A) -> index 0
        X = np.stack([np.roll(c, -3 * t) for t in range(12)])
    else:
        c = norm(fold(e['full']), how)
        X = np.stack([np.roll(c, -t) for t in range(12)])
    if bass:
        b = norm(np.roll(np.asarray(e['bass'], float), 9), how)    # bass is 12 bins from A too
        X = np.concatenate([X, np.stack([np.roll(b, -t) for t in range(12)])], 1)
    return X

class Model:
    def __init__(self, how='log', bins=36, bass=False, l2=1e-3, weights=None):
        self.how, self.bins, self.bass, self.l2, self.w = how, bins, bass, l2, weights
    def design(self, e):
        return design(e, self.how, self.bins, self.bass)
    def logits(self, X, w):
        d = X.shape[1]
        wm, bm, wn, bn = w[:d], w[d], w[d + 1:2 * d + 1], w[2 * d + 1]
        return np.concatenate([X @ wm + bm, X @ wn + bn])   # 0-11 major tonics, 12-23 minor tonics
    def fit(self, excerpts, labels, weights):
        Xs = [self.design(e) for e in excerpts]
        y = np.array([t + (12 if m == 'minor' else 0) for t, m in labels])
        sw = np.asarray(weights, float); sw = sw / sw.sum()
        d = Xs[0].shape[1]
        X = np.stack(Xs)   # (n, 12, d)
        def loss(w):
            wm, bm, wn, bn = w[:d], w[d], w[d + 1:2 * d + 1], w[2 * d + 1]
            z = np.concatenate([X @ wm + bm, X @ wn + bn], axis=1)
            z = z - z.max(1, keepdims=True)
            p = np.exp(z); p /= p.sum(1, keepdims=True)
            nll = -(sw * np.log(p[np.arange(len(y)), y] + 1e-12)).sum()
            g = p.copy(); g[np.arange(len(y)), y] -= 1; g *= sw[:, None]
            gm = np.einsum('ni,nid->d', g[:, :12], X); gn = np.einsum('ni,nid->d', g[:, 12:], X)
            reg = self.l2 * (wm @ wm + wn @ wn)
            grad = np.concatenate([gm + 2 * self.l2 * wm, [g[:, :12].sum()], gn + 2 * self.l2 * wn, [g[:, 12:].sum()]])
            return nll + reg, grad
        w0 = np.zeros(2 * d + 2)
        self.w = minimize(loss, w0, jac=True, method='L-BFGS-B').x
        return self
    def predict(self, e):
        z = self.logits(self.design(e), self.w)
        p = np.exp(z - z.max()); p /= p.sum()
        k = int(p.argmax())
        return {'tonic': k % 12, 'mode': 'minor' if k >= 12 else 'major', 'p': float(p[k])}

def combine(keys, n):
    """src/audio/key.ts combineKeys: shown when at least half of the excerpts agree."""
    for k in keys:
        same = [x for x in keys if x['tonic'] == k['tonic'] and x['mode'] == k['mode']]
        if len(same) >= math.ceil(n / 2): return k
    return None

def relation(est, ref):
    if est is None: return 'none'
    if est['tonic'] == ref['tonic'] and est['mode'] == ref['mode']: return 'exact'
    d = (est['tonic'] - ref['tonic']) % 12
    if est['mode'] == ref['mode'] and d in (5, 7): return 'fifth'
    if ref['mode'] == 'major' and est['mode'] == 'minor' and d == 9: return 'relative'
    if ref['mode'] == 'minor' and est['mode'] == 'major' and d == 3: return 'relative'
    if est['tonic'] == ref['tonic']: return 'parallel'
    return 'other'

MIREX = {'exact': 1, 'fifth': .5, 'relative': .3, 'parallel': .2}

def summary(rows, estimates):
    rel = [relation(est, r['truth']) for r, est in zip(rows, estimates)]
    n = len(rows); shown = sum(x != 'none' for x in rel)
    out = {'n': n, 'shown': shown / n if n else 0, 'exact': rel.count('exact') / n if n else 0,
           'mirex': sum(MIREX.get(x, 0) for x in rel) / n if n else 0}
    for k in ('fifth', 'relative', 'parallel', 'other'): out[k] = rel.count(k)
    out['minorAsMajor'] = sum(1 for r, est, x in zip(rows, estimates, rel) if x == 'parallel' and r['truth']['mode'] == 'minor')
    out['majorShown'] = sum(1 for est in estimates if est and est['mode'] == 'major') / max(1, shown)
    return out

def fmt(s):
    return (f"n {s['n']:4d}  shown {s['shown']:.3f}  exact {s['exact']:.3f}  mirex {s['mirex']:.3f}  "
            f"fifth {s['fifth']:3d} rel {s['relative']:3d} par {s['parallel']:3d} (minor->major {s['minorAsMajor']:3d}) other {s['other']:3d}  "
            f"major among shown {s['majorShown']:.2f}")

def estimate(rows, method, model=None, threshold=0.0, strength=0.6):
    """'app' as recorded; 'bgate'/'edma' Essentia per excerpt with the half-of-excerpts vote; 'vote' the model per
    excerpt with that vote; 'model' the model on the mean chroma of the gated excerpts (what the app ships)."""
    out = []
    for r in rows:
        if method == 'app': out.append(r.get('appKey', r.get('chromaKey'))); continue   # v2 tuning rows hold no network output
        keys = []
        for e in r['excerpts']:
            if not gate(e): continue
            if method == 'model':   # src/audio/key.ts recordingKey: mean chroma of the gated excerpts
                continue
            if method in ('bgate', 'edma'):
                k = e.get(method)
                if k and k['strength'] >= strength: keys.append(k)
            else:
                k = model.predict(e)
                if k['p'] >= threshold: keys.append(k)
        if method == 'model':
            es = [e for e in r['excerpts'] if gate(e)]
            k = model.predict({'full': list(np.mean([e['full'] for e in es], 0)), 'bass': es[0]['bass']}) \
                if es and len(es) >= math.ceil(r['excerptCount'] / 2) else None
            out.append(k if k and k['p'] >= threshold else None); continue
        out.append(combine(keys, r['excerptCount']))
    return out

def tuning_data(sets, gtzan_weight):
    ex, lab, wt, grp = [], [], [], []
    for s in ('tune-mtg', 'tune-gtzan'):
        for r in sets.get(s, []):
            for e in r['excerpts']:
                if gate(e):
                    ex.append(e); lab.append((r['truth']['tonic'], r['truth']['mode']))
                    wt.append(gtzan_weight if s == 'tune-gtzan' else 1.0); grp.append(r['track'])
    return ex, lab, wt, grp

VARIANTS = [dict(how=h, bins=n, bass=b, l2=l2) for h in ('raw', 'sqrt', 'log') for n in (12, 36) for b in (False, True) for l2 in (1e-4, 1e-3, 1e-2)]

def cv(sets):
    tune = sets['tune-mtg'] + sets['tune-gtzan']
    tracks = sorted({r['track'] for r in tune})
    fold_of = {t: int(hashlib.sha256(t.encode()).hexdigest()[:8], 16) % 5 for t in tracks}
    print('baselines on the tuning sets:')
    for s in ('tune-mtg', 'tune-gtzan'):
        for m in ('app', 'edma'): print(f'  {s:10s} {m:8s}', fmt(summary(sets[s], estimate(sets[s], m))))
    for gw in (1.0,):
        for v in VARIANTS:
            res = {s: ([], []) for s in ('tune-mtg', 'tune-gtzan')}
            for f in range(5):
                ex, lab, wt, grp = tuning_data({s: [r for r in sets[s] if fold_of[r['track']] != f] for s in res}, gw)
                model = Model(**v).fit(ex, lab, wt)
                for s in res:
                    test = [r for r in sets[s] if fold_of[r['track']] == f]
                    res[s][0].extend(test); res[s][1].extend(estimate(test, 'model', model))
            line = '  '.join(f"{s} exact {summary(*res[s])['exact']:.3f} mirex {summary(*res[s])['mirex']:.3f}" for s in res)
            print(f'gtzan x{gw:.0f} {v}: {line}')

def fit(sets, how, bins, bass, l2, gtzan_weight, threshold):
    ex, lab, wt, _ = tuning_data(sets, gtzan_weight)
    model = Model(how, bins, bass, l2).fit(ex, lab, wt)
    d = len(model.w) // 2 - 1
    json.dump({'version': 1, 'trainedOn': 'scripts/key/tune.py fit: GiantSteps MTG key tracks outside the round 2 test, and half of GTZAN',
               'transform': how, 'bins': bins, 'bass': bass, 'l2': l2, 'gtzanWeight': gtzan_weight, 'excerpts': len(ex),
               'threshold': threshold,
               'major': {'weights': [round(x, 5) for x in model.w[:d]], 'bias': round(model.w[d], 5)},
               'minor': {'weights': [round(x, 5) for x in model.w[d + 1:2 * d + 1]], 'bias': round(model.w[2 * d + 1], 5)}},
              open(MODEL, 'w'), indent=1)
    print('wrote', MODEL, 'from', len(ex), 'excerpts')

def saved_model():
    m = json.load(open(MODEL))
    w = np.array(m['major']['weights'] + [m['major']['bias']] + m['minor']['weights'] + [m['minor']['bias']])
    return Model(m['transform'], m['bins'], m['bass'], m['l2'], w), m['threshold']

if __name__ == '__main__':
    sets = load()
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'cv'
    if cmd == 'cv': cv(sets)
    elif cmd == 'fit':   # e.g. fit log 36 nobass 1e-3 1 0.25
        fit(sets, sys.argv[2], int(sys.argv[3]), sys.argv[4] == 'bass', float(sys.argv[5]), float(sys.argv[6]), float(sys.argv[7]))
    elif cmd == 'score':
        model, threshold = saved_model()
        for s, rows in sets.items():
            for m in ('app', 'edma', 'vote', 'model'):
                print(f'{s:11s} {m:6s}', fmt(summary(rows, estimate(rows, m, model, threshold))))
