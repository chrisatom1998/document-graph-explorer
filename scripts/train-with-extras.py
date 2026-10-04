"""One round of "add a dataset, keep it only if it helps".

The yardstick never changes: for each sound, a fixed set of sample-pack brands from the
user's library is held out (same choice every round) and the head is scored only on them.
Extra datasets are added to TRAINING ONLY, so any gain is a gain on unseen brands.
Sounds the library cannot test (too few held-out examples) are scored on held-out groups
of the extra data instead, and reported separately as new coverage.

Usage: train-with-extras.py <out.json> [name=manifest.json@fingerprint_dir ...]
Every manifest clip needs: id, labels (app label names), group (independence unit)."""
import json, sys, glob, hashlib, os, datetime
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from joblib import Parallel, delayed
import importlib.util
_spec = importlib.util.spec_from_file_location('labeler', 'scripts/label-sample-library.py')
labeler = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(labeler)

FP = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints'
OUT = sys.argv[1]; EXTRAS = [a.split('=', 1) for a in sys.argv[2:]]
BAR, MIN_TEST = 0.65, 15
catalog = {c['label']: c for c in json.load(open('src/audio/djCatalog.json'))['categories']}
FAMILY = {'drum-hit': 'drum hit', 'drum-pattern': 'drum loop', 'vocal': 'vocal', 'editing': 'vocal', 'breath': 'vocal',
          'transition': 'fx', 'bass': 'bass', 'synth': 'synth', 'texture': 'texture'}

def load(manifest, folder, source):
    meta = {c['id']: c for c in json.load(open(manifest))['clips']}; got = {}
    for f in sorted(glob.glob(f'{folder}/emb-*.jsonl')):
        for line in open(f):
            r = json.loads(line)
            if r['id'] in meta and r['id'] not in got: got[r['id']] = r['embedding']
    rows = [meta[i] for i in got]
    X = np.asarray([got[r['id']] for r in rows], dtype=np.float32); X /= np.linalg.norm(X, axis=1, keepdims=True)
    labels = [set(r.get('labels') or [r['label']]) for r in rows]
    if source == 'vault':   # re-check library labels so song titles no longer count as sounds
        labels = [l & set(labeler.match(r['id'][len('vault:'):])) for l, r in zip(labels, rows)]
    groups = np.array([f"{source}:{r.get('vendor') or r.get('group')}" for r in rows])
    return X, labels, groups

VX, VL, VG = load(f'{FP}/vault-clap/manifest.json', f'{FP}/vault-clap', 'vault')
parts = [(VX, VL, VG, np.ones(len(VL), bool))]
for name, spec in EXTRAS:
    man, folder = spec.split('@'); X, L, G = load(man, folder, name)
    parts.append((X, L, G, np.zeros(len(L), bool))); print(f'+ {name}: {len(L)} clips')
SRC = np.concatenate([np.full(len(p[1]), i) for i, p in enumerate(parts)])   # 0 = library, 1.. = extras in order
X = np.vstack([p[0] for p in parts]); LAB = sum((p[1] for p in parts), []); G = np.concatenate([p[2] for p in parts])
IS_VAULT = np.concatenate([p[3] for p in parts])
FAM = np.array([(lambda f: f.pop() if len(f) == 1 else None)({FAMILY.get(catalog.get(l, {}).get('family')) for l in s} - {None}) for s in LAB], dtype=object)
print(f'total {len(LAB)} clips ({IS_VAULT.sum()} library, {(~IS_VAULT).sum()} extra)')

OVERLAP = [{'chops', 'vocal chops'}, {'riser', 'noise sweep', 'whoosh'}, {'impact', 'sub drop', 'downlifter'},
           {'808 bass', 'sub bass'}, {'reese bass', 'wobble bass', 'bass growl', 'synth bass'}, {'synth chord', 'atmospheric pad', 'synth stab'},
           {'synth lead', 'synth arpeggio', 'synth pluck', 'synth chord', 'synth stab'},
           {'texture', 'atmospheric pad', 'static noise', 'rain ambience', 'noise sweep'}, {'static noise', 'noise sweep'},
           {'glitch effect', 'stutter effect', 'reverse effect'}, {'crash cymbal', 'ride cymbal', 'closed hi-hat', 'open hi-hat'}]
def compatible(a, b):
    if a == b: return True
    fa, fb = catalog.get(a, {}).get('family'), catalog.get(b, {}).get('family')
    if {fa, fb} <= {'drum-hit', 'drum-pattern'} and 'drum-pattern' in {fa, fb}: return True
    if 'percussion hit' in {a, b} and {fa, fb} == {'drum-hit'}: return True
    if {fa, fb} <= {'vocal', 'editing'} and 'vocal' in {fa, fb}: return True
    return any(a in s and b in s for s in OVERLAP)

def held_out(name, groups, pos):
    """Same deterministic choice every round: about a quarter of positives, by whole group."""
    counts = {}
    for g in groups[pos]: counts[g] = counts.get(g, 0) + 1
    order = sorted(counts, key=lambda g: hashlib.sha256(f'{name}|{g}'.encode()).hexdigest())
    chosen, n, total = set(), 0, sum(counts.values())
    for g in order:
        if len(chosen) >= len(order) - 3 or n >= 0.25 * total: break
        if n + counts[g] > 0.5 * total: continue
        chosen.add(g); n += counts[g]
    return chosen

