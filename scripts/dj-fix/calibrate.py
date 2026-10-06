"""Pick the DJ-fix display rules on the 900 OpenMIC calibration clips; nothing from either DJ clip test is used.

Usage: python3 scripts/dj-fix/calibrate.py docs/evaluations/dj-fix-2026-10-06 > docs/evaluations/dj-fix-2026-10-06/calibration.json

Inputs (in the folder): calibration/cal900-records.json (scripts/dj-fix/extract.mjs on main's build) and
labels/cal900.json (all OpenMIC labels). Clips are split by a fixed hash of the FMA artist (the seed PR #113 used), so
no artist is in both halves. Only explicit present/absent labels count.

Pass bar: precision AND recall >= 0.70 (Chris raised it from 0.60 on 2026-10-06, before any result here was read).
Two rule kinds, fixed before any result was read:
  add   (guitar, saxophone, violin): show the fusion head probability of a label the release keeps on its baseline.
        Threshold = lowest of 0.40, 0.45, ... 0.95 whose calibration-half precision for the rule alone is >= 0.80
        (the #113 procedure with a margin over the bar). Adopted only if, on the held-out half, the panel with the rule
        passes 70/70 or gains recall while keeping precision >= 0.70.
  raise (bass, organ, trumpet, cello): hide a shown label whose best tested score is below a threshold. Threshold =
        lowest of 0.40 ... 0.95 whose calibration-half panel precision is >= 0.80 with recall >= 0.70. Adopted only if,
        on the held-out half, precision rises and recall stays >= 0.70.
"""
import hashlib, json, os, sys

D = sys.argv[1]
SEED = 'dge-edm-genre-tags-2026-10-05'
TESTED = {'Trained head score', 'Baseline fallback score', 'Jamendo score (tested on full mixes)', 'Trained head score (tested on full mixes)'}
CLASS = {'drums': ['drums', 'drum kit', 'drum machine'], 'voice': ['voice'], 'synthesizer': ['synthesizer'], 'piano': ['piano', 'electric piano'],
         'guitar': ['guitar', 'acoustic guitar', 'electric guitar', 'steel guitar'], 'bass': ['bass guitar', 'bass', 'double bass'],
         'cymbals': ['cymbals'], 'organ': ['organ'], 'violin': ['violin', 'violin / fiddle'], 'trumpet': ['trumpet'],
         'saxophone': ['saxophone'], 'cello': ['cello']}
ADD = ['guitar', 'saxophone', 'violin']
RAISE = {'bass': 'bass', 'organ': 'organ', 'trumpet': 'trumpet', 'cello': 'cello'}   # class -> displayed label the rule keys on
GRID = [round(0.40 + 0.05 * i, 2) for i in range(12)]

manifest = json.load(open('docs/evaluations/mixed-music-2026-10-05/manifest.json'))['items']
artist = {i['id']: i['groups']['artist'] for i in manifest}
records = {r['id']: r for r in json.load(open(os.path.join(D, 'calibration/cal900-records.json')))}
labels = json.load(open(os.path.join(D, 'labels/cal900.json')))
half = lambda cid: 'calibration' if int(hashlib.sha256(f"{SEED}|{artist[cid]}".encode()).hexdigest(), 16) % 2 == 0 else 'held-out'
ids = [i for i in records if i in labels and i in artist]

def tested_best(s):
    v = [x['score'] for x in s['scores'] if x['model'] in TESTED]
    return max(v) if v else None

def panel(r, adds=None, raises=None):
    """Classes shown for one record under the given rules (main's panel when both are empty)."""
    shown = set()
    for s in r['shown']:
        if s['dimension'] != 'source': continue
        for cls, names in CLASS.items():
            if s['label'] not in names: continue
            t = (raises or {}).get(cls)
            if t is not None and s['label'] == RAISE[cls]:
                b = tested_best(s)
                if b is not None and b < t: continue
            shown.add(cls)
    for cls, t in (adds or {}).items():
        f = r['fusion'].get(cls)
        if f and f['source'] != 'learned-head' and f['head'] >= t and (r['duration'] or 0) >= 10: shown.add(cls)
    return shown

def score(rows, cls, fn):
    tp = fp = fn_ = 0
    for cid in rows:
        state = labels[cid].get(cls)
        if state is None: continue
        hit = cls in fn(records[cid])
        if state == 'present': tp += hit; fn_ += not hit
        else: fp += hit
    p = tp / (tp + fp) if tp + fp else None; rc = tp / (tp + fn_) if tp + fn_ else None
    return {'precision': None if p is None else round(p, 3), 'recall': None if rc is None else round(rc, 3), 'tp': tp, 'fp': fp, 'fn': fn_}

BAR = .70
passes = lambda s: (s['precision'] or 0) >= BAR and (s['recall'] or 0) >= BAR
halves = {h: [c for c in ids if half(c) == h] for h in ('calibration', 'held-out')}
out = {'clips': len(ids), 'halves': {h: len(v) for h, v in halves.items()}, 'add': {}, 'raise': {}, 'adopted': {'add': {}, 'raise': {}}}
for cls in ADD:
    alone = lambda t: (lambda r: {cls} if cls in panel({**r, 'shown': []}, {cls: t}) else set())
    sweep = {t: score(halves['calibration'], cls, alone(t)) for t in GRID}
    t = next((t for t in GRID if (sweep[t]['precision'] or 0) >= .80), None)
    res = {'calibrationSweepRuleAlone': {str(k): v for k, v in sweep.items()}, 'chosen': t,
           'main': {h: score(v, cls, panel) for h, v in halves.items()}}
    if t is not None:
        res['withRule'] = {h: score(v, cls, lambda r: panel(r, {cls: t})) for h, v in halves.items()}
        m, w = res['main']['held-out'], res['withRule']['held-out']
        res['adopted'] = passes(w) or ((w['recall'] or 0) > (m['recall'] or 0) and (w['precision'] or 0) >= BAR)
        if res['adopted']: out['adopted']['add'][cls] = t
    out['add'][cls] = res
for cls in RAISE:
    sweep = {t: score(halves['calibration'], cls, lambda r, t=t: panel(r, raises={cls: t})) for t in GRID}
    t = next((t for t in GRID if (sweep[t]['precision'] or 0) >= .80 and (sweep[t]['recall'] or 0) >= BAR), None)
    res = {'calibrationSweep': {str(k): v for k, v in sweep.items()}, 'chosen': t, 'main': {h: score(v, cls, panel) for h, v in halves.items()}}
    if t is not None:
        res['withRule'] = {h: score(v, cls, lambda r: panel(r, raises={cls: t})) for h, v in halves.items()}
        m, w = res['main']['held-out'], res['withRule']['held-out']
        res['adopted'] = (w['precision'] or 0) > (m['precision'] or 0) and (w['recall'] or 0) >= BAR
        if res['adopted']: out['adopted']['raise'][RAISE[cls]] = t
    out['raise'][cls] = res
print(json.dumps(out, indent=1))
