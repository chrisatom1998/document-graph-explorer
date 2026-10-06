"""Train the triplet-feel tempo check in src/audio/tempoTriplet.json, then score it once on held-out sets.

Usage: python3 scripts/tempo/train-triplet.py <features dir> [--write] [--heldout]
  <features dir> holds the .json.gz sets from .github/workflows/tempo-triplet-features.yml. Every row's `app` tempo
  already includes the half-time correction (src/audio/tempoCorrection.ts); this check runs after it.
  Tuning uses tune.json.gz (GiantSteps tempo tracks outside round 1, half of GTZAN) and mtg-tune.json.gz (GiantSteps
  MTG key tracks outside round 2, minus the half reserved for round 3) only.
  --write    fits on all tuning rows and writes src/audio/tempoTriplet.json plus a parity fixture for the unit test
  --heldout  scores the written model once on gtzan-test, holdout (round 1's 500 clips) and round2 (round 2's 500)
The check decides between three tempo families: the current tempo times a power of two, times 3/2 (two-thirds-time
errors) or times 4/3 (four-thirds-time errors). Beatport's BPM is often off by a factor of two, so family labels are
octave-free. Within a new family the half-time correction's own model picks the octave.
Feature code must stay identical to src/audio/tempoTriplet.ts.
"""
import collections, gzip, hashlib, json, math, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import importlib
T = importlib.import_module('train')

RATIOS = [1 / 4, 1 / 3, 3 / 8, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 2, 8 / 3, 3]
FAMILIES = {1: (3 / 2, 3 / 4), 2: (2 / 3, 4 / 3)}
MARGIN = 0.3
PARAMS = dict(max_depth=3, max_iter=150, learning_rate=0.05, l2_regularization=1.0, random_state=0)
MODEL, FIXTURE = 'src/audio/tempoTriplet.json', 'src/audio/tempoTriplet.fixture.json'
TUNE, HELD = ('tune', 'mtg-tune'), ('gtzan-test', 'holdout', 'round2')


def reserved(x):
    """Half of the unused MTG key tracks are held out for a later round 3 test: never tune on or inspect them."""
    return x['source'] == 'mtg' and x.get('cut') != 'mid10' and \
        int(hashlib.sha256(f"dge-holdout-r3-2026-10-06|{x['key']}".encode()).hexdigest()[:8], 16) % 2 == 0


def load(d, name):
    return [x for x in json.load(gzip.open(f'{d}/{name}.json.gz'))
            if x.get('app') and x.get('tempogram') and x.get('bands') and max(x['tempogram']) > 0 and not reserved(x)]


def family(bpm, truth):
    f = math.log2(truth / bpm) % 1
    for k, v in ((0, 0.0), (1, math.log2(1.5)), (2, math.log2(4 / 3))):
        if min(abs(f - v), 1 - abs(f - v)) < 0.06:
            return k
    return 3


def features(x, bpm):
    out = []
    for tg in (x['tempogram'], x['bands']['low'], x['bands']['high']):
        top = max(tg)
        top = top if top > 0 else 1
        out += [T.peak(tg, bpm * r) / top if 40 <= bpm * r <= 250 else 0.0 for r in RATIOS]
    return out + [math.log2(bpm / 120)]


def octave(level_model, x, bpm, k):
    """The half-time model's most likely tempo among family k's candidates within 60-200 BPM."""
    cands = [(c, f) for c, f in T.candidates(x['tempogram'], bpm) if any(abs(c / bpm - m) < 1e-9 for m in FAMILIES[k])]
    if not cands:
        return bpm
    return max(cands, key=lambda cf: T.score(level_model, cf[1]))[0]


def decide(probs, margin=MARGIN):
    k = 1 if probs[1] >= probs[2] else 2
    return k if probs[k] - probs[0] > margin else 0


def ok_any(e, t):
    return any(T.ok(e, t * m) for m in (0.5, 1, 2))


def report(rows, picks, title):
    res = collections.defaultdict(lambda: [0, 0, 0, 0, 0, 0, 0])
    for x, p in zip(rows, picks):
        b, t = x['app']['bpm'], x['truth']
        a, c, a2, c2 = T.ok(b, t), T.ok(p, t), ok_any(b, t), ok_any(p, t)
        for key in ((x['source'], 'all'), (x['source'], x.get('genre') or '?')):
            r = res[key]
            r[0] += 1; r[1] += a; r[2] += c; r[3] += c and not a; r[4] += a and not c; r[5] += a2; r[6] += c2
    print(title)
    for key, (n, a, c, fx, br, a2, c2) in sorted(res.items(), key=lambda kv: (kv[0][0], kv[0][1] != 'all', -kv[1][0])):
        if n >= 10:
            print(f'  {key[0]:10s} {key[1][:18]:18s} n={n:4d} within 4%: {a / n:.3f} -> {c / n:.3f}  fixed {fx} broke {br}'
                  f'  | allowing x2: {a2 / n:.3f} -> {c2 / n:.3f}')


