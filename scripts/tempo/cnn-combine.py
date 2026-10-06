"""Tune and check when the tempo CNN's reading replaces the app's (src/audio/tempoCnn.ts, combineTempo).

Usage: python3 scripts/tempo/cnn-combine.py [--heldout]
Tuning: the half-time correction's out-of-fold tempo on its tuning clips (docs/evaluations/tempo-2026-10-06/features,
GiantSteps tracks outside round 1 plus half of GTZAN) against the CNN's out-of-fold readings on the same clips.
--heldout scores the chosen rule once on round 1's 500 clips, round 2's 500 clips and the other GTZAN half, using the
app's browser tempo after #116 and the final CNN. Needs numpy and scikit-learn.
"""
import collections, gzip, json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import train as T

D = 'docs/evaluations/tempo-cnn-2026-10-06/model'
RULE = 0.5   # src/audio/tempoCnn.ts CNN_OVERRIDE_CONFIDENCE
ok = lambda e, t: bool(e) and abs(e - t) <= 0.04 * t


def confidence(o):
    """Top-3 softmax mass within 4% of the CNN's tempo, as cnnTempo computes it."""
    return sum(p for b, p in o['top3'] if abs(b - o['cnn_bpm']) <= 0.04 * o['cnn_bpm'])


def combine(app, o, threshold=RULE):
    usable = 40 <= o['cnn_bpm'] <= 250 and confidence(o) > threshold
    return o['cnn_bpm'] if usable and abs(o['cnn_bpm'] / app - 1) > 0.04 else app


def oof_app():
    """Out-of-fold version of the #116 correction on its own tuning clips (same folds and model as train.py)."""
    import numpy as np
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.model_selection import GroupKFold
    rows = [x for x in T.load('docs/evaluations/tempo-2026-10-06/features/tune.json.gz') if max(x['tempogram']) > 0]
    X, y, g, clip, bpm = [], [], [], [], []
    for i, x in enumerate(rows):
        for c, f in T.candidates(x['tempogram'], x['app']['bpm']):
            X.append(f); y.append(int(T.ok(c, x['truth']))); g.append(x['key']); clip.append(i); bpm.append(c)
    X, y = np.array(X), np.array(y)
    probs = np.zeros(len(y))
    for tr, te in GroupKFold(n_splits=5).split(X, y, g):
        probs[te] = HistGradientBoostingClassifier(**T.PARAMS).fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
    by = collections.defaultdict(list)
    for r, i in enumerate(clip):
        by[i].append((bpm[r], probs[r]))
    return [(x, T.pick(by[i], x['app']['bpm'])) for i, x in enumerate(rows)]


def table(rows, title):
    """rows: (group, truth, app, combined)."""
    res = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
    for group, t, a, c in rows:
        for k in ('all', group):
            r = res[k]; r[0] += 1; r[1] += ok(a, t); r[2] += ok(c, t); r[3] += ok(c, t) and not ok(a, t); r[4] += ok(a, t) and not ok(c, t)
    print(title)
    for k, (n, a, c, fx, br) in sorted(res.items(), key=lambda kv: (kv[0] != 'all', -kv[1][0])):
        if n >= 15:
            print(f'  {k[:22]:22s} n={n:4d} within 4%: {a / n:.3f} -> {c / n:.3f}  fixed {fx} broke {br}')


if __name__ == '__main__':
    oof = json.load(gzip.open(f'{D}/tempo-oof-top3.json.gz'))
    tune = {r['id']: r for r in oof['tune']}
    rows = [(x, a) for x, a in oof_app() if x['id'] in tune]
    for th in (0.3, 0.4, 0.5, 0.6):
        table([(f"{x['source']} {'full' if x['cut'] in ('full', 'mid20') else '10 s'}", x['truth'], a, combine(a, tune[x['id']], th))
               for x, a in rows], f'tuning (out of fold), confidence > {th}')
    if '--heldout' in sys.argv:
        held = {r['id']: r for r in oof['heldout']}
        genre = {it['id']: it.get('genre') for p in ('docs/evaluations/dj-clips-2026-10-06/giantsteps-manifest.json',
                                                     'docs/evaluations/dj-clips-round2-2026-10-06/mtg-key-manifest.json')
                 for it in json.load(open(p))['items']}
        for name, s in json.load(gzip.open(f'{D}/tempo-heldout.json.gz')).items():
            table([(genre.get(r['id']) or r['id'].split('-')[1], r['truth'], r['app'],
                    combine(r['app'], held[r['id']]) if r['app'] and r['id'] in held else r['app']) for r in s['rows']],
                  f'{name} (held out), confidence > {RULE}')
