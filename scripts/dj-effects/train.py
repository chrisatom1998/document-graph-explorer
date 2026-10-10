"""Trains one logistic head per DJ-effect label on the app's 512-number CLAP fingerprints (embed-clap.mjs).

Train / held-out split is by Freesound uploader (mine.py). Held-out clips are never used to fit a head or to
choose its threshold: the regularisation strength and the threshold come from 5-fold out-of-fold scores on
the training uploaders only (GroupKFold by uploader). Threshold: the one that maximises min(precision, recall)
on those out-of-fold scores (the target is P and R >= 0.70). The app refuses thresholds below 0.5.
Negatives for a label: every other clip (other effects + clips that name no effect) except clips tagged with
the label itself or a related effect (labels.json "overlap"), since uploader tags are incomplete. "hardNegatives"
({label: [related labels]}) lets TRAINING use clips of the named related labels as negatives; the held-out rows keep the
overlap rule, so held-out numbers stay comparable with heads trained without it.
The heads that ship are the ones fitted on the training split, so the held-out numbers describe exactly them.
Also scores the heads the app ships today on the same held-out clips, so a new head can be compared with the current
one on equal terms: learned.json heads on every held-out clip, short-clip.json heads (which the app runs only on whole
clips of at most maxSeconds, on standardised features) on the held-out clips that short, with their mean/std applied.
With DURATIONS=<json {id: seconds}>, each new head is also scored on the held-out clips of at most maxSeconds
("heldOutOneShot"), since the app scores those with one-shot heads only unless a head is cleared for them.
Exported in the form learnedDjModel.ts evaluates: logit = bias + sum(w_i * v_i / |v|), shown when sigmoid >= threshold.
With a renders manifest (render.py: effects applied by DSP to plain music clips from TRAINING uploaders), each label
is fitted both without and with the renders, and the variant (and C) is chosen on out-of-fold scores of the REAL
training clips only; the threshold is chosen on those real out-of-fold scores too. Renders never reach the held-out test.
With PRIMARY_ROUND=<n> (grow.py clips carry a "round"), the held-out numbers that decide a head are taken on the held-out
clips of rounds <= n only, so heads trained on a grown clip set are judged on exactly the clips earlier heads were judged on;
"extended" adds the same numbers on every held-out clip, new rounds included.
With ONLY=<label,label>, only those labels are trained and reported (for experiments).
Usage: train.py <audio-manifest.json> <embeddings dir> <out dir> [renders-manifest.json]"""
import json, sys, glob, os, datetime
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from eligibility import known_duration, long_clip_metrics

MANIFEST, EMB, OUT = sys.argv[1:4]; RENDERS = sys.argv[4] if len(sys.argv) > 4 else None
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
spec = json.load(open(f"{HERE}/{os.environ.get('LABELS', 'labels.json')}"))
GROUP = {L['label']: L['group'] for L in spec['labels']}
OVERLAP = [set(s) for s in spec['overlap']]
HARD = {k: set(v) for k, v in spec.get('hardNegatives', {}).items()}
ONLY = set(filter(None, os.environ.get('ONLY', '').split(',')))
TARGET, MIN_TRAIN, MIN_TEST = 0.70, 25, 10
meta = {c['id']: c for c in json.load(open(MANIFEST))['clips']}
if RENDERS: meta.update({c['id']: c for c in json.load(open(RENDERS))['clips']})
ids, X, seen = [], [], set()
for f in sorted(glob.glob(f'{EMB}/emb-*.jsonl')):
    for line in open(f):
        r = json.loads(line)
        if r['id'] in meta and r['id'] not in seen: seen.add(r['id']); ids.append(r['id']); X.append(r['embedding'])
X = np.asarray(X, dtype=np.float64); X /= np.linalg.norm(X, axis=1, keepdims=True)
LAB = [set(meta[i]['labels']) for i in ids]
G = np.array([meta[i]['group'] for i in ids]); TEST = np.array([meta[i]['split'] == 'heldout' for i in ids])
assert not set(G[TEST]) & set(G[~TEST]), 'uploader in both splits'
PRIMARY = np.array([meta[i].get('round', 1) <= int(os.environ.get('PRIMARY_ROUND', 10**6)) for i in ids])
RENDER = np.array([meta[i].get('kind') == 'render' for i in ids]); assert not (RENDER & TEST).any()
print(f'clips with fingerprints: {len(ids)} of {len(meta)}  (train {int((~TEST & ~RENDER).sum())} real + {int(RENDER.sum())} renders, held-out {int(TEST.sum())}, uploaders {len(set(G))})')

