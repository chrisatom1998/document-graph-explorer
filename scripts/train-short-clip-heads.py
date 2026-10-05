"""Compare feature sets for short one-shots and fit per-category heads.

Selection uses ONLY the train split (uploader-grouped CV) and the calibration split (thresholds).
The frozen test split is never read here.

Usage: <venv>/python scripts/train-short-clip-heads.py [compare|export]
  compare  -> calibration precision/recall per category for every feature set
  export   -> fit the chosen feature set on train, pick thresholds on calibration, write the model JSON
"""
import json, glob, sys, os, datetime
import numpy as np
from collections import defaultdict
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold

W = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints/short-clips'
ROOT = os.path.join(os.path.dirname(__file__), '..')
MODE = sys.argv[1] if len(sys.argv) > 1 else 'compare'
TARGET = float(os.environ.get('TARGET', '0.70'))

feats = {}
for f in glob.glob(f'{W}/features-*.jsonl'):
    for line in open(f):
        r = json.loads(line)
        if r.get('event'): feats[r['id']] = r
manifest = json.load(open(f'{ROOT}/docs/evaluations/short-clips-2026-10-04/manifest.json'))
cal = [i for i in manifest['items'] if i['split'] == 'calibration']
assert not any(i['split'] == 'test' and i['id'] in feats for i in manifest['items']), 'test features must not be cached for selection'
train = json.load(open(f'{W}/train-items.json'))['items'] + (json.load(open(f'{W}/train-items-surge.json'))['items'] if os.path.exists(f'{W}/train-items-surge.json') else [])
if os.environ.get('SYNTH_FRESH'):
    # Synth retrain (2026-10-05): add NSynth-train notes and keep the fresh synth test's families out of training.
    train += json.load(open(f'{W}/train-items-nsynth.json'))['items']
    reserved = json.load(open(f'{ROOT}/docs/evaluations/synth-clips-2026-10-05/reserved-test-families.json'))
    held = set(reserved['nsynthTestInstruments']) | set(reserved['fsdUploaders'])
    train = [i for i in train if i['groups']['artist'] not in held]

if os.environ.get('CROPS'):
    # Short training clips from scripts/short-clip-crops.py: the start of longer development clips, with their
    # labels and family groups, so grouped CV keeps each crop with its source.
    for f in glob.glob(f'{W}/crops/features-crops-*.jsonl'):
        for line in open(f):
            r = json.loads(line)
            if r.get('event'): feats[r['id']] = r
    train += json.load(open(f'{W}/crops/crop-items.json'))['items']

def table(items):
    items = [i for i in items if i['id'] in feats]
    lab = [{f"{r['dimension']}:{r['label']}": r['state'] for r in i['reviews']} for i in items]
    # A clip known not to be a synthesizer (drum, voice, impact...) is not a synth hit either.
    for l in lab:
        if l.get('source:synthesizer') == 'absent' and 'role:synth hit' not in l: l['role:synth hit'] = 'absent'
    for l in lab:   # Definition, not a source label: a kick drum is never a bass hit (scripts/short-clip-bass-relabel.py, Bk).
        if 'role:bass hit' not in l and l.get('role:kick') == 'present': l['role:bass hit'] = 'absent'
    return items, lab, np.array([i['groups']['artist'] for i in items])
tr_items, tr_lab, tr_groups = table(train)
ca_items, ca_lab, ca_groups = table(cal)

def l2(x): return x / (np.linalg.norm(x, axis=1, keepdims=True) + 1e-9)
def block(items, name):
    if name == 'clapRepeat': return l2(np.array([feats[i['id']]['clapRepeat'] for i in items]))
    if name == 'clapZero': return l2(np.array([feats[i['id']]['clapZero'] for i in items]))
    if name == 'ast': return np.array([feats[i['id']]['ast'] for i in items]) / 10
    if name == 'event': return np.array([feats[i['id']]['event'] for i in items])
SETS = {'clapRepeat': ['clapRepeat'], 'clapZero': ['clapZero'], 'event': ['event'], 'ast': ['ast'],
        'clapZero+event': ['clapZero', 'event'], 'clapZero+ast+event': ['clapZero', 'ast', 'event'],
        'clapRepeat+ast+event': ['clapRepeat', 'ast', 'event'], 'ast+event': ['ast', 'event'], 'clapRepeat+event': ['clapRepeat', 'event']}

FIXED_STATS = None
if os.environ.get('STATS_FROM'):
    _m = json.load(open(os.environ['STATS_FROM'])); FIXED_STATS = (np.array(_m['mean']), np.array(_m['std']))

def matrix(items, names, stats=None):
    X = np.hstack([block(items, n) for n in names])
    if stats is None: stats = FIXED_STATS or (X.mean(0), X.std(0) + 1e-6)
    return (X - stats[0]) / stats[1], stats

CATS = sorted({k for lab in tr_lab + ca_lab for k, v in lab.items() if v == 'present'})
CATS = [c for c in CATS if not c.startswith('musical:')]

def fit(X, y, C):
    m = LogisticRegression(C=C, max_iter=3000, class_weight='balanced')
    return m.fit(X, y)

