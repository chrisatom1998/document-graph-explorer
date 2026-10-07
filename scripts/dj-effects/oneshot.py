"""Clears shipped DJ-effect heads for whole clips of at most the one-shot length (short-clip.json maxSeconds).

The app scores those clips with one-shot heads only, unless a learned.json head carries oneShot: true
(musicAnalysis.worker.ts). A shipped DJ-effect head is cleared when, on the held-out clips that short (train.py
"heldOutOneShot", same threshold), it has at least MIN_POSITIVES positives, precision >= 0.45 and recall >= 0.30 (the
maybe floor in ship.py), and beats the label's short-clip.json head on the same clips if one exists (higher min(P, R),
then F1). Re-pins learned.json in manifest.json.  Usage: oneshot.py <dir with report.json + heads.json>"""
import json, sys, hashlib
D = sys.argv[1]
MIN_POSITIVES = 10
LEARNED, MANIFEST = 'public/sound-model/learned.json', 'public/sound-model/manifest.json'
report = json.load(open(f'{D}/report.json'))['labels']
trained = {h['label']: h for h in json.load(open(f'{D}/heads.json'))['heads']}
model = json.load(open(LEARNED))
key = lambda P, R: (min(P, R), 2 * P * R / (P + R) if P + R else 0.0)
cleared = []
for head in model['heads']:
    label = head['label']; e = report.get(label, {}); o = e.get('heldOutOneShot') or {}
    new = trained.get(label)
    if not new or new['weights'] != head['weights']:
        continue   # not one of the shipped DJ-effect heads
    why = None
    if o.get('positives', 0) < MIN_POSITIVES: why = f"{o.get('positives', 0)} held-out one-shot positives"
    elif o['precision'] < .45 or o['recall'] < .30: why = f"one-shot P {o['precision']:.2f} R {o['recall']:.2f}"
    else:
        sc = next((c for c in e.get('current', []) if c['file'] == 'short-clip.json'), None)
        if sc and key(o['precision'], o['recall']) <= key(sc['precision'], sc['recall']):
            why = f"short-clip head is as good (P {sc['precision']:.2f} R {sc['recall']:.2f})"
    head.pop('oneShot', None)
    if why is None:
        head['oneShot'] = True; cleared.append(label)
    print(f"{label:<16}" + ('cleared for one-shots' if why is None else f'not cleared: {why}') +
          (f"  (one-shot P {o['precision']:.2f} R {o['recall']:.2f}, {o['positives']}+/{o['negatives']}-)" if o.get('positives') else ''))
if cleared and '+oneshot' not in model['revision']:
    model['revision'] += '+oneshot'
body = json.dumps(model, separators=(',', ':')) + '\n'
open(LEARNED, 'w').write(body)
man = json.load(open(MANIFEST)); man['sha256']['learned.json'] = hashlib.sha256(body.encode()).hexdigest()
open(MANIFEST, 'w').write(json.dumps(man, indent=2) + '\n')
print(f'{len(cleared)} heads cleared for one-shots: {cleared}')