related = lambda a, b: a == b or any(a in s and b in s for s in OVERLAP)
sig = lambda z: 1 / (1 + np.exp(-z))
def prf(t, pred):
    tp = int((pred & t).sum()); fp = int((pred & ~t).sum()); fn = int((~pred & t).sum())
    return {'tp': tp, 'fp': fp, 'fn': fn, 'precision': tp / (tp + fp) if tp + fp else 0.0, 'recall': tp / (tp + fn) if tp + fn else 0.0}
def choose_threshold(t, p):
    """The project target is precision AND recall >= 0.70, so pick the threshold that maximises min(P, R)
    (ties: higher F1). Round 2 used "highest F1 with precision >= 0.70", which bought precision with recall."""
    best = None
    for th in np.unique(np.round(p, 4)):
        if th < 0.5: continue
        pred = p >= th; tp = int((pred & t).sum())
        if not tp: continue
        P, R = tp / pred.sum(), tp / t.sum(); key = (min(P, R), 2 * P * R / (P + R))
        if best is None or key > best[0]: best = (key, float(th))
    return (best[1], 'max min(P,R)') if best else (None, None)
fit = lambda A, y, C: LogisticRegression(C=C, class_weight='balanced', max_iter=1000, tol=1e-4).fit(A, y)

shipped = {}
for f in ('learned.json', 'short-clip.json'):
    for hd in json.load(open(f'public/sound-model/{f}'))['heads']:
        shipped.setdefault(hd['label'], []).append({**hd, 'file': f})
SC = json.load(open('public/sound-model/short-clip.json'))
assert SC['blocks'] == ['clapRepeat'], 'short-clip comparison assumes the CLAP-only block layout'
XS = (X - np.asarray(SC['mean'])) / np.asarray(SC['std'])   # shortClipModel.ts vector(): unit CLAP, then standardised
DUR = json.load(open(os.environ['DURATIONS'])) if os.environ.get('DURATIONS') else {}
if not DUR:
    print('No DURATIONS supplied: research scores only; ship.py will abstain until runtime-eligible duration evidence is supplied.')
SHORT = np.array([known_duration(DUR.get(i)) and DUR[i] <= SC['maxSeconds'] for i in ids])
print(f'held-out clips of at most {SC["maxSeconds"]} s: {int((SHORT & TEST).sum())} (durations known for {len(DUR)})')

