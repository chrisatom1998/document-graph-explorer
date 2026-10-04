"""Builds public/sound-model/learned.json: the trained heads the app loads beside CLAP.

A head ships only if it clears the bar (default 65% precision AND 65% recall) on groups it
never trained on - whole sample-pack brands for DJ sounds, whole source notes for effects.
A head that clears it is then refitted on all of its data with the same threshold.
No examples are written: dataset labels are not user reviews.
Usage: build-learned-heads.py <vault manifest> <vault fingerprints> <fx manifest> <fx fingerprints> <report.json>"""
import json, sys, glob, hashlib, datetime, os
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from joblib import Parallel, delayed

VM, VE, FM, FE, REPORT = sys.argv[1:6]
BAR = float(os.environ.get('BAR', '0.65'))
ENCODER = 'Xenova/larger_clap_music_and_speech@e9fd5ac1dbf3280936a7fc3ec8a020453ff184db'
catalog = {c['label']: c for c in json.load(open('src/audio/djCatalog.json'))['categories']}

def load(manifest, folder):
    meta = {c['id']: c for c in json.load(open(manifest))['clips']}; got = {}
    for f in sorted(glob.glob(f'{folder}/emb-*.jsonl')):
        for line in open(f):
            r = json.loads(line)
            if r['id'] in meta and r['id'] not in got: got[r['id']] = r['embedding']
    ids = list(got); X = np.asarray([got[i] for i in ids], dtype=np.float64)
    return [meta[i] for i in ids], X / np.linalg.norm(X, axis=1, keepdims=True)

vmeta, VX = load(VM, VE); fmeta, FX = load(FM, FE)
vbrand = np.array([m['vendor'] for m in vmeta]); vlabels = [set(m.get('labels') or [m['label']]) for m in vmeta]
FAMILY = {'drum-hit': 'drum hit', 'drum-pattern': 'drum loop', 'vocal': 'vocal', 'editing': 'vocal', 'breath': 'vocal',
          'transition': 'fx', 'bass': 'bass', 'synth': 'synth', 'texture': 'texture'}
vfam = []
for s in vlabels:
    f = {FAMILY.get(catalog.get(l, {}).get('family')) for l in s} - {None}
    vfam.append(f.pop() if len(f) == 1 else None)      # files whose labels disagree on a family teach no family
vfam = np.array(vfam, dtype=object)
fgroup = np.array([m['group'] for m in fmeta]); flabel = np.array([m['label'] for m in fmeta])

OVERLAP = [{'chops', 'vocal chops'}]
def compatible(a, b):
    if a == b: return True
    fa, fb = catalog.get(a, {}).get('family'), catalog.get(b, {}).get('family')
    if {fa, fb} <= {'drum-hit', 'drum-pattern'} and 'drum-pattern' in {fa, fb}: return True
    if {fa, fb} <= {'vocal', 'editing'} and 'vocal' in {fa, fb}: return True
    return any(a in s and b in s for s in OVERLAP)

# (app group, app label, kind, source label) - every candidate measured in the first training round.
CANDIDATES = [
    ('production', 'percussion hit', 'family', 'drum hit'), ('production', 'drum loop', 'family', 'drum loop'),
    ('source', 'voice', 'family', 'vocal'), ('source', 'sound effect', 'family', 'fx'),
    *[('production', l, 'label', l) for l in ['kick', 'top loop', 'hi-hat loop', 'percussion loop', 'vocal ad-lib', 'vocal chops', 'vocal chant', 'choir']],
    ('character', 'distorted', 'effect', 'distorted'), ('character', 'reverberant', 'effect', 'reverberant'),
    ('character', 'echoing', 'effect', 'echoing'), ('character', 'flanged', 'effect', 'flanger'),
]

def dataset(kind, src):
    if kind == 'family':
        use = vfam != None; return VX[use], (vfam[use] == src), vbrand[use]   # noqa: E711
    if kind == 'label':
        pos = np.array([src in s for s in vlabels]); neg = np.array([not any(compatible(src, o) for o in s) for s in vlabels])
        use = pos | neg; return VX[use], pos[use], vbrand[use]
    return FX, flabel == src, fgroup

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

