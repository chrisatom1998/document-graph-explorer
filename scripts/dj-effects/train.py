"""Trains one logistic head per DJ-effect label on the app's 512-number CLAP fingerprints (embed-clap.mjs).

Train / held-out split is by Freesound uploader (mine.py). Held-out clips are never used to fit a head or to
choose its threshold: the regularisation strength and the threshold come from 5-fold out-of-fold scores on
the training uploaders only (GroupKFold by uploader). Threshold: highest F1 with out-of-fold precision >= 70%;
if none reaches 70%, the threshold that maximises min(precision, recall). The app refuses thresholds below 0.5.
Negatives for a label: every other clip (other effects + clips that name no effect) except clips tagged with
the label itself or a related effect (labels.json "overlap"), since uploader tags are incomplete.
The heads that ship are the ones fitted on the training split, so the held-out numbers describe exactly them.
Also scores the heads the app ships today (public/sound-model/learned.json, short-clip.json) on the same
held-out clips, so a new head can be compared with the current one on equal terms.
Exported in the form learnedDjModel.ts evaluates: logit = bias + sum(w_i * v_i / |v|), shown when sigmoid >= threshold.
Usage: train.py <audio-manifest.json> <embeddings dir> <out dir>"""
import json, sys, glob, os, datetime
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold

MANIFEST, EMB, OUT = sys.argv[1:4]
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
spec = json.load(open(f'{HERE}/labels.json'))
GROUP = {L['label']: L['group'] for L in spec['labels']}
OVERLAP = [set(s) for s in spec['overlap']]
TARGET, MIN_TRAIN, MIN_TEST = 0.70, 25, 10
meta = {c['id']: c for c in json.load(open(MANIFEST))['clips']}
ids, X, seen = [], [], set()
for f in sorted(glob.glob(f'{EMB}/emb-*.jsonl')):
    for line in open(f):
        r = json.loads(line)
        if r['id'] in meta and r['id'] not in seen: seen.add(r['id']); ids.append(r['id']); X.append(r['embedding'])
X = np.asarray(X, dtype=np.float64); X /= np.linalg.norm(X, axis=1, keepdims=True)
LAB = [set(meta[i]['labels']) for i in ids]
G = np.array([meta[i]['group'] for i in ids]); TEST = np.array([meta[i]['split'] == 'heldout' for i in ids])
assert not set(G[TEST]) & set(G[~TEST]), 'uploader in both splits'
print(f'clips with fingerprints: {len(ids)} of {len(meta)}  (train {int((~TEST).sum())}, held-out {int(TEST.sum())}, uploaders {len(set(G))})')

related = lambda a, b: a == b or any(a in s and b in s for s in OVERLAP)
sig = lambda z: 1 / (1 + np.exp(-z))
def prf(t, pred):
    tp = int((pred & t).sum()); fp = int((pred & ~t).sum()); fn = int((~pred & t).sum())
    return {'tp': tp, 'fp': fp, 'fn': fn, 'precision': tp / (tp + fp) if tp + fp else 0.0, 'recall': tp / (tp + fn) if tp + fn else 0.0}
def choose_threshold(t, p):
    best, fallback = None, None
    for th in np.unique(np.round(p, 4)):
        if th < 0.5: continue
        pred = p >= th; tp = int((pred & t).sum())
        if not tp: continue
        P, R = tp / pred.sum(), tp / t.sum(); F = 2 * P * R / (P + R)
        if P >= TARGET and (best is None or F > best[0]): best = (F, float(th))
        if fallback is None or min(P, R) > fallback[0]: fallback = (min(P, R), float(th))
    return (best[1], 'f1 at precision>=0.70') if best else ((fallback[1], 'max min(P,R); 0.70 precision not reached') if fallback else (None, None))
fit = lambda A, y, C: LogisticRegression(C=C, class_weight='balanced', max_iter=1000, tol=1e-4).fit(A, y)

shipped = {}
for f in ('learned.json', 'short-clip.json'):
    for hd in json.load(open(f'public/sound-model/{f}'))['heads']:
        shipped.setdefault(hd['label'], []).append({**hd, 'file': f})

