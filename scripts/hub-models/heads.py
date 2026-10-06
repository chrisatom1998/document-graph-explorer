"""Do Demucs stems or MERT embeddings make better full-mix instrument heads? A same-pipeline A/B on stem_features.py output.

Usage: python3 scripts/hub-models/heads.py <features-dir> <train-labels.json> <report.json>

Every head is fitted, its C picked and its threshold set on OpenMIC train only, with scripts/full-mix-heads/train.py's own
rules (artist folds, balanced logistic regression, the deepest threshold whose out-of-fold precision at 25% prevalence is
at least 0.80). DJ clip rounds 1 and 2 are scored once with those frozen heads; nothing is chosen by looking at them.
Feature sets (CLAP embeddings L2-normalized, AST logits clipped to +-15 as in train.py):
  mix          CLAP + AST of the mix (the baseline: the shipped heads' inputs minus the Jamendo activations)
  mix+stems    mix plus CLAP + AST of the Demucs bass, other and vocals stems and each stem's level relative to the mix
  mix+low      mix plus CLAP + AST of a 150 Hz low-pass of the mix (a no-model stand-in for the bass stem)
  mix+mert     mix plus the MERT-v1-95M embedding (the layer chosen by mean out-of-fold AP on train)
"""
import glob, importlib.util, json, os, sys
import numpy as np
from joblib import Parallel, delayed
from sklearn.metrics import average_precision_score

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
spec = importlib.util.spec_from_file_location('fmh', os.path.join(ROOT, 'scripts', 'full-mix-heads', 'train.py'))
fmh = importlib.util.module_from_spec(spec); spec.loader.exec_module(fmh)
JUDGE = {'r1': 'docs/evaluations/dj-clips-2026-10-06/openmic-manifest.json', 'r2': 'docs/evaluations/dj-clips-round2-2026-10-06/openmic-manifest.json'}
CLASSES = ['drums', 'voice', 'synthesizer', 'piano', 'guitar', 'bass', 'cymbals', 'organ', 'violin', 'trumpet', 'saxophone']
REVIEW = {'drums': ['drums', 'drum kit', 'drum machine'], 'voice': ['voice'], 'synthesizer': ['synthesizer'], 'piano': ['piano', 'electric piano'],
          'guitar': ['guitar', 'acoustic guitar', 'electric guitar', 'steel guitar'], 'bass': ['bass guitar', 'bass', 'double bass'],
          'cymbals': ['cymbals'], 'organ': ['organ'], 'violin': ['violin', 'violin / fiddle'], 'trumpet': ['trumpet'], 'saxophone': ['saxophone']}
Cs = [0.01, 0.1]

def load(d):
    parts = [np.load(p) for p in sorted(glob.glob(os.path.join(d, '**', 'chunk-*.npz'), recursive=True))]
    keys = [k for k in parts[0].files if k != 'ids']
    return np.concatenate([p['ids'] for p in parts]), {k: np.concatenate([p[k] for p in parts]).astype(np.float32) for k in keys}

def sets(F, mert_layer):
    n = lambda x: x / np.maximum(np.linalg.norm(x, axis=1, keepdims=True), 1e-8)
    src = lambda s: [n(F[f'clap_{s}']), np.clip(F[f'ast_{s}'], -15, 15)]
    mix = src('mix')
    mert = F['mert_mix'][:, mert_layer] if mert_layer is not None else F['mert_mix'].mean(1)
    return {'mix': np.hstack(mix),
            'mix+stems': np.hstack(mix + src('bass') + src('other') + src('vocals') + [np.log(F['energy'] + 1e-4)]),
            'mix+low': np.hstack(mix + src('low')),
            'mix+mert': np.hstack(mix + [n(mert)])}

def oof_fit(X, y, folds):
    best = None
    for C in Cs:
        oof = np.zeros(len(y))
        for f in range(fmh.FOLDS):
            tr, te = folds != f, folds == f
            oof[te] = fmh.predict(fmh.fit(X[tr], y[tr], C), X[te])
        ap = average_precision_score(y, oof)
        if best is None or ap > best[0]: best = (ap, C, oof)
    return best

