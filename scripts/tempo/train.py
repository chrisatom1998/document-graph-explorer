"""Train the tempo correction in src/audio/tempoCorrection.json, then score it once on held-out sets.

Usage: python3 scripts/tempo/train.py <features dir> [--write] [--heldout]
  <features dir> holds tune / gtzan-test / holdout .json.gz from .github/workflows/tempo-features.yml.
  Tuning uses tune.json.gz only (GiantSteps tracks outside the 500-clip DJ test, plus half of GTZAN).
  --write    fits on all of tune and writes src/audio/tempoCorrection.json
  --heldout  scores the written model on gtzan-test and holdout (the frozen 500 DJ clips)
Needs numpy and scikit-learn. Feature code must stay identical to src/audio/tempoCorrection.ts.
"""
import collections, gzip, json, math, sys

MULTS = [1, 2, 0.5, 1.5, 2 / 3, 4 / 3, 0.75]
HARM = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 4 / 3, 1.5, 2, 3]
LO, HI, MARGIN = 60, 200, 0.3
PARAMS = dict(max_depth=3, max_iter=200, learning_rate=0.05, l2_regularization=1.0, random_state=0)
MODEL = 'src/audio/tempoCorrection.json'


def load(path):
    return [x for x in json.load(gzip.open(path)) if x.get('app') and x.get('tempogram')]


def ok(e, t):
    return bool(e and t) and abs(e - t) / t <= 0.04


def at(tg, bpm):
    if bpm < 40 or bpm > 250:
        return 0.0
    f = bpm - 40
    i = int(f)
    if i >= len(tg) - 1:
        return tg[-1]
    return tg[i] * (1 - (f - i)) + tg[i + 1] * (f - i)


def peak(tg, bpm):
    lo, hi = bpm * 0.97, bpm * 1.03
    return max(at(tg, lo + (hi - lo) * k / 6) for k in range(7))


def candidates(tg, base):
    tmax = max(tg)
    out = []
    for m in MULTS:
        c = base * m
        if m != 1 and not (LO <= c <= HI):
            continue
        f = [peak(tg, c) / tmax] + [peak(tg, c * h) / tmax if 40 <= c * h <= 250 else 0.0 for h in HARM]
        f += [math.log2(c / 120), math.log2(c / 120) ** 2] + [1.0 if v == m else 0.0 for v in MULTS]
        out.append((c, f))
    return out


def pick(scored, base):
    """scored: [(bpm, probability)] with the tracker's own tempo first."""
    best = max(scored, key=lambda r: r[1])
    return best[0] if best[1] - scored[0][1] > MARGIN else base


def report(rows, picks, title):
    res = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
    for x, p in zip(rows, picks):
        a, c = ok(x['app']['bpm'], x['truth']), ok(p, x['truth'])
        for k in ((x['source'], 'all'), (x['source'], x['cut']), (x['source'], x.get('genre') or '?')):
            r = res[k]; r[0] += 1; r[1] += a; r[2] += c; r[3] += c and not a; r[4] += a and not c
    print(title)
    for k, (n, a, c, fx, br) in sorted(res.items(), key=lambda kv: (kv[0][0], kv[0][1] != 'all', -kv[1][0])):
        if n >= 10:
            print(f'  {k[0]:10s} {k[1][:18]:18s} n={n:4d} within 4%: {a / n:.3f} -> {c / n:.3f}  fixed {fx} broke {br}')


def score(model, f):
    s = model['baseline']
    for tree in model['trees']:
        n = 0
        while tree[n][0] >= 0:
            n = tree[n][2] if f[tree[n][0]] <= tree[n][1] else tree[n][3]
        s += tree[n][4]
    return 1 / (1 + math.exp(-s))


def correct(model, x):
    base = x['app']['bpm']
    if not max(x['tempogram']) > 0:
        return base
    return pick([(c, score(model, f)) for c, f in candidates(x['tempogram'], base)], base)


def train(d):
    import numpy as np
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.model_selection import GroupKFold
    rows = [x for x in load(f'{d}/tune.json.gz') if max(x['tempogram']) > 0]
    X, y, groups, clip, bpm = [], [], [], [], []
    for i, x in enumerate(rows):
        for c, f in candidates(x['tempogram'], x['app']['bpm']):
            X.append(f); y.append(int(ok(c, x['truth']))); groups.append(x['key']); clip.append(i); bpm.append(c)
    X, y = np.array(X), np.array(y)
    probs = np.zeros(len(y))
    for tr, te in GroupKFold(n_splits=5).split(X, y, groups):
        probs[te] = HistGradientBoostingClassifier(**PARAMS).fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
    by = collections.defaultdict(list)
    for r, i in enumerate(clip):
        by[i].append((bpm[r], probs[r]))
    report(rows, [pick(by[i], x['app']['bpm']) for i, x in enumerate(rows)], 'tune: 5-fold cross-validation grouped by track')
    model = HistGradientBoostingClassifier(**PARAMS).fit(X, y)
    trees = [[[-1, 0, 0, 0, float(n['value'])] if n['is_leaf'] else
              [int(n['feature_idx']), float(n['num_threshold']), int(n['left']), int(n['right']), 0] for n in p[0].nodes]
             for p in model._predictors]
    return {'about': 'Tempo metrical-level correction (gradient-boosted trees) from scripts/tempo/train.py. '
                     'Node: [feature, threshold, left, right, leafValue]; feature -1 is a leaf.',
            'margin': MARGIN, 'baseline': float(model._baseline_prediction.ravel()[0]), 'trees': trees}


if __name__ == '__main__':
    d = sys.argv[1]
    if '--write' in sys.argv:
        json.dump(train(d), open(MODEL, 'w'), separators=(',', ':'))
    if '--heldout' in sys.argv:
        model = json.load(open(MODEL))
        for name in ('gtzan-test', 'holdout'):
            rows = load(f'{d}/{name}.json.gz')
            report(rows, [correct(model, x) for x in rows], f'{name} (held out)')
