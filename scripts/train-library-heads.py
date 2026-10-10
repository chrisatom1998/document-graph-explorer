"""Trains one head per DJ sound label from a weakly labelled sample library.

Labels come from folder/file names, so two rules keep them honest:
 1. Split by BRAND: test brands are never seen in training or threshold choice.
 2. A clip only counts as a negative for a label when it cannot plausibly contain it.
    A drum loop is not evidence against "snare"; a noise sweep is not evidence against
    "riser". Those overlaps are excluded rather than counted as wrong.
Usage: train-library-heads.py <manifest.json> <embeddings dir> <out dir>"""
import json, sys, glob, datetime, os, itertools
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold, GroupShuffleSplit

MANIFEST, EMB, OUT = sys.argv[1:4]
os.makedirs(OUT, exist_ok=True)
TARGET, MIN_POS = 0.70, 40
catalog = {c['label']: c for c in json.load(open('src/audio/djCatalog.json'))['categories']}
OVERLAP = [  # sets of labels that can describe the same clip
    {'riser', 'noise sweep', 'whoosh'}, {'impact', 'sub drop', 'downlifter'},
    {'glitch effect', 'stutter effect', 'reverse effect'}, {'808 bass', 'sub bass'},
    {'reese bass', 'wobble bass', 'bass growl', 'synth bass'}, {'synth chord', 'atmospheric pad', 'synth stab'},
    {'synth arpeggio', 'synth pluck', 'synth lead'}, {'texture', 'ambient drone', 'static noise', 'foley hit', 'synth drone'},
    {'chops', 'vocal chops'}]
def compatible(a, b):
    if a == b: return True
    fa, fb = catalog.get(a, {}).get('family'), catalog.get(b, {}).get('family')
    if {fa, fb} <= {'drum-hit', 'drum-pattern'} and 'drum-pattern' in {fa, fb}: return True   # patterns contain hits, and a breakbeat is a drum loop
    if 'percussion hit' in {a, b} and {fa, fb} == {'drum-hit'}: return True    # "perc" is a catch-all for any hit
    if 'synth bass' in {a, b} and 'bass' in {fa, fb}: return True
    if {fa, fb} <= {'vocal', 'editing'} and 'vocal' in {fa, fb}: return True
    return any(a in s and b in s for s in OVERLAP)

man = json.load(open(MANIFEST))
meta = {c['id']: c for c in man['clips']}
def load_fingerprints(folder):
    out = {}
    for f in sorted(glob.glob(f'{folder}/emb-*.jsonl')):
        for line in open(f):
            r = json.loads(line)
            # A resumed or re-sharded run can fingerprint a clip twice; count it once.
            if r['id'] in meta and r['id'] not in out: out[r['id']] = r['embedding']
    return out
# EMB may list several fingerprint folders ("a+b"): each is scaled to unit length, then
# joined, so two listening models can vote together without one drowning the other.
parts = [load_fingerprints(d) for d in EMB.split('+')]
ids = [i for i in parts[0] if all(i in q for q in parts[1:])]
blocks = []
for q in parts:
    B = np.asarray([q[i] for i in ids], dtype=np.float64); blocks.append(B / np.linalg.norm(B, axis=1, keepdims=True))
X = np.hstack(blocks)
labsets = [set(meta[i].get('labels') or [meta[i]['label']]) for i in ids]
brand = np.array([meta[i]['vendor'] for i in ids])
labels = sorted({l for s in labsets for l in s if catalog.get(l, {}).get('group') == 'production'})
print(f'clips: {len(ids)}   brands: {len(set(brand))}   labels: {len(labels)}')

import hashlib
def test_brands_for(L, pos):
    """Hold out about a quarter of this label's examples, by whole brands, chosen per label
    so every label keeps brands to learn from and brands to be tested on."""
    counts = {}
    for b in brand[pos]: counts[b] = counts.get(b, 0) + 1
    order = sorted(counts, key=lambda b: hashlib.sha256(f'{L}|{b}'.encode()).hexdigest())
    chosen, n, total = set(), 0, sum(counts.values())
    for b in order:
        if len(chosen) >= len(order) - 3: break          # always leave 3+ brands for training
        if n >= 0.25 * total: break
        if n + counts[b] > 0.5 * total: continue         # one giant brand must not swallow the test
        chosen.add(b); n += counts[b]
    return chosen