def errors(rows, picks, title):
    def cls(e, t):
        for name, v in (('ok', 1), ('x2', 2), ('x1/2', .5), ('x2/3', 2 / 3), ('x3/2', 1.5), ('x4/3', 4 / 3), ('x3/4', .75)):
            if abs(e / t / v - 1) <= .04:
                return name
        return 'other'
    for src in sorted({x['source'] for x in rows}):
        b = collections.Counter(cls(x['app']['bpm'], x['truth']) for x in rows if x['source'] == src)
        a = collections.Counter(cls(p, x['truth']) for x, p in zip(rows, picks) if x['source'] == src)
        keys = ['ok', 'x2', 'x1/2', 'x2/3', 'x4/3', 'x3/4', 'x3/2', 'other']
        print(f'  {title} {src:10s} ' + '  '.join(f'{k} {b[k]}->{a[k]}' for k in keys))


def score(model, f):
    out = []
    for cls_trees, base in zip(model['trees'], model['baseline']):
        s = base
        for tree in cls_trees:
            n = 0
            while tree[n][0] >= 0:
                n = tree[n][2] if f[tree[n][0]] <= tree[n][1] else tree[n][3]
            s += tree[n][4]
        out.append(s)
    m = max(out)
    e = [math.exp(v - m) for v in out]
    return [v / sum(e) for v in e]


def correct(model, level_model, x):
    bpm = x['app']['bpm']
    k = decide(score(model, features(x, bpm)), model['margin'])
    return octave(level_model, x, bpm, k) if k else bpm


def export(clf):
    trees = [[[[-1, 0, 0, 0, float(n['value'])] if n['is_leaf'] else
               [int(n['feature_idx']), float(n['num_threshold']), int(n['left']), int(n['right']), 0] for n in p.nodes]
              for p in it] for it in zip(*clf._predictors)]
    return {'about': 'Tempo family check (triplet feel; gradient-boosted trees, softmax over stay / x3/2 / x4/3 / other) '
                     'from scripts/tempo/train-triplet.py. Node: [feature, threshold, left, right, leafValue]; feature -1 is a leaf.',
            'margin': MARGIN, 'baseline': [float(v) for v in clf._baseline_prediction.ravel()], 'trees': trees}


def train(d, level_model):
    import numpy as np
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.model_selection import GroupKFold
    rows = [x for s in TUNE for x in load(d, s)]
    X = np.array([features(x, x['app']['bpm']) for x in rows])
    y = np.array([family(x['app']['bpm'], x['truth']) for x in rows])
    print('tuning rows', len(rows), 'families', dict(collections.Counter((x['source'], int(v)) for x, v in zip(rows, y))))
    probs = np.zeros((len(y), 4))
    for tr, te in GroupKFold(n_splits=5).split(X, y, [x['key'] for x in rows]):
        clf = HistGradientBoostingClassifier(**PARAMS).fit(X[tr], y[tr])
        probs[np.ix_(te, clf.classes_)] = clf.predict_proba(X[te])
    for margin in (0.1, 0.2, 0.3, 0.4, 0.5):
        picks = [octave(level_model, x, x['app']['bpm'], k) if (k := decide(p, margin)) else x['app']['bpm'] for x, p in zip(rows, probs)]
        report(rows, picks, f'tuning, 5-fold cross-validation grouped by track, margin {margin}')
        if margin == MARGIN:
            errors(rows, picks, 'cv')
    clf = HistGradientBoostingClassifier(**PARAMS).fit(X, y)
    assert list(clf.classes_) == [0, 1, 2, 3]
    model = export(clf)
    # The exported trees must reproduce scikit-learn's probabilities.
    assert np.allclose([score(model, f) for f in X[:200]], clf.predict_proba(X[:200]), atol=1e-6)
    return model, rows


if __name__ == '__main__':
    d = sys.argv[1]
    level_model = json.load(open(T.MODEL))
    if '--write' in sys.argv:
        model, rows = train(d, level_model)
        json.dump(model, open(MODEL, 'w'), separators=(',', ':'))
        cases = []
        for x in rows:
            p = correct(model, level_model, x)
            if (abs(p - x['app']['bpm']) > 1 and len([c for c in cases if c['expected'] != c['bpm']]) < 8) or len(cases) < 6:
                cases.append({'id': x['id'], 'bpm': x['app']['bpm'], 'expected': round(p, 6), 'tempogram': x['tempogram'], 'bands': x['bands']})
            if len(cases) >= 14:
                break
        json.dump(cases, open(FIXTURE, 'w'), separators=(',', ':'))
    if '--heldout' in sys.argv:
        model = json.load(open(MODEL))
        for name in HELD:
            rows = load(d, name)
            picks = [correct(model, level_model, x) for x in rows]
            report(rows, picks, f'{name} (held out)')
            errors(rows, picks, name)
