"""Train and cross-check the full-mix instrument heads on OpenMIC-2018 train features.

Usage: python3 scripts/full-mix-heads/train.py <features-dir> <openmic-train-labels.json> <report.json> [model.json]

<features-dir> holds fm-*.f32 / fm-*.jsonl from scripts/full-mix-heads/features.mjs. One logistic head per OpenMIC class,
fitted only on that class's observed labels (relevance >= 0.5 present, lower absent, missing pairs unknown, never
negative). Folds are split by FMA artist, so no artist is in both the fitting and the checking part of a fold.

Report: for every feature set and class, out-of-fold average precision, and the out-of-fold precision/recall at the
threshold picked (the lowest probability whose out-of-fold precision is at least TARGET_PRECISION, by artist folds).
With a model path, the chosen feature set is refitted on all rows and written with its thresholds.
"""
import glob, hashlib, json, os, sys
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score

BLOCKS = [('clap', 512), ('ast', 527), ('jamendo', 40), ('effnet', 1280)]
FOLDS, SEED, TARGET_PRECISION = 5, 'dge-full-mix-heads-2026-10-06', 0.75
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')

def load(features_dir):
    metas, mats = [], []
    for meta_path in sorted(glob.glob(os.path.join(features_dir, '**', 'fm-*.jsonl'), recursive=True)):
        rows = [json.loads(l) for l in open(meta_path) if l.strip()]
        mat = np.fromfile(meta_path[:-6] + '.f32', dtype='<f4').reshape(len(rows), -1)
        metas += rows; mats.append(mat)
    X = np.concatenate(mats)
    out, o = {}, 0
    for name, n in BLOCKS: out[name] = X[:, o:o + n]; o += n
    assert o == X.shape[1], (o, X.shape)
    return metas, out

def ast_mapped(logits):
    """The app's own AST instrument scores (src/audio/instrumentLabels instrumentScores): max sigmoid per mapped label."""
    import re
    config = json.load(open(os.path.join(ROOT, 'public', 'music-model', 'config.json')))
    src = open(os.path.join(ROOT, 'src', 'audio', 'instrumentLabels.ts')).read()
    table = src[src.index('const LABELS'):src.index('};', src.index('const LABELS'))]
    mapping = dict(re.findall(r'"([^"]+)":\s*"([^"]+)"', table))
    labels = sorted(set(mapping.values()))
    out = np.zeros((logits.shape[0], len(labels)), dtype=np.float32)
    sig = 1 / (1 + np.exp(-logits))
    for i, name in config['id2label'].items():
        if name in mapping: j = labels.index(mapping[name]); out[:, j] = np.maximum(out[:, j], sig[:, int(i)])
    return labels, out

def logit(p): p = np.clip(p, 1e-6, 1 - 1e-6); return np.log(p / (1 - p))

def feature_sets(b):
    clap = b['clap'] / np.maximum(np.linalg.norm(b['clap'], axis=1, keepdims=True), 1e-8)
    names, mapped = ast_mapped(b['ast'])
    jam = logit(b['jamendo'])
    return {
        'clap': clap,
        'clap+astmap+jam': np.hstack([clap, logit(mapped), jam]),
        'clap+ast+jam': np.hstack([clap, np.clip(b['ast'], -15, 15), jam]),
        'clap+ast+jam+effnet': np.hstack([clap, np.clip(b['ast'], -15, 15), jam, b['effnet']]),
        'effnet+jam': np.hstack([b['effnet'], jam]),
    }, names

def fold_of(artist): return int(hashlib.sha256(f'{SEED}|{artist}'.encode()).hexdigest(), 16) % FOLDS

def pick_threshold(y, p, target=TARGET_PRECISION):
    order = np.argsort(-p); ys = y[order]; ps = p[order]
    tp = np.cumsum(ys); prec = tp / np.arange(1, len(ys) + 1)
    ok = np.where(prec >= target)[0]
    if not len(ok): return None
    k = ok[-1]  # deepest cut that still meets the target
    return float(ps[k])

def pr_at(y, p, t):
    if t is None: return None, 0.0
    hit = p >= t; tp = int((hit & (y == 1)).sum()); fp = int((hit & (y == 0)).sum())
    return (tp / (tp + fp) if tp + fp else None), tp / max(1, int(y.sum()))

def standardize(X):
    mu = X.mean(0); sd = X.std(0) + 1e-6
    return mu, sd

def fit(X, y, C):
    mu, sd = standardize(X)
    clf = LogisticRegression(C=C, max_iter=2000, class_weight='balanced')
    clf.fit((X - mu) / sd, y)
    return clf, mu, sd

def predict(model, X):
    clf, mu, sd = model
    return clf.predict_proba((X - mu) / sd)[:, 1]