def pick(t, p):
    """Threshold where precision and recall on unseen training brands are best balanced.
    Demanding 70% precision first made heads go silent on brands they had not heard."""
    best = None
    for th in np.unique(np.round(p, 3)):
        if th < 0.5: continue
        pr = p >= th; tp = (pr & t).sum(); fp = (pr & ~t).sum(); fn = (~pr & t).sum()
        if not tp: continue
        score = min(tp / (tp + fp), tp / (tp + fn))
        if best is None or score > best[0]: best = (score, float(th))
    return best[1] if best else None

def train_one(L):
    pos = np.array([L in s for s in labsets])
    # Negatives: clips none of whose labels could co-occur with L.
    neg = np.array([not any(compatible(L, o) for o in s) for s in labsets])
    use = pos | neg
    held = test_brands_for(L, pos)
    tem = np.isin(brand, sorted(held)); trm = ~tem
    r = {'family': catalog[L].get('family'), 'trainPositive': int((pos & trm).sum()),
         'testPositive': int((pos & tem).sum()), 'heldOutBrands': sorted(held)}
    a = np.where(trm & use)[0]; b = np.where(tem & use)[0]
    if pos[a].sum() < MIN_POS or len(set(brand[a][pos[a]])) < 3:
        r['verdict'] = 'too few training examples'; return L, r, None
    oof = np.zeros(len(a))
    for f_tr, f_va in GroupKFold(n_splits=min(5, len(set(brand[a])))).split(X[a], pos[a], brand[a]):
        if pos[a][f_tr].sum() == 0 or (~pos[a][f_tr]).sum() == 0: continue
        m = LogisticRegression(C=1.0, class_weight='balanced', max_iter=800, tol=1e-3).fit(X[a][f_tr], pos[a][f_tr])
        oof[f_va] = m.predict_proba(X[a][f_va])[:, 1]
    th = pick(pos[a], oof); r['threshold'] = th
    if th is None: r['verdict'] = 'no usable threshold'; return L, r, None
    m = LogisticRegression(C=1.0, class_weight='balanced', max_iter=800, tol=1e-3).fit(X[a], pos[a])
    if pos[b].sum() < 10:
        r['verdict'] = 'trained, but too few examples from held-out brands to test'
    else:
        pr = m.predict_proba(X[b])[:, 1] >= th; t = pos[b]
        tp, fp, fn = int((pr & t).sum()), int((pr & ~t).sum()), int((~pr & t).sum())
        P = tp / (tp + fp) if tp + fp else 0.0; R = tp / (tp + fn)
        r.update(tp=tp, fp=fp, fn=fn, precision=P, recall=R, passes=bool(P >= TARGET and R >= TARGET))
        r['verdict'] = 'PASS' if r['passes'] else 'fails'
    return L, r, {'group': 'production', 'label': L, 'weights': [round(float(w), 7) for w in m.coef_[0]],
                  'bias': round(float(m.intercept_[0]), 7), 'threshold': round(th, 4), 'verdict': r['verdict']}

from joblib import Parallel, delayed
heads, report = [], {}
for i, (L, r, h) in enumerate(Parallel(n_jobs=int(os.environ.get('JOBS', '6')), return_as='generator_unordered')(delayed(train_one)(L) for L in labels), 1):
    report[L] = r
    if h: heads.append(h)
    print(f'  [{i}/{len(labels)}] {L}: {r["verdict"]}', flush=True)

print(f"{'label':<18}{'family':<14}{'test+':>6}{'prec':>8}{'recall':>8}   verdict")
for L, r in sorted(report.items(), key=lambda x: (x[1].get('verdict') != 'PASS', x[0])):
    p = f"{r['precision']*100:.0f}%" if 'precision' in r else '-'; q = f"{r['recall']*100:.0f}%" if 'recall' in r else '-'
    print(f"{L:<18}{str(r['family']):<14}{r['testPositive']:>6}{p:>8}{q:>8}   {r['verdict']}")
n = sum(1 for r in report.values() if r.get('passes'))
print(f"\npassing 70/70 on brands held out for that label: {n} of {len(labels)} labels")
json.dump({'kind': 'library-heads-report-v2', 'trainedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'clips': len(ids), 'split': 'per-label held-out brands', 'target': TARGET, 'labels': report}, open(f'{OUT}/report.json', 'w'), indent=1)
json.dump(heads, open(f'{OUT}/heads.json', 'w'))
print(f'wrote {OUT}/report.json, {len(heads)} heads')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'audio-model'))
import charts  # noqa: E402  one finished point on the live training chart; counts only, no held-out scores
charts.summary('library-heads', {}, {'heads trained': len(heads), 'labels tried': len(labels), 'clips': len(ids)})
