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
    if {fa, fb} == {'drum-hit', 'drum-pattern'}: return True     # patterns are made of hits
    if {fa, fb} <= {'vocal', 'editing'} and 'vocal' in {fa, fb}: return True
    return any(a in s and b in s for s in OVERLAP)

man = json.load(open(MANIFEST))
meta = {c['id']: c for c in man['clips']}
ids, X = [], []
for f in sorted(glob.glob(f'{EMB}/emb-*.jsonl')):
    for line in open(f):
        r = json.loads(line)
        if r['id'] in meta: ids.append(r['id']); X.append(r['embedding'])
X = np.asarray(X, dtype=np.float64); X /= np.linalg.norm(X, axis=1, keepdims=True)
labsets = [set(meta[i].get('labels') or [meta[i]['label']]) for i in ids]
brand = np.array([meta[i]['vendor'] for i in ids])
labels = sorted({l for s in labsets for l in s if catalog.get(l, {}).get('group') == 'production'})
print(f'clips: {len(ids)}   brands: {len(set(brand))}   labels: {len(labels)}')

tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=20261004).split(X, groups=brand))
test_brands = sorted(set(brand[te])); assert not set(brand[tr]) & set(test_brands)
print(f'held-out brands ({len(test_brands)}): {", ".join(test_brands)}\n')

def pick(t, p):
    best = None
    for th in np.unique(np.round(p, 3)):
        if th < 0.5: continue
        pr = p >= th; tp = (pr & t).sum(); fp = (pr & ~t).sum(); fn = (~pr & t).sum()
        if not tp: continue
        P, R = tp / (tp + fp), tp / (tp + fn)
        if P >= TARGET and (best is None or 2*P*R/(P+R) > best[0]): best = (2*P*R/(P+R), float(th))
    return best[1] if best else None

heads, report = [], {}
for L in labels:
    pos = np.array([L in s for s in labsets])
    # Negatives: clips none of whose labels could co-occur with L.
    neg = np.array([not any(compatible(L, o) for o in s) for s in labsets])
    use = pos | neg
    r = {'family': catalog[L].get('family'), 'trainPositive': int((pos & np.isin(np.arange(len(ids)), tr)).sum()),
         'testPositive': int(pos[te].sum()), 'testBrandsWithPositives': int(len(set(brand[te][pos[te]])))}
    trm = np.zeros(len(ids), bool); trm[tr] = True; tem = ~trm
    a = np.where(trm & use)[0]; b = np.where(tem & use)[0]
    if pos[a].sum() < MIN_POS or len(set(brand[a][pos[a]])) < 3:
        r['verdict'] = 'too few training examples'; report[L] = r; continue
    oof = np.zeros(len(a))
    for f_tr, f_va in GroupKFold(n_splits=min(5, len(set(brand[a])))).split(X[a], pos[a], brand[a]):
        if pos[a][f_tr].sum() == 0 or (~pos[a][f_tr]).sum() == 0: continue
        m = LogisticRegression(C=1.0, class_weight='balanced', max_iter=3000).fit(X[a][f_tr], pos[a][f_tr])
        oof[f_va] = m.predict_proba(X[a][f_va])[:, 1]
    th = pick(pos[a], oof); r['threshold'] = th
    if th is None: r['verdict'] = 'no threshold reaches 70% precision on training brands'; report[L] = r; continue
    m = LogisticRegression(C=1.0, class_weight='balanced', max_iter=3000).fit(X[a], pos[a])
    if pos[b].sum() < 10:
        r['verdict'] = 'trained, but too few examples from held-out brands to test'
    else:
        pr = m.predict_proba(X[b])[:, 1] >= th; t = pos[b]
        tp, fp, fn = int((pr & t).sum()), int((pr & ~t).sum()), int((~pr & t).sum())
        P = tp / (tp + fp) if tp + fp else 0.0; R = tp / (tp + fn)
        r.update(tp=tp, fp=fp, fn=fn, precision=P, recall=R, passes=bool(P >= TARGET and R >= TARGET))
        r['verdict'] = 'PASS' if r['passes'] else 'fails'
    heads.append({'group': 'production', 'label': L, 'weights': [round(float(w), 7) for w in m.coef_[0]],
                  'bias': round(float(m.intercept_[0]), 7), 'threshold': round(th, 4), 'verdict': r['verdict']})
    report[L] = r

print(f"{'label':<18}{'family':<14}{'test+':>6}{'prec':>8}{'recall':>8}   verdict")
for L, r in sorted(report.items(), key=lambda x: (x[1].get('verdict') != 'PASS', x[0])):
    p = f"{r['precision']*100:.0f}%" if 'precision' in r else '-'; q = f"{r['recall']*100:.0f}%" if 'recall' in r else '-'
    print(f"{L:<18}{str(r['family']):<14}{r['testPositive']:>6}{p:>8}{q:>8}   {r['verdict']}")
n = sum(1 for r in report.values() if r.get('passes'))
print(f"\npassing 70/70 on brands never seen in training: {n} of {len(labels)} labels")
json.dump({'kind': 'library-heads-report-v1', 'trainedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'clips': len(ids), 'heldOutBrands': test_brands, 'target': TARGET, 'labels': report}, open(f'{OUT}/report.json', 'w'), indent=1)
json.dump(heads, open(f'{OUT}/heads.json', 'w'))
print(f'wrote {OUT}/report.json, {len(heads)} heads')