heads, report = [], {}
for label in [L['label'] for L in spec['labels']]:
    pos = np.array([label in s for s in LAB])
    use = pos | np.array([not any(related(label, o) for o in s) for s in LAB])
    tr, te = use & ~TEST, use & TEST
    e = {'group': GROUP[label], 'trainPositive': int(pos[tr].sum()), 'trainNegative': int((~pos[tr]).sum()),
         'testPositive': int(pos[te].sum()), 'testNegative': int((~pos[te]).sum()),
         'trainUploaders': len(set(G[tr & pos])), 'testUploaders': len(set(G[te & pos]))}
    # Today's shipped heads on the same held-out clips.
    for hd in shipped.get(label, []):
        p = sig(X[te] @ np.asarray(hd['weights']) + hd['bias'])
        e.setdefault('current', []).append({'file': hd['file'], 'maybe': bool(hd.get('maybe')), 'threshold': hd['threshold'], **prf(pos[te], p >= hd['threshold'])})
    if e['trainPositive'] < MIN_TRAIN or e['trainUploaders'] < 5:
        report[label] = {**e, 'verdict': 'too few training clips'}; continue
    a = np.where(tr)[0]; folds = list(GroupKFold(n_splits=5).split(X[a], pos[a], G[a]))
    def oof(C):
        o = np.zeros(len(a))
        for x, y in folds: o[y] = fit(X[a][x], pos[a][x], C).predict_proba(X[a][y])[:, 1]
        return o
    best = None
    for C in (0.3, 1.0, 3.0, 10.0):
        o = oof(C); th, rule = choose_threshold(pos[a], o)
        if th is None: continue
        s = prf(pos[a], o >= th); F = 2 * s['precision'] * s['recall'] / (s['precision'] + s['recall']) if s['tp'] else 0
        score = (rule.startswith('f1'), F if rule.startswith('f1') else min(s['precision'], s['recall']))
        if best is None or score > best[0]: best = (score, C, th, rule, s)
    if best is None: report[label] = {**e, 'verdict': 'no usable threshold'}; continue
    _, C, th, rule, s = best
    model = fit(X[a], pos[a], C)
    e.update(C=C, threshold=round(th, 4), thresholdRule=rule, trainOof={k: s[k] for k in ('precision', 'recall')})
    if e['testPositive'] < MIN_TEST:
        report[label] = {**e, 'verdict': f'fewer than {MIN_TEST} held-out positives; not tested'}; continue
    res = prf(pos[te], model.predict_proba(X[te])[:, 1] >= th)
    e.update(**res, f1=2 * res['precision'] * res['recall'] / (res['precision'] + res['recall']) if res['tp'] else 0.0,
             passes70=bool(res['precision'] >= .7 and res['recall'] >= .7))
    e['verdict'] = 'PASS 70/70' if e['passes70'] else 'below 70/70'
    heads.append({'group': GROUP[label], 'label': label, 'weights': [round(float(w), 6) for w in model.coef_[0]],
                  'bias': round(float(model.intercept_[0]), 6), 'threshold': round(th, 4)})
    report[label] = e

lines = [f"{'label':<16}{'train+':>7}{'test+':>6}{'test-':>6}{'thresh':>8}{'P':>7}{'R':>7}   verdict          current head on same held-out"]
for label, e in report.items():
    cur = '; '.join(f"{c['file'].split('.')[0]}{' maybe' if c['maybe'] else ''} P{c['precision']:.2f} R{c['recall']:.2f}" for c in e.get('current', [])) or '-'
    if 'precision' not in e: lines.append(f"{label:<16}{e['trainPositive']:>7}{e['testPositive']:>6}{e['testNegative']:>6}{'-':>8}{'-':>7}{'-':>7}   {e['verdict']:<16} {cur}"); continue
    lines.append(f"{label:<16}{e['trainPositive']:>7}{e['testPositive']:>6}{e['testNegative']:>6}{e['threshold']:>8.3f}{e['precision']:>7.2f}{e['recall']:>7.2f}   {e['verdict']:<16} {cur}")
text = '\n'.join(lines); print(text)
open(f'{OUT}/report.txt', 'w').write(text + '\n')
json.dump({'kind': 'dj-effect-heads-report-v1', 'trainedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'clips': len(ids), 'trainClips': int((~TEST).sum()), 'heldOutClips': int(TEST.sum()), 'heldOutUploaders': len(set(G[TEST])),
           'thresholdTarget': TARGET, 'labels': report}, open(f'{OUT}/report.json', 'w'), indent=1)
json.dump({'kind': 'dj-effect-heads-v1', 'heads': heads}, open(f'{OUT}/heads.json', 'w'))
print(f'wrote {OUT}/report.json and {len(heads)} heads')
