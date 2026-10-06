"""Per-tag thresholds for DGE's trained tagger, chosen on the validation artists only (train.py holds them out).

Usage: python3 scripts/audio-model/calibrate.py <run-dir> openmic=<prep-dir> [jamendo=<prep-dir>] [soundcloud=<dir>] [fsd50k=<dir>] [nsynth=<dir>]

For each output, the threshold maximises min(precision, recall) on validation clips (ties: higher F1), because DGE's
bar is precision AND recall >= 0.70:
  * OpenMIC's 20 classes: OpenMIC validation clips with explicit labels; Jamendo validation is reported at that threshold.
  * Jamendo's own 40 tags: Jamendo validation, where untagged counts as absent, so precision is a lower bound.
  * the app-named outputs ('cat:<label>'): every source's validation clips that label it outright (FSD50K, NSynth and
    its effect renders, and the music sources where they name the same sound); weak absences are left out, except for
    the tags only Freesound teaches, where untagged sounds count as absent (precision is then a lower bound).
An output with fewer than 10 validation positives or negatives is marked untested and left off. Writes <run-dir>/thresholds.json.
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import train  # noqa: E402
from labelmap import FREESOUND  # noqa: E402

run, *pairs = sys.argv[1:]
preps = dict(p.split('=', 1) for p in pairs)
FILES = {'openmic': ('train-mel.npy', 'train.json'), 'jamendo': ('jamendo-mel.npy', 'jamendo.json'), 'soundcloud': ('soundcloud-mel.npy', 'soundcloud.json'),
         'fsd50k': ('fsd50k-mel.npy', 'fsd50k.json'), 'nsynth': ('nsynth-mel.npy', 'nsynth.json'), 'freesound': ('freesound-mel.npy', 'freesound.json')}
log = json.load(open(os.path.join(run, 'log.json'))); classes = log['classes']
assert classes == train.CLASSES, 'run was trained with a different class list'
val = {}
for name, ids in log['val'].items():
    if name not in preps: continue
    mel, js = FILES[name]; items = {it['id']: it for it in json.load(open(os.path.join(preps[name], js)))['items']}
    src = train.load_source(name, os.path.join(preps[name], mel), [items[i] for i in ids], 1.0)
    val[name] = (src['y'], src['w'], np.load(os.path.join(run, f'val-{name}.npy')))

def pr(y, s, t):
    hit = s >= t; tp = int((hit & (y == 1)).sum()); fp = int((hit & (y == 0)).sum()); pos = int((y == 1).sum())
    return (tp / (tp + fp) if tp + fp else None), (tp / pos if pos else None), pos, int((y == 0).sum())

def pick(y, s):
    best = None
    for t in np.unique(np.round(s, 4)):
        p, r, _, _ = pr(y, s, t)
        if p is None: continue
        key = (min(p, r), 2 * p * r / (p + r) if p + r else 0)
        if best is None or key > best[0]: best = (key, float(t), p, r)
    return best[1:]

def view(name, j, keep_weak):
    y, w, s = val[name]; k = w[:, j] > 0 if keep_weak else w[:, j] >= 1
    return y[k, j], s[k, j]

out = {}
for j, c in enumerate(classes):
    if c.startswith('jamendo:'): fit = [('jamendo', True)] if 'jamendo' in val else []
    # Freesound-only tags have no outright absences (uploaders tag selectively): its untagged sounds count as absent,
    # so precision is a lower bound, as with Jamendo's tags.
    elif c.startswith('cat:'): fit = [(n, n == 'freesound' and c[4:] in FREESOUND) for n in val]
    else: fit = [('openmic', False)]
    ys, ss = zip(*[view(n, j, kw) for n, kw in fit]) if fit else ((), ())
    y = np.concatenate(ys) if ys else np.zeros(0); s = np.concatenate(ss) if ss else np.zeros(0)
    pos, neg = int((y == 1).sum()), int((y == 0).sum())
    if pos < 10 or neg < 10: out[c] = {'enabled': False, 'reason': f'{pos} validation positives, {neg} negatives'}; continue
    t, p, r = pick(y, s)
    row = {'enabled': True, 'threshold': round(t, 4), 'fitOn': [n for n, _ in fit], 'val': {'precision': round(p, 3), 'recall': round(r, 3), 'positives': pos, 'negatives': neg}}
    if any(kw for _, kw in fit): row['precisionIsLowerBound'] = True
    for n in val:   # each source's own view at the chosen threshold
        yn, sn = view(n, j, n == 'jamendo' or (n == 'freesound' and c[4:] in FREESOUND))
        if (yn == 1).sum() or (yn == 0).sum():
            pn, rn, posn, negn = pr(yn, sn, t)
            row[f'{n}Val'] = {'precision': None if pn is None or negn == 0 else round(pn, 3), 'recall': None if rn is None else round(rn, 3), 'positives': posn, 'negatives': negn}
    out[c] = row
json.dump(out, open(os.path.join(run, 'thresholds.json'), 'w'), indent=1)
for c, r in out.items():
    print(f'{c:26s}', 'off: ' + r['reason'] if not r['enabled'] else f"t={r['threshold']:.3f}  val P {r['val']['precision']} R {r['val']['recall']} ({r['val']['positives']} pos)  " +
          ' '.join(f"{k[:-3]} P {v['precision']} R {v['recall']} ({v['positives']})" for k, v in r.items() if k.endswith('Val')))
