"""Are Surge 'bass' presets played high the reason the short-clip bass-hit head fails?

534 of 580 development bass-hit positives are Surge renders labelled from the preset's folder (Bass/Basses),
but the rendered notes span MIDI 40-76, many at or above middle C, where a bass patch no longer sounds like a bass.
This re-labels IN MEMORY only. No shared file changes: train-items-surge.json, short-clip.json and
development-selection.json are left alone (another session is measuring v2 on the frozen test split).

Variants, all fixed before any result was read (cutoff MIDI 52 = E3, not swept):
  current  labels as built by scripts/short-clip-surge-train.py
  A        Surge Bass/Basses notes above MIDI 52 -> bass hit unknown (dropped from this head)
  B        A, plus Surge non-bass presets at MIDI 52 or below -> bass hit unknown (register-ambiguous negatives)

Evidence: overall numbers move whenever positives are removed, so they are reported but are not evidence.
The comparison that counts uses the clips whose labels never change (Freesound + NSynth, 46 positives):
a variant counts as a fix only if it finds at least 5 more of those 46 at its selected threshold with at most
2 more false detections on the same unchanged negatives. Same grouped 5-fold procedure and C grid as
scripts/train-short-clip-heads.py. Test split never read. Nothing is exported.

Usage: <venv>/python scripts/short-clip-bass-relabel.py > docs/evaluations/short-clips-2026-10-04/bass-relabel.json
"""
import importlib.util, json, os, re, sys, datetime
import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), '..')
CAT, CUTOFF, Cs = 'role:bass hit', 52, (0.03, 0.3)
spec = importlib.util.spec_from_file_location('heads', f'{ROOT}/scripts/train-short-clip-heads.py')
sys.argv = [sys.argv[0], 'import-only']; heads = importlib.util.module_from_spec(spec); spec.loader.exec_module(heads)

surge = lambda i: i['groups']['original'].startswith('surge:')
midi = lambda i: int(re.search(r'(\d+)', i['meta']['note']).group(1))
is_bass_preset = lambda i: i['meta']['category'] in ('Bass', 'Basses')
assert all('meta' in i for i in heads.DEV if surge(i)), 'Surge items need meta.note and meta.category'

def labels(variant):
    out = []
    for i, lab in zip(heads.DEV, heads.DEV_LAB):
        lab = dict(lab)
        if surge(i) and CAT in lab:
            if variant in ('A', 'B') and is_bass_preset(i) and midi(i) > CUTOFF: lab.pop(CAT)
            if variant == 'B' and not is_bass_preset(i) and midi(i) <= CUTOFF: lab.pop(CAT)
        out.append(lab)
    return out

X, _ = heads.matrix(heads.DEV, ['clapRepeat'])
fixed = np.array([not surge(i) for i in heads.DEV])

def run(variant):
    lab = labels(variant)
    m = np.array([CAT in l for l in lab]); y = np.array([l.get(CAT) == 'present' for l in lab])[m]
    best = None
    for C in Cs:
        p = heads.oof(X[m], y, heads.DEV_GROUPS[m], C); t, P, R, _, f1 = heads.pick_threshold(p, y)
        if best is None or (P >= heads.TARGET and R >= heads.TARGET, f1) > (best[2] >= heads.TARGET and best[3] >= heads.TARGET, best[4]):
            best = (C, t, P, R, f1, p)
    C, t, P, R, f1, p = best
    hit, fx = p >= t, fixed[m]
    yf, hf = y[fx], hit[fx]
    return dict(C=C, threshold=round(float(t), 4), overall=dict(precision=round(float(P), 3), recall=round(float(R), 3), f1=round(float(f1), 3),
                                                              pos=int(y.sum()), neg=int((~y).sum())),
                unchangedClips=dict(found=int((yf & hf).sum()), positives=int(yf.sum()), falseDetections=int((hf & ~yf).sum()), negatives=int((~yf).sum())))

res = {v: run(v) for v in ('current', 'A', 'B')}
# Where today's Surge false detections sit, by note register (diagnostic for variant B).
lab0 = labels('current'); m0 = np.array([CAT in l for l in lab0]); y0 = np.array([l.get(CAT) == 'present' for l in lab0])[m0]
p0 = heads.oof(X[m0], y0, heads.DEV_GROUPS[m0], res['current']['C']); items0 = [i for i, k in zip(heads.DEV, m0) if k]
fd = [i for i, h, yy in zip(items0, p0 >= res['current']['threshold'], y0) if h and not yy and surge(i)]
base = res['current']['unchangedClips']
verdict = {v: (res[v]['unchangedClips']['found'] - base['found'] >= 5 and res[v]['unchangedClips']['falseDetections'] - base['falseDetections'] <= 2)
           for v in ('A', 'B')}
print(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'category': CAT, 'cutoffMidi': CUTOFF, 'features': ['clapRepeat'],
                  'note': 'labels changed in memory only; grouped 5-fold out-of-fold over train + Surge train + calibration; test never read; nothing exported',
                  'rule': 'fix = >= 5 more of the unchanged (Freesound + NSynth) positives found, <= 2 more false detections on unchanged negatives',
                  'isFix': verdict, 'results': res,
                  'surgeFalseDetectionsToday': {'total': len(fd), 'atOrBelowCutoff': sum(midi(i) <= CUTOFF for i in fd),
                                                'byCategory': {c: sum(i['meta']['category'] == c for i in fd) for c in sorted({i['meta']['category'] for i in fd})}}},
                 indent=1))
for v, r in res.items():
    print(f"{v:8s} overall {r['overall']} | unchanged {r['unchangedClips']}", file=sys.stderr)
print('isFix', verdict, file=sys.stderr)
