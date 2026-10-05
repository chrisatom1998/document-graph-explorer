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

Low-sound check (added after A and B were read, to test the one risk B creates: removing low lead/pluck
negatives could turn the head into a 'low pitch' detector). Each variant's head, at its own threshold, is scored on
  - clips with bass hit unknown but kick, impact or drums present (full-fit head; these never trained this head)
  - NSynth calibration notes that are not bass, at MIDI 52 or below (out-of-fold; they are labelled negatives)
If B tags these clearly more often than A, A is the recommendation.

Variant Bk (added 2026-10-05 after the above were read; A fails 70/70, B tags 10 of 152 kick/impact/drum clips):
  Bk       B, plus every development clip with bass hit unknown and kick present -> bass hit absent
           (a definition: a kick drum is never a bass hit; booms and impacts stay unknown).
Low-sound check for Bk scores kicks out-of-fold, since they are now training negatives.
Ship rule for Bk, fixed before it was run: ALL of
  - overall development precision >= 0.70 and recall >= 0.70 (the export rule)
  - at least 35 of the 46 unchanged positives found
  - at most 2 of the 152 kick/impact/drum clips tagged

Bk was then applied for real (short-clip-surge-train.py register rule, train-short-clip-heads.py kick rule), so
re-running this now starts from Bk labels; bass-relabel.json is the record of the comparison above.

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
            if variant in ('A', 'B', 'Bk') and is_bass_preset(i) and midi(i) > CUTOFF: lab.pop(CAT)
            if variant in ('B', 'Bk') and not is_bass_preset(i) and midi(i) <= CUTOFF: lab.pop(CAT)
        if variant == 'Bk' and CAT not in lab and lab.get('role:kick') == 'present': lab[CAT] = 'absent'
        out.append(lab)
    return out

X, _ = heads.matrix(heads.DEV, ['clapRepeat'])
# Clips whose bass-hit label is the same in every variant: non-Surge and labelled in the original data.
fixed = np.array([not surge(i) and CAT in l for i, l in zip(heads.DEV, heads.DEV_LAB)])
item_meta = json.load(open(f'{ROOT}/docs/evaluations/short-clips-2026-10-04/item-meta.json'))
def dataset(i):
    o = i['groups']['original']
    return 'nsynth' if o.startswith('nsynth') or item_meta.get(i['id'], {}).get('dataset') == 'nsynth' else 'fsd50k' if o.startswith('freesound') else o.split(':')[0]
nonsurge_dataset = {i['id']: dataset(i) for i in heads.DEV if not surge(i)}
LAB0 = [dict(l) for l in heads.DEV_LAB]
low_drum = np.array([CAT not in l and any(l.get(k) == 'present' for k in ('role:kick', 'role:impact', 'source:drums')) for l in LAB0])
low_note = np.array([item_meta.get(i['id'], {}).get('dataset') == 'nsynth' and l.get(CAT) == 'absent' and item_meta[i['id']]['midiPitch'] <= CUTOFF
                     for i, l in zip(heads.DEV, LAB0)])

def run_low_check(lab, m, y, p, t, C):
    # Clips this variant trains on are scored out-of-fold; the rest by the head fitted on all labelled clips.
    oof_hit = np.zeros(len(heads.DEV), bool); oof_hit[np.where(m)[0]] = p >= t
    tagged = np.where(m, oof_hit, heads.fit(X[m], y, C).predict_proba(X)[:, 1] >= t)[low_drum]
    return dict(kickImpactDrumsUnknownBass=dict(tagged=int(tagged.sum()), clips=int(low_drum.sum()), rate=round(float(tagged.mean()), 4),
                                                scoredOutOfFold=int(m[low_drum].sum())),
                nsynthNonBassAtOrBelowCutoff=dict(tagged=int(oof_hit[low_note].sum()), clips=int(low_note.sum())))

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
    ids = [i['id'] for i, k in zip(heads.DEV, m) if k]
    found = [i for i, h, yy in zip(ids, hit, y) if h and yy and i in nonsurge_dataset]
    low = run_low_check(lab, m, y, p, t, C)
    return dict(lowSoundCheck=low, foundUnchangedByDataset={d: sum(nonsurge_dataset[i] == d for i in found) for d in ('fsd50k', 'nsynth')},
                positivesUnchangedByDataset={d: sum(nonsurge_dataset[i] == d for i, yy in zip(ids, y) if yy and i in nonsurge_dataset) for d in ('fsd50k', 'nsynth')},
                **dict(C=C, threshold=round(float(t), 4), overall=dict(precision=round(float(P), 3), recall=round(float(R), 3), f1=round(float(f1), 3),
                                                              pos=int(y.sum()), neg=int((~y).sum())),
                unchangedClips=dict(found=int((yf & hf).sum()), positives=int(yf.sum()), falseDetections=int((hf & ~yf).sum()), negatives=int((~yf).sum()))))

res = {v: run(v) for v in ('current', 'A', 'B', 'Bk')}
# Where today's Surge false detections sit, by note register (diagnostic for variant B).
lab0 = labels('current'); m0 = np.array([CAT in l for l in lab0]); y0 = np.array([l.get(CAT) == 'present' for l in lab0])[m0]
p0 = heads.oof(X[m0], y0, heads.DEV_GROUPS[m0], res['current']['C']); items0 = [i for i, k in zip(heads.DEV, m0) if k]
fd = [i for i, h, yy in zip(items0, p0 >= res['current']['threshold'], y0) if h and not yy and surge(i)]
base = res['current']['unchangedClips']
verdict = {v: (res[v]['unchangedClips']['found'] - base['found'] >= 5 and res[v]['unchangedClips']['falseDetections'] - base['falseDetections'] <= 2)
           for v in ('A', 'B')}
bk = res['Bk']
ships_bk = (bk['overall']['precision'] >= .70 and bk['overall']['recall'] >= .70 and bk['unchangedClips']['found'] >= 35
            and bk['lowSoundCheck']['kickImpactDrumsUnknownBass']['tagged'] <= 2)
print(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'category': CAT, 'cutoffMidi': CUTOFF, 'features': ['clapRepeat'],
                  'note': 'labels changed in memory only; grouped 5-fold out-of-fold over train + Surge train + calibration; test never read; nothing exported',
                  'rule': 'fix = >= 5 more of the unchanged (Freesound + NSynth) positives found, <= 2 more false detections on unchanged negatives',
                  'isFix': verdict, 'BkShipRule': 'overall P and R >= 0.70, >= 35 of 46 unchanged positives, <= 2 of 152 kick/impact/drum clips tagged',
                  'BkShips': ships_bk, 'results': res,
                  'surgeFalseDetectionsToday': {'total': len(fd), 'atOrBelowCutoff': sum(midi(i) <= CUTOFF for i in fd),
                                                'byCategory': {c: sum(i['meta']['category'] == c for i in fd) for c in sorted({i['meta']['category'] for i in fd})}}},
                 indent=1))
for v, r in res.items():
    print(f"{v:8s} overall {r['overall']} | unchanged {r['unchangedClips']} {r['foundUnchangedByDataset']} of {r['positivesUnchangedByDataset']} | low {r['lowSoundCheck']}", file=sys.stderr)
print('isFix', verdict, 'BkShips', ships_bk, file=sys.stderr)