def main():
    fdir, labels_path, out = sys.argv[1:4]
    ids, F = load(fdir)
    items = {i['id']: i for i in json.load(open(labels_path))['items']}
    tr_rows = np.array([k for k, i in enumerate(ids) if i.startswith('train:') and i[6:] in items])
    print(f'{len(ids)} clips with features, {len(tr_rows)} train', flush=True)
    folds_all = np.array([fmh.fold_of(items[i[6:]]['artist']) if i.startswith('train:') and i[6:] in items else -1 for i in ids])
    report = {'trainClips': int(len(tr_rows)), 'sets': {}}

    rows_of = lambda c: np.array([k for k in tr_rows if c in items[ids[k][6:]]['labels']])
    y_of = lambda c: np.array([items[ids[k][6:]]['labels'][c] >= .5 for k in rows_of(c)], dtype=int)

    # MERT layer: picked on train only, by mean out-of-fold AP of a MERT-only head over the 11 classes.
    layer_ap = {}
    for layer in range(F['mert_mix'].shape[1]):
        X = F['mert_mix'][:, layer]
        aps = Parallel(n_jobs=-1)(delayed(lambda c: oof_fit(X[rows_of(c)], y_of(c), folds_all[rows_of(c)])[0])(c) for c in CLASSES)
        layer_ap[layer] = float(np.mean(aps)); print(f'MERT layer {layer}: mean OOF AP {layer_ap[layer]:.4f}', flush=True)
    layer = max(layer_ap, key=layer_ap.get); report['mertLayer'] = {'chosen': layer, 'meanOofAp': layer_ap}

    judge = {}
    for name, path in JUDGE.items():
        for it in json.load(open(os.path.join(ROOT, path)))['items']:
            judge[f'{name}:{it["id"]}'] = it
    for sname, X in sets(F, layer).items():
        report['sets'][sname] = {}
        fits = dict(zip(CLASSES, Parallel(n_jobs=-1)(delayed(oof_fit)(X[rows_of(c)], y_of(c), folds_all[rows_of(c)]) for c in CLASSES)))
        for c in CLASSES:
            rows, y = rows_of(c), y_of(c)
            ap, C, oof = fits[c]
            t = fmh.pick_threshold(y, oof)
            model = fmh.fit(X[rows], y, C)
            res = {'oofAp': round(ap, 4), 'C': C, 'threshold': t}
            for name in ([] if os.environ.get('NO_JUDGE') else JUDGE):   # NO_JUDGE=1: train-side numbers only
                jr = [k for k, i in enumerate(ids) if i.startswith(name + ':')]
                p = fmh.predict(model, X[jr]) if jr else np.zeros(0)
                tp = fp = fn = 0
                for k, prob in zip(jr, p):
                    hit = t is not None and prob >= t
                    for r in judge[ids[k]]['reviews']:
                        if r['label'] not in REVIEW[c]: continue
                        if r['state'] == 'present': tp += hit; fn += not hit
                        else: fp += hit
                        break
                res[name] = {'P': round(tp / (tp + fp), 3) if tp + fp else None, 'R': round(tp / (tp + fn), 3) if tp + fn else None,
                             'pos': tp + fn, 'tp': tp, 'fp': fp, 'fn': fn}
            report['sets'][sname][c] = res
            if 'r1' not in res: print(f"{sname:10s} {c:12s} OOF AP {ap:.3f}", flush=True); report['sets'][sname][c] = res; continue
            print(f"{sname:10s} {c:12s} OOF AP {ap:.3f}  r1 P/R {res['r1']['P']}/{res['r1']['R']} (n+ {res['r1']['pos']})  "
                  f"r2 P/R {res['r2']['P']}/{res['r2']['R']} (n+ {res['r2']['pos']})", flush=True)
        report['sets'][sname]['_meanOofAp'] = round(float(np.mean([v['oofAp'] for v in report['sets'][sname].values()])), 4)
        print(f"{sname}: mean OOF AP {report['sets'][sname]['_meanOofAp']}", flush=True)
    json.dump(report, open(out, 'w'), indent=1, default=lambda o: o.item() if hasattr(o, 'item') else str(o))

if __name__ == '__main__':
    main()
