"""Character heads (distorted, reverberant, echoing, filtered) from the Freesound character folders.

Positives: clips in that folder. Negatives: the Freesound sound-type folders (after cleanup).
The other character folders are left out of each head: a reverberant clip may also be echoing.
Tested on whole Freesound uploaders the head never trained on. The guitar/bass effect sets
(IDMT, EGFxSet) are added to training only if they raise the training-side score by uploader.
Usage: train-character-heads.py <out.json>"""
import json, sys, glob, hashlib, os, datetime
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold

B = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints'
INDEX = '/Users/chrisjohnson/Documents/Media/dj-training-sounds/index.json'
CHARACTER = ['distorted', 'reverberant', 'echoing', 'filtered']
BAR = 0.65
rng = np.random.default_rng(417)

def embeddings(folder, want):
    got = {}
    for f in sorted(glob.glob(f'{folder}/emb-*.jsonl')):
        for line in open(f):
            r = json.loads(line)
            if r['id'] in want and r['id'] not in got: got[r['id']] = r['embedding']
    return got

clean = {c['id'] for c in json.load(open(f'{B}/extras/freesound-clean.json'))['clips']}
items = []
for it in json.load(open(INDEX))['items']:
    i = f"fs:{os.path.basename(os.path.dirname(it['file']))}:{it['id']}"
    if it['label'] in CHARACTER or i in clean: items.append((i, it['label'], it['username']))
emb = embeddings(f'{B}/freesound-clap', {i for i, _, _ in items})
items = [x for x in items if x[0] in emb]
FX = np.asarray([emb[i] for i, _, _ in items], dtype=np.float64); FX /= np.linalg.norm(FX, axis=1, keepdims=True)
FL = np.array([l for _, l, _ in items]); FG = np.array([g for _, _, g in items])

man = json.load(open(f'{B}/effects-clap/manifest.json'))['clips']
eemb = embeddings(f'{B}/effects-clap', {c['id'] for c in man})
man = [c for c in man if c['id'] in eemb]
EX = np.asarray([eemb[c['id']] for c in man], dtype=np.float64); EX /= np.linalg.norm(EX, axis=1, keepdims=True)
EL = np.array([c['label'] for c in man]); EG = np.array(['fx:' + c['group'] for c in man])
print(f'freesound {len(items)} clips, effect sets {len(man)} clips')

def held_out(name, groups, pos):
    counts = {}
    for g in groups[pos]: counts[g] = counts.get(g, 0) + 1
    order = sorted(counts, key=lambda g: hashlib.sha256(f'{name}|{g}'.encode()).hexdigest())
    chosen, n, total = set(), 0, sum(counts.values())
    for g in order:
        if len(chosen) >= len(order) - 3 or n >= 0.25 * total: break
        if n + counts[g] > 0.5 * total: continue
        chosen.add(g); n += counts[g]
    return chosen
fit = lambda X, y: LogisticRegression(C=1.0, class_weight='balanced', max_iter=800, tol=1e-3).fit(X, y)
def threshold(t, p):
    best = None
    for th in np.unique(np.round(p, 3)):
        if th < 0.5: continue
        pr = p >= th; tp = (pr & t).sum()
        if not tp: continue
        s = min(tp / pr.sum(), tp / t.sum())
        if best is None or s > best[0]: best = (s, float(th))
    return best
def f1(t, p, th):
    pr = p >= th; tp = (pr & t).sum(); return 2 * tp / (pr.sum() + t.sum()) if tp else 0.0

results = []
for L in CHARACTER:
    use = (FL == L) | ~np.isin(FL, CHARACTER); X, y, g = FX[use], FL[use] == L, FG[use]
    # Negatives' uploaders are held out too, so test negatives come from people it never heard either.
    test = np.isin(g, sorted(held_out(f'character:{L}', g, y))); tr = ~test
    # Effect-set rows: positives with this effect, negatives dry or other effects; capped so they don't swamp Freesound.
    ep = np.where(EL == L)[0]; en = np.where((EL != L) & ~np.isin(EL, CHARACTER))[0]
    ep = rng.choice(ep, min(len(ep), 1500), replace=False) if len(ep) else ep; en = rng.choice(en, min(len(en), 1500), replace=False)
    ext = np.concatenate([ep, en]).astype(int)
    def oof(with_fx):
        Xa, ya, ga = X[tr], y[tr], g[tr]; p = np.full(len(ya), np.nan)
        for a, b in GroupKFold(n_splits=5).split(Xa, ya, ga):
            Xt, yt = Xa[a], ya[a]
            if with_fx and len(ext): Xt, yt = np.vstack([Xt, EX[ext]]), np.concatenate([yt, EL[ext] == L])
            p[b] = fit(Xt, yt).predict_proba(Xa[b])[:, 1]
        return p
    choices = {}
    for with_fx in ([False, True] if len(ep) else [False]):
        p = oof(with_fx); best = threshold(y[tr], p)
        if best: choices[with_fx] = (f1(y[tr], p, best[1]), best[1])
    if not choices: results.append({'label': L, 'verdict': 'no usable threshold'}); continue
    with_fx = max(choices, key=lambda k: choices[k][0] + (0 if k else 0.005)); th = choices[with_fx][1]
    Xt, yt = X[tr], y[tr]
    if with_fx: Xt, yt = np.vstack([Xt, EX[ext]]), np.concatenate([yt, EL[ext] == L])
    pr = fit(Xt, yt).predict_proba(X[test])[:, 1] >= th; t = y[test]
    tp, fp, fn = int((pr & t).sum()), int((pr & ~t).sum()), int((~pr & t).sum())
    P = tp / (tp + fp) if tp + fp else 0.0; R = tp / (tp + fn) if tp + fn else 0.0
    r = {'label': L, 'usesEffectSets': bool(with_fx), 'threshold': th, 'trainPositive': int(y[tr].sum()), 'testPositive': int(t.sum()),
         'testNegative': int((~t).sum()), 'heldOutUploaders': int(len(set(g[test]))), 'tp': tp, 'fp': fp, 'fn': fn, 'precision': P, 'recall': R,
         'passes': bool(P >= BAR and R >= BAR)}
    if min(P, R) >= 0.5:
        Xa, ya = X, y
        if with_fx: Xa, ya = np.vstack([X, EX[ext]]), np.concatenate([y, EL[ext] == L])
        m = fit(Xa, ya); r['head'] = {'weights': [round(float(w), 6) for w in m.coef_[0]], 'bias': round(float(m.intercept_[0]), 6)}
    results.append(r)
    print(f"{L:<12} test+{r['testPositive']:>3}  precision {P:.0%}  recall {R:.0%}  {'PASS' if r['passes'] else 'fails'}  effect sets: {'yes' if with_fx else 'no'}")
json.dump({'kind': 'character-heads-v1', 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'bar': BAR, 'results': results}, open(sys.argv[1], 'w'), indent=1)