fit = lambda X, y: LogisticRegression(C=1.0, class_weight='balanced', max_iter=600, tol=1e-3).fit(X, y)
def balance_threshold(t, p):
    best = None
    for th in np.unique(np.round(p, 3)):
        if th < 0.5: continue                      # the app refuses thresholds below 0.5
        pr = p >= th; tp = (pr & t).sum()
        if not tp: continue
        score = min(tp / pr.sum(), tp / t.sum())
        if best is None or score > best[0]: best = (score, float(th))
    return best[1] if best else None

def build(group, label, kind, src):
    X, y, g = dataset(kind, src)
    test = np.isin(g, sorted(held_out(f'{kind}:{src}', g, y))); train = ~test
    oof = np.zeros(train.sum())
    for a, b in GroupKFold(n_splits=5).split(X[train], y[train], g[train]):
        oof[b] = fit(X[train][a], y[train][a]).predict_proba(X[train][b])[:, 1]
    th = balance_threshold(y[train], oof)
    r = {'group': group, 'label': label, 'trainedFrom': f'{kind}:{src}', 'trainPositive': int(y[train].sum()),
         'testPositive': int(y[test].sum()), 'testNegative': int((~y[test]).sum()), 'heldOutGroups': int(len(set(g[test]))), 'threshold': th}
    if th is None: return {**r, 'ships': False, 'why': 'no usable threshold'}, None
    pred = fit(X[train], y[train]).predict_proba(X[test])[:, 1] >= th
    tp, fp, fn = int((pred & y[test]).sum()), int((pred & ~y[test]).sum()), int((~pred & y[test]).sum())
    P = tp / (tp + fp) if tp + fp else 0.0; R = tp / (tp + fn) if tp + fn else 0.0
    r.update(tp=tp, fp=fp, fn=fn, precision=P, recall=R, ships=bool(P >= BAR and R >= BAR))
    if not r['ships']: return {**r, 'why': f'below {BAR:.0%} on held-out groups'}, None
    m = fit(X, y)                                   # refit on everything, same threshold
    return r, {'group': group, 'label': label, 'weights': [round(float(w), 6) for w in m.coef_[0]],
               'bias': round(float(m.intercept_[0]), 6), 'threshold': round(th, 4)}

results = Parallel(n_jobs=int(os.environ.get('JOBS', '8')))(delayed(build)(*c) for c in CANDIDATES)
# Effect heads are measured but held back unless asked for: they were trained and tested on
# guitar and bass only, and on other sources they missed most effects in a spot check.
SHIP_EFFECTS = os.environ.get('SHIP_EFFECTS') == '1'
for r, h in results:
    if h and h['group'] == 'character' and not SHIP_EFFECTS:
        r['ships'] = False; r['why'] = 'held back: passed on guitar and bass only'
heads = [h for r, h in results if h and r['ships']]
print(f"{'label':<16}{'group':<12}{'test+':>6}{'precision':>11}{'recall':>8}   ships")
for r, _ in results:
    p = f"{r['precision']*100:.0f}%" if 'precision' in r else '-'; q = f"{r['recall']*100:.0f}%" if 'recall' in r else '-'
    print(f"{r['label']:<16}{r['group']:<12}{r['testPositive']:>6}{p:>11}{q:>8}   {'YES' if r['ships'] else 'no - ' + r['why']}")
model = {'version': 1, 'encoder': ENCODER, 'revision': 'trained-heads-2026-10-04', 'examples': [], 'heads': heads}
body = json.dumps(model, separators=(',', ':')) + '\n'
open('public/sound-model/learned.json', 'w').write(body)
digest = hashlib.sha256(body.encode()).hexdigest()
mp = 'public/sound-model/manifest.json'; man = json.load(open(mp)); man['sha256']['learned.json'] = digest
open(mp, 'w').write(json.dumps(man, indent=2) + '\n')
json.dump({'kind': 'shipped-heads-report-v1', 'builtAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'bar': BAR,
           'learnedSha256': digest, 'note': 'Effect heads were trained and tested on guitar and bass recordings only.',
           'heads': [r for r, _ in results]}, open(REPORT, 'w'), indent=1)
print(f'\n{len(heads)} heads shipped -> public/sound-model/learned.json ({len(body)//1024} KB), manifest pinned {digest[:12]}')