def pick_threshold(p, y):
    """Threshold >= .5 whose calibration precision AND recall both reach the target; else best F1 with precision >= target."""
    best = None
    for t in np.unique(np.round(np.concatenate([[.5], p[p >= .5]]), 4)):
        pred = p >= t; tp = (pred & y).sum(); P = tp / pred.sum() if pred.sum() else 0; R = tp / y.sum()
        f1 = 2 * P * R / (P + R) if P + R else 0
        if best is None or (P >= TARGET, f1) > (best[3] >= TARGET, best[4]): best = (t, P, R, P, f1)
    return best

DEV = tr_items + ca_items; DEV_LAB = tr_lab + ca_lab; DEV_GROUPS = np.concatenate([tr_groups, ca_groups])

def oof(X, y, groups, C, folds=5):
    ps = np.zeros(len(y))
    for a, b in GroupKFold(folds).split(X, y, groups):
        ps[b] = fit(X[a], y[a], C).predict_proba(X[b])[:, 1] if y[a].sum() >= 2 else 0
    return ps

def one_cat(X, stats, names, cat, Cs):
    m = np.array([cat in l for l in DEV_LAB]); y = np.array([l.get(cat) == 'present' for l in DEV_LAB])[m]
    if y.sum() < 10: return cat, None
    Xm, gm = X[m], DEV_GROUPS[m]
    best = None
    for C in Cs:
        p = oof(Xm, y, gm, C); t, P, R, _, f1 = pick_threshold(p, y)
        if best is None or (P >= TARGET and R >= TARGET, f1) > (best[2] >= TARGET and best[3] >= TARGET, best[4]): best = (C, t, P, R, f1)
    C, t, P, R, f1 = best
    return cat, dict(C=C, threshold=float(t), precision=round(float(P), 3), recall=round(float(R), 3), f1=round(float(f1), 3),
                     pos=int(y.sum()), neg=int((~y).sum()), posFamilies=len(set(gm[y])), model=fit(Xm, y, C), stats=stats, names=names)

def run_set(names, cats=None, Cs=(0.03, 0.3)):
    """Uploader-grouped out-of-fold predictions over ALL development data (train + calibration) pick C and the threshold."""
    from joblib import Parallel, delayed
    X, stats = matrix(DEV, names)
    res = Parallel(n_jobs=int(os.environ.get('JOBS', '8')))(delayed(one_cat)(X, stats, names, c, Cs) for c in (cats or CATS))
    return {c: r for c, r in res if r}

SHIPPED_MAP = {'kick': 'role:kick', 'snare': 'role:snare', 'open hi-hat': 'role:hi-hat', 'crash cymbal': 'role:cymbal', 'ride cymbal': 'role:cymbal',
               'shaker': 'role:shaker', 'finger snap': 'role:finger snap', 'whoosh': 'role:whoosh', 'vinyl scratch': 'role:vinyl scratch',
               'vocal ad-lib': 'role:vocal one-shot', 'vocal chant': 'role:vocal one-shot', 'choir': 'role:vocal one-shot', 'voice': 'source:voice',
               'sub bass': 'role:bass hit', 'distorted': 'effect:distorted', 'reverberant': 'effect:reverberant',
               'drum loop': 'role:loop', 'top loop': 'role:loop', 'percussion loop': 'role:loop', 'hi-hat loop': 'role:loop', 'drum fill': 'role:loop', 'synth arpeggio': 'role:loop'}

def shipped():
    """Today's shipped CLAP heads on the looped fingerprint, exactly as learnedDjScores thresholds them (maybe heads included)."""
    model = json.load(open(f'{ROOT}/public/sound-model/learned.json'))
    X = block(DEV, 'clapRepeat')
    fired = defaultdict(lambda: np.zeros(len(DEV), bool))
    for hd in model['heads']:
        p = 1 / (1 + np.exp(-np.clip(X @ np.array(hd['weights']) + hd['bias'], -35, 35)))
        hit = p >= hd['threshold']
        cats = [SHIPPED_MAP[hd['label']]] if hd['label'] in SHIPPED_MAP else []
        if hd['label'] in ['kick', 'snare', 'open hi-hat', 'crash cymbal', 'ride cymbal', 'shaker', 'finger snap', 'tom', 'percussion hit']: cats.append('role:percussion hit')
        for c in cats: fired[c] |= hit
    out = {}
    for cat, hit in fired.items():
        m = np.array([cat in l for l in DEV_LAB]); y = np.array([l.get(cat) == 'present' for l in DEV_LAB])
        h, yy = hit[m], y[m]; tp = (h & yy).sum()
        out[cat] = dict(precision=round(tp / h.sum(), 3) if h.sum() else None, recall=round(tp / yy.sum(), 3) if yy.sum() else None,
                        detections=int(h.sum()), pos=int(yy.sum()), neg=int((~yy).sum()))
    return out

