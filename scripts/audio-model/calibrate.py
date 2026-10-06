"""Per-tag thresholds for DGE's trained tagger, chosen on the validation artists only (train.py holds them out).

Usage: python3 scripts/audio-model/calibrate.py <run-dir> <openmic-prep-dir> [<jamendo-prep-dir>]

For each class, the threshold maximises min(precision, recall) on OpenMIC validation clips with explicit labels (ties:
higher F1), because DGE's bar is precision AND recall >= 0.70. Jamendo validation windows add recall checks (uploader
tags are positives only) and voice precision (three-annotator agreement). A class with fewer than 10 validation
positives is marked untested and left off. Writes <run-dir>/thresholds.json.
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))

run, openmic, *rest = sys.argv[1:]
log = json.load(open(os.path.join(run, 'log.json'))); classes = log['classes']

def labels(prep, name, ids, keep_weak=False):
    items = {it['id']: it for it in json.load(open(os.path.join(prep, name)))['items']}
    y = np.full((len(ids), len(classes)), np.nan, np.float32)
    for i, k in enumerate(ids):
        it = items[k]; weak = set(it.get('weakAbsent', []))
        for c, r in it['labels'].items():
            if c in classes and (keep_weak or c not in weak): y[i, classes.index(c)] = float(r >= 0.5)
    return y

y_om = labels(openmic, 'train.json', log['val']['openmic']); s_om = np.load(os.path.join(run, 'val-openmic.npy'))
y_mj = s_mj = None
if rest and 'jamendo' in log['val']:
    y_mj = labels(rest[0], 'jamendo.json', log['val']['jamendo']); s_mj = np.load(os.path.join(run, 'val-jamendo.npy'))
    y_mjw = labels(rest[0], 'jamendo.json', log['val']['jamendo'], keep_weak=True)

def pr(y, s, t):
    k = ~np.isnan(y); y, s = y[k], s[k]; hit = s >= t
    tp = int((hit & (y == 1)).sum()); fp = int((hit & (y == 0)).sum()); pos = int((y == 1).sum())
    return (tp / (tp + fp) if tp + fp else None), (tp / pos if pos else None), pos, int((y == 0).sum())

out = {}
for j, c in enumerate(classes):
    jam = c.startswith('jamendo:')
    if jam and y_mj is None: out[c] = {'enabled': False, 'reason': 'no Jamendo validation data'}; continue
    # Jamendo's own tags have only uploader positives; untagged counts as absent, so precision is a lower bound.
    y, s = (y_mjw[:, j], s_mj[:, j]) if jam else (y_om[:, j], s_om[:, j]); k = ~np.isnan(y)
    pos = int((y[k] == 1).sum())
    if pos < 10 or (y[k] == 0).sum() < 10:
        out[c] = {'enabled': False, 'reason': f'{pos} validation positives, {int((y[k] == 0).sum())} negatives'}; continue
    best = None
    for t in np.unique(np.round(s[k], 4)):
        p, r, _, _ = pr(y, s, t)
        if p is None: continue
        key = (min(p, r), 2 * p * r / (p + r) if p + r else 0)
        if best is None or key > best[0]: best = (key, float(t), p, r)
    _, t, p, r = best
    if jam:
        out[c] = {'enabled': True, 'threshold': round(t, 4), 'precisionIsLowerBound': True,
                  'jamendoVal': {'precision': round(p, 3), 'recall': round(r, 3), 'positives': pos, 'negatives': int((y[k] == 0).sum())}}; continue
    row = {'enabled': True, 'threshold': round(t, 4), 'openmicVal': {'precision': round(p, 3), 'recall': round(r, 3), 'positives': pos, 'negatives': int((y[k] == 0).sum())}}
    if y_mj is not None and (~np.isnan(y_mj[:, j])).any():
        pj, rj, posj, negj = pr(y_mj[:, j], s_mj[:, j], t)
        row['jamendoVal'] = {'precision': None if pj is None or negj == 0 else round(pj, 3), 'recall': None if rj is None else round(rj, 3), 'positives': posj, 'negatives': negj}
    out[c] = row
json.dump(out, open(os.path.join(run, 'thresholds.json'), 'w'), indent=1)
for c, r in out.items():
    print(f'{c:18s}', 'off: ' + r['reason'] if not r['enabled'] else f"t={r['threshold']:.3f}  " + ' '.join(f"{k[:-3]} val P {v['precision']} R {v['recall']} ({v['positives']} pos)" for k, v in r.items() if k.endswith('Val'))
)