heads, report = [], {}
for label in [L['label'] for L in spec['labels'] if not ONLY or L['label'] in ONLY]:
    pos = np.array([label in s for s in LAB])
    use = pos | np.array([not any(related(label, o) for o in s) for s in LAB])
    hard = HARD.get(label, set())
    use_tr = pos | np.array([not any(related(label, o) and o not in hard for o in s) for s in LAB])
    tr, te, tx = use_tr & ~TEST, use & TEST & PRIMARY, use & TEST
    real_tr = tr & ~RENDER
    e = {'group': GROUP[label], 'trainPositive': int(pos[real_tr].sum()), 'trainNegative': int((~pos[real_tr]).sum()),
         'trainRenders': int((pos & tr & RENDER).sum()), 'testPositive': int(pos[te].sum()), 'testNegative': int((~pos[te]).sum()),
         'trainUploaders': len(set(G[real_tr & pos])), 'testUploaders': len(set(G[te & pos]))}
    if hard: e['hardNegatives'] = sorted(hard)
    # Today's shipped heads on the same held-out clips.
    for hd in shipped.get(label, []):
        if hd['file'] == 'short-clip.json':
            rows = te & SHORT
            if not rows.any(): continue
            p = sig(XS[rows] @ np.asarray(hd['weights']) + hd['bias'])
            e.setdefault('current', []).append({'file': hd['file'], 'subset': f'held-out clips <= {SC["maxSeconds"]} s', 'maybe': bool(hd.get('maybe')),
                                                'threshold': hd['threshold'], **prf(pos[rows], p >= hd['threshold'])})
            continue
        p = sig(X[te] @ np.asarray(hd['weights']) + hd['bias'])
        e.setdefault('current', []).append({'file': hd['file'], 'maybe': bool(hd.get('maybe')), 'threshold': hd['threshold'], **prf(pos[te], p >= hd['threshold'])})
        if DUR:
            e['current'][-1]['heldOutLongClip'] = long_clip_metrics(pos[te], p >= hd['threshold'],
                [DUR.get(ids[i]) for i in np.where(te)[0]], SC['maxSeconds'])
        if (tx != te).any():
            p = sig(X[tx] @ np.asarray(hd['weights']) + hd['bias'])
            e.setdefault('extended', {})['current'] = {'positives': int(pos[tx].sum()), 'negatives': int((~pos[tx]).sum()), **prf(pos[tx], p >= hd['threshold'])}
            if DUR:
                e['extended']['current']['heldOutLongClip'] = long_clip_metrics(pos[tx], p >= hd['threshold'],
                    [DUR.get(ids[i]) for i in np.where(tx)[0]], SC['maxSeconds'])
    variants = {'real': real_tr}
    if e['trainRenders']: variants['real+renders'] = tr
    best = None
    for name, rows in variants.items():
        if pos[rows].sum() < MIN_TRAIN or len(set(G[rows & pos])) < 5: continue
        a = np.where(rows)[0]; folds = list(GroupKFold(n_splits=5).split(X[a], pos[a], G[a]))
        real = ~RENDER[a]
        # Threshold and choice on real training clips; with almost no real positives, on all out-of-fold rows.
        judge = real if pos[a][real].sum() >= 8 else np.ones(len(a), bool)
        for C in (0.3, 1.0, 3.0, 10.0):
            o = np.zeros(len(a))
            for x, y in folds: o[y] = fit(X[a][x], pos[a][x], C).predict_proba(X[a][y])[:, 1]
            th, rule = choose_threshold(pos[a][judge], o[judge])
            if th is None: continue
            sc = prf(pos[a][judge], o[judge] >= th); F = 2 * sc['precision'] * sc['recall'] / (sc['precision'] + sc['recall']) if sc['tp'] else 0
            score = (min(sc['precision'], sc['recall']), F)
            if best is None or score > best[0]:
                best = (score, name, a, C, th, rule, sc, bool(judge.all() and not real.all()))
    if best is None:
        report[label] = {**e, 'verdict': 'too few training clips' if e['trainPositive'] + e['trainRenders'] < MIN_TRAIN else 'no usable threshold'}; continue
    _, variant, a, C, th, rule, sc, judged_all = best
    model = fit(X[a], pos[a], C)
    e.update(variant=variant, C=C, threshold=round(th, 4), thresholdRule=rule + (' (on all out-of-fold rows incl. renders: < 8 real positives)' if judged_all else ' (on real training clips)'),
             trainOof={k: sc[k] for k in ('precision', 'recall')})
    if e['testPositive'] < MIN_TEST:
        report[label] = {**e, 'verdict': f'fewer than {MIN_TEST} held-out positives; not tested'}; continue
    res = prf(pos[te], model.predict_proba(X[te])[:, 1] >= th)
    # The exported coefficients are what the browser will actually score. Shipping
    # excludes whole one-shots; their separate clearance remains oneshot.py's job.
    exported_weights = np.asarray([round(float(w), 6) for w in model.coef_[0]])
    exported_bias = round(float(model.intercept_[0]), 6)
    if DUR:
        e['heldOutLongClip'] = long_clip_metrics(pos[te], sig(X[te] @ exported_weights + exported_bias) >= th,
            [DUR.get(ids[i]) for i in np.where(te)[0]], SC['maxSeconds'])
    if (tx != te).any():
        e.setdefault('extended', {})['new'] = {'positives': int(pos[tx].sum()), 'negatives': int((~pos[tx]).sum()), **prf(pos[tx], model.predict_proba(X[tx])[:, 1] >= th)}
        if DUR:
            e['extended']['new']['heldOutLongClip'] = long_clip_metrics(pos[tx], sig(X[tx] @ exported_weights + exported_bias) >= th,
                [DUR.get(ids[i]) for i in np.where(tx)[0]], SC['maxSeconds'])
    if DUR:
        rows = te & SHORT
        e['heldOutOneShot'] = {'positives': int(pos[rows].sum()), 'negatives': int((~pos[rows]).sum()),
                               **(prf(pos[rows], model.predict_proba(X[rows])[:, 1] >= th) if rows.any() else {})}
    e.update(**res, f1=2 * res['precision'] * res['recall'] / (res['precision'] + res['recall']) if res['tp'] else 0.0,
             passes70=bool(res['precision'] >= .7 and res['recall'] >= .7))
    e['verdict'] = 'PASS 70/70' if e['passes70'] else 'below 70/70'
    heads.append({'group': GROUP[label], 'label': label, 'weights': [round(float(w), 6) for w in model.coef_[0]],
                  'bias': round(float(model.intercept_[0]), 6), 'threshold': round(th, 4)})
    report[label] = e