if MODE == 'compare':
    rows = {'shipped (looped CLAP heads)': shipped()}
    print(json.dumps(rows['shipped (looped CLAP heads)'], indent=None))
    for name, names in SETS.items():
        res = run_set(names)
        rows[name] = {c: {k: v for k, v in r.items() if k not in ('model', 'stats', 'names')} for c, r in res.items()}
        passed = sum(r['precision'] >= TARGET and r['recall'] >= TARGET for r in res.values())
        print(f'{name:24s} pass {passed}/{len(res)}  meanF1 {np.mean([r["f1"] for r in res.values()]):.3f}', flush=True)
    os.makedirs(f'{ROOT}/artifacts/short-clips', exist_ok=True)
    json.dump({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'target': TARGET, 'note': 'calibration split only; test never read',
               'results': rows}, open(f'{ROOT}/artifacts/short-clips/feature-comparison.json', 'w'), indent=1)

# ---- export --------------------------------------------------------------------------------
# Benchmark category -> (DGE group, DGE label). Only heads whose development (out-of-fold) precision AND recall
# reach the target ship; everything else abstains on short clips.
EMIT = {'role:kick': ('production', 'kick'), 'role:snare': ('production', 'snare'), 'role:clap': ('production', 'clap'),
        'role:hi-hat': ('production', 'hi-hat'), 'role:cymbal': ('production', 'cymbal'), 'role:finger snap': ('production', 'finger snap'),
        'role:tambourine': ('production', 'tambourine'), 'role:cowbell': ('production', 'cowbell'), 'role:shaker': ('production', 'shaker'),
        'role:percussion hit': ('production', 'percussion hit'), 'role:whoosh': ('production', 'whoosh'), 'role:impact': ('production', 'impact'),
        'role:vinyl scratch': ('production', 'vinyl scratch'), 'role:beatbox': ('production', 'beatbox'), 'role:bass hit': ('production', 'bass hit'),
        'role:synth hit': ('production', 'synth hit'), 'source:voice': ('source', 'voice'), 'source:guitar': ('source', 'guitar'),
        'source:piano': ('source', 'piano'), 'source:synthesizer': ('source', 'synthesizer'), 'source:drums': ('source', 'drums'),
        'source:bass guitar': ('source', 'bass guitar')}
# On clips these heads cover, the app hides every looped-CLAP head (none was validated on one-shots).
if MODE == 'export':
    names = os.environ.get('SET', 'clapRepeat').split('+')
    only = [c for c in os.environ.get('ONLY', '').split(',') if c]
    res = run_set(names, cats=[c for c in CATS if c in EMIT and (not only or c in only)])
    heads, report = [], {}
    stats = None
    for cat, r in sorted(res.items()):
        stats = r['stats']
        passed = r['precision'] >= TARGET and r['recall'] >= TARGET
        report[cat] = {k: v for k, v in r.items() if k not in ('model', 'stats', 'names')} | {'ships': passed}
        if not passed: continue
        g, label = EMIT[cat]
        heads.append({'group': g, 'label': label, 'weights': [round(float(w), 6) for w in r['model'].coef_[0]],
                      'bias': round(float(r['model'].intercept_[0]), 6), 'threshold': round(max(.5, r['threshold']), 4)})
    block_names = {'clapRepeat': 'clapRepeat', 'clapZero': 'clapZero', 'ast': 'ast', 'event': 'event'}
    model = {'version': 1, 'kind': 'short-clip-heads', 'revision': f"short-clip-{datetime.date.today().isoformat()}-{'+'.join(names)}",
             'clapEncoder': 'Xenova/larger_clap_music_and_speech@e9fd5ac1dbf3280936a7fc3ec8a020453ff184db',
             **({'astModel': 'music-model'} if 'ast' in names else {}), 'eventFeatures': 'event-shape-v1',
             'blocks': [block_names[n] for n in names], 'maxSeconds': 2.25,
             'mean': [round(float(v), 6) for v in stats[0]], 'std': [round(float(v), 6) for v in stats[1]],
             'heads': heads}
    selection = f'{ROOT}/docs/evaluations/short-clips-2026-10-04/development-selection.json'
    if os.environ.get('MERGE_INTO'):
        # Replace only the retrained heads; the shared standardisation must be the existing model's.
        assert FIXED_STATS is not None, 'MERGE_INTO needs STATS_FROM'
        base = json.load(open(os.environ['MERGE_INTO']))
        retrained = {EMIT[c][1] for c in report}
        base['heads'] = [h for h in base['heads'] if h['label'] not in retrained] + heads
        base['revision'] = base['revision'] + '+' + os.environ.get('REVISION_SUFFIX', 'retrained')
        model = base
        selection = os.environ.get('SELECTION_OUT', selection)
    json.dump(model, open(f'{ROOT}/public/sound-model/short-clip.json', 'w'), separators=(',', ':'))
    json.dump({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'features': names, 'target': TARGET,
               'selection': 'uploader/preset/participant-grouped 5-fold out-of-fold predictions over train+calibration; test never read',
               'categories': report}, open(selection, 'w'), indent=1)
    print(json.dumps({c: (r['precision'], r['recall'], r['ships']) for c, r in report.items()}, indent=0))