def main():
    features_dir, labels_path, report_path = sys.argv[1:4]
    model_path = sys.argv[4] if len(sys.argv) > 4 else None
    metas, blocks = load(features_dir)
    items = {i['id']: i for i in json.load(open(labels_path))['items']}
    keep = [k for k, m in enumerate(metas) if m['id'] in items]
    metas = [metas[k] for k in keep]; blocks = {n: v[keep] for n, v in blocks.items()}
    sets, astnames = feature_sets(blocks)
    classes = sorted({c for i in items.values() for c in i['labels']})
    folds = np.array([fold_of(items[m['id']]['artist']) for m in metas])
    only = os.environ.get('SETS', '').split(',') if os.environ.get('SETS') else list(sets)
    Cs = [float(c) for c in os.environ.get('CS', '0.01,0.1').split(',')]
    report = {'rows': len(metas), 'targetPrecision': TARGET_PRECISION, 'folds': FOLDS, 'sets': {}}
    for sname in only:
        X = sets[sname]; report['sets'][sname] = {}
        for c in classes:
            rows = np.array([k for k, m in enumerate(metas) if c in items[m['id']]['labels']])
            y = np.array([items[metas[k]['id']]['labels'][c] >= .5 for k in rows], dtype=int)
            best = None
            for C in Cs:
                oof = np.zeros(len(rows))
                for f in range(FOLDS):
                    tr, te = folds[rows] != f, folds[rows] == f
                    oof[te] = predict(fit(X[rows[tr]], y[tr], C), X[rows[te]])
                ap = average_precision_score(y, oof)
                if best is None or ap > best['ap']: best = {'ap': ap, 'C': C, 'oof': oof}
            t = pick_threshold(y, best['oof']); p, r = pr_at(y, best['oof'], t)
            report['sets'][sname][c] = {'positives': int(y.sum()), 'negatives': int(len(y) - y.sum()), 'C': best['C'],
                'ap': round(best['ap'], 4), 'threshold': None if t is None else round(t, 4),
                'precision': None if p is None else round(p, 3), 'recall': round(r, 3)}
            print(f"{sname:22s} {c:18s} AP {best['ap']:.3f} C {best['C']:<5} P {p if p is None else round(p,3)} R {r:.3f} (+{int(y.sum())}/-{int(len(y)-y.sum())})", flush=True)
        aps = [v['ap'] for v in report['sets'][sname].values()]
        report['sets'][sname]['_meanAP'] = round(float(np.mean(aps)), 4)
        print(f'{sname}: mean AP {np.mean(aps):.4f}', flush=True)
    json.dump(report, open(report_path, 'w'), indent=1)
    if model_path: export(model_path, metas, items, blocks, classes, report)

EXPORT_SET = 'clap+astmap+jam'   # the inputs the app already has per window, with no worker change
def export(model_path, metas, items, blocks, classes, report):
    """Refit EXPORT_SET on every observed row of each shipped class; standardization is folded into the weights."""
    sets, astnames = feature_sets(blocks)
    X = sets[EXPORT_SET]
    jam_classes = json.load(open(os.path.join(ROOT, 'public', 'jamendo-model', 'mtg_jamendo_instrument-discogs-effnet-1.json')))['classes']
    ship = [c for c in os.environ.get('SHIP', ','.join(classes)).split(',') if c]
    heads = []
    for c in ship:
        r = report['sets'][EXPORT_SET][c]
        if r['threshold'] is None: continue
        rows = np.array([k for k, m in enumerate(metas) if c in items[m['id']]['labels']])
        y = np.array([items[metas[k]['id']]['labels'][c] >= .5 for k in rows], dtype=int)
        clf, mu, sd = fit(X[rows], y, r['C'])
        w = clf.coef_[0] / sd; b = float(clf.intercept_[0] - (clf.coef_[0] * mu / sd).sum())
        heads.append({'label': c, 'weights': [float(f'{v:.5g}') for v in w], 'bias': float(f'{b:.6g}'), 'threshold': r['threshold'],
                      'checked': {k: r[k] for k in ('positives', 'negatives', 'ap', 'precision', 'recall')}})
    model = {'version': 1, 'revision': os.environ.get('REVISION', 'openmic-train-2026-10-06'),
             'source': 'OpenMIC-2018 split01_train, benchmark artists removed; logistic heads (scripts/full-mix-heads/train.py)',
             'inputs': {'clap': 512, 'ast': astnames, 'jamendo': jam_classes},
             'aggregation': {'top': int(os.environ.get('TOP', '2'))}, 'heads': heads}
    json.dump(model, open(model_path, 'w'), separators=(',', ':'))
    print(f'wrote {len(heads)} heads to {model_path}')

if __name__ == '__main__':
    main()