lines = ['Aggregate metrics below include all durations; shipping uses heldOutLongClip, matching the runtime one-shot exclusion.',
         f"{'label':<16}{'train+':>7}{'test+':>6}{'test-':>6}{'thresh':>8}{'P':>7}{'R':>7}   {'verdict':<17}{'trained on':<14}current head on same held-out"]
for label, e in report.items():
    cur = '; '.join(f"{c['file'].split('.')[0]}{' maybe' if c['maybe'] else ''}{' (<=2.25 s clips)' if c.get('subset') else ''} P{c['precision']:.2f} R{c['recall']:.2f}" for c in e.get('current', [])) or '-'
    if e.get('extended', {}).get('new'):
        x = e['extended']; cur += f"   | all held-out ({x['new']['positives']}+): new P{x['new']['precision']:.2f} R{x['new']['recall']:.2f}" + (f", current P{x['current']['precision']:.2f} R{x['current']['recall']:.2f}" if 'current' in x else '')
    if e.get('heldOutOneShot', {}).get('positives'): o = e['heldOutOneShot']; cur += f"   | new on <=2.25 s: P{o['precision']:.2f} R{o['recall']:.2f} ({o['positives']}+/{o['negatives']}-)"
    if e.get('heldOutLongClip'):
        o = e['heldOutLongClip']; cur += f"   | runtime >{SC['maxSeconds']} s: P{o['precision']:.2f} R{o['recall']:.2f} ({o['positives']}+/{o['negatives']}-; {o['unknownDurations']} unknown durations)"
    if 'precision' not in e: lines.append(f"{label:<16}{e['trainPositive']:>7}{e['testPositive']:>6}{e['testNegative']:>6}{'-':>8}{'-':>7}{'-':>7}   {e['verdict']:<17} {e.get('variant', '-'):<14}{cur}"); continue
    lines.append(f"{label:<16}{e['trainPositive']:>7}{e['testPositive']:>6}{e['testNegative']:>6}{e['threshold']:>8.3f}{e['precision']:>7.2f}{e['recall']:>7.2f}   {e['verdict']:<17} {e['variant']:<14}{cur}")
text = '\n'.join(lines); print(text)
open(f'{OUT}/report.txt', 'w').write(text + '\n')
json.dump({'kind': 'dj-effect-heads-report-v1', 'trainedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'clips': len(ids), 'trainClips': int((~TEST).sum()), 'heldOutClips': int(TEST.sum()), 'primaryHeldOutClips': int((TEST & PRIMARY).sum()), 'heldOutUploaders': len(set(G[TEST])),
           'thresholdTarget': TARGET, 'labels': report}, open(f'{OUT}/report.json', 'w'), indent=1)
json.dump({'kind': 'dj-effect-heads-v1', 'heads': heads}, open(f'{OUT}/heads.json', 'w'))
print(f'wrote {OUT}/report.json and {len(heads)} heads')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'audio-model'))
import charts  # noqa: E402  one finished point on the live training chart; counts only, no held-out scores
charts.summary('dj-effects', {}, {'heads trained': len(heads), 'labels tried': len(report), 'training clips': int((~TEST).sum())})