# EXPORT=0.5 also refits and saves weights for results at or above that bar; ONLY=kind:name,... limits the run.
EXPORT = float(os.environ['EXPORT']) if os.environ.get('EXPORT') else None
ONLY = set(filter(None, os.environ.get('ONLY', '').split(',')))
fit = lambda A, y: LogisticRegression(C=1.0, class_weight='balanced', max_iter=600, tol=1e-3).fit(A, y)
def threshold(t, p):
    best = None
    for th in np.unique(np.round(p, 3)):
        if th < 0.5: continue
        pr = p >= th; tp = (pr & t).sum()
        if not tp: continue
        s = min(tp / pr.sum(), tp / t.sum())
        if best is None or s > best[0]: best = (s, float(th))
    return best[1] if best else None

def run(kind, name):
    if kind == 'family':
        use = FAM != None; pos = FAM == name                                      # noqa: E711
    else:
        pos = np.array([name in s for s in LAB]); use = pos | np.array([not any(compatible(name, o) for o in s) for s in LAB])
    # Prefer the fixed library yardstick; fall back to held-out extra groups for new coverage.
    library_test = held_out(f'{kind}:{name}', G[IS_VAULT & use], pos[IS_VAULT & use])
    test = use & IS_VAULT & np.isin(G, sorted(library_test)); where = 'library brands'
    if pos[test].sum() < MIN_TEST:
        extra_test = held_out(f'{kind}:{name}:extra', G[~IS_VAULT & use], pos[~IS_VAULT & use])
        test = use & ~IS_VAULT & np.isin(G, sorted(extra_test)); where = 'extra sources'
    train = use & ~test & (IS_VAULT | (pos | ~IS_VAULT))
    r = {'kind': kind, 'name': name, 'testedOn': where, 'trainPositive': int(pos[train].sum()), 'testPositive': int(pos[test].sum())}
    if pos[test].sum() < MIN_TEST or pos[train].sum() < 30 or len(set(G[train & pos])) < 3: return {**r, 'verdict': 'not enough data'}
    def oof_for(rows):
        oof = np.full(len(rows), np.nan)
        for x, y in GroupKFold(n_splits=5).split(X[rows], pos[rows], G[rows]):
            if pos[rows][x].any() and (~pos[rows][x]).any(): oof[y] = fit(X[rows][x], pos[rows][x]).predict_proba(X[rows][y])[:, 1]
        return oof
    # Each sound picks the extra datasets that help IT, judged only on its training-side library
    # brands (5-fold, by brand). The held-out test brands play no part in the choice.
    chosen = [i for i in range(1, len(parts)) if pos[train & (SRC == i)].any()]
    if os.environ.get('SELECT') == '1' and where == 'library brands' and chosen:
        lib = np.where(train & IS_VAULT)[0]
        def score(subset):
            ext = np.where(train & np.isin(SRC, subset))[0]
            rows = np.concatenate([lib, ext]); oof = oof_for(rows)[:len(lib)]; ok = ~np.isnan(oof)
            th = threshold(pos[lib][ok], oof[ok]);
            if th is None: return -1.0
            pr = oof[ok] >= th; t = pos[lib][ok]; tp = (pr & t).sum()
            return 2 * tp / (pr.sum() + t.sum()) if tp else 0.0
        cur, best = [], score([])
        for i in chosen:                                 # greedy: keep a dataset only if it helps this sound
            v = score(cur + [i])
            if v > best + 0.005: cur, best = cur + [i], v
        chosen = cur
    a = np.where(train & (IS_VAULT | np.isin(SRC, chosen)))[0]; oof = oof_for(a); ok = ~np.isnan(oof)
    th = threshold(pos[a][ok], oof[ok])
    if th is None: return {**r, 'verdict': 'no usable threshold'}
    b = np.where(test)[0]; pr = fit(X[a], pos[a]).predict_proba(X[b])[:, 1] >= th; t = pos[b]
    tp, fp, fn = int((pr & t).sum()), int((pr & ~t).sum()), int((~pr & t).sum())
    P = tp / (tp + fp) if tp + fp else 0.0; R = tp / (tp + fn)
    if EXPORT is not None and min(P, R) >= EXPORT:      # refit on every row it may use, same threshold
        m = fit(X[np.where(use & (IS_VAULT | np.isin(SRC, chosen)))[0]], pos[np.where(use & (IS_VAULT | np.isin(SRC, chosen)))[0]])
        r['head'] = {'weights': [round(float(w), 6) for w in m.coef_[0]], 'bias': round(float(m.intercept_[0]), 6)}
    return {**r, 'uses': [EXTRAS[i - 1][0] for i in chosen], 'threshold': th, 'tp': tp, 'fp': fp, 'fn': fn, 'precision': P, 'recall': R,
            'f1': 2*P*R/(P+R) if P+R else 0.0, 'passes': bool(P >= BAR and R >= BAR), 'verdict': 'PASS' if P >= BAR and R >= BAR else 'fails'}

prod = sorted({l for s in LAB for l in s if catalog.get(l, {}).get('group') == 'production'})
jobs = [('family', f) for f in sorted(set(FAMILY.values()))] + [('label', l) for l in prod]
if ONLY: jobs = [j for j in jobs if f'{j[0]}:{j[1]}' in ONLY]
res = Parallel(n_jobs=int(os.environ.get('JOBS', '12')))(delayed(run)(k, n) for k, n in jobs)
json.dump({'kind': 'extras-round-v1', 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'bar': BAR,
           'extras': [n for n, _ in EXTRAS], 'results': res}, open(OUT, 'w'), indent=1)
ok = [r for r in res if 'precision' in r]
print(f"passing {BAR:.0%}: {sum(r['passes'] for r in ok)} of {len(ok)} testable   (families {sum(r['passes'] for r in ok if r['kind']=='family')}, sounds {sum(r['passes'] for r in ok if r['kind']=='label')})   mean F1 {np.mean([r['f1'] for r in ok]):.3f}")
