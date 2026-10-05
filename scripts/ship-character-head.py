"""Swaps one character head in public/sound-model/learned.json for a setup from train-character-hardneg.py.

It always ships as a faded "maybe" tag: these setups are judged on folder labels that a listening check
showed are unreliable, so no score here earns a full tag. Re-pins the learned.json hash in manifest.json.
Usage: ship-character-head.py <character-hardneg.json> <label> <setup>"""
import json, sys, hashlib

REPORT, LABEL, SETUP = sys.argv[1:4]
row = next(r for r in json.load(open(REPORT))['results'] if r['label'] == LABEL)
s = row['setups'][SETUP]
path = 'public/sound-model/learned.json'; model = json.load(open(path))
head = {'group': 'character', 'label': LABEL, **s['head'], 'threshold': round(s['threshold'], 4), 'maybe': True}
at = next(i for i, h in enumerate(model['heads']) if h['label'] == LABEL)
model['heads'][at] = head
model['revision'] = model['revision'].split('+hardneg')[0] + f'+hardneg-{LABEL}-{SETUP}'
body = json.dumps(model, separators=(',', ':')) + '\n'
open(path, 'w').write(body)
mp = 'public/sound-model/manifest.json'; man = json.load(open(mp)); man['sha256']['learned.json'] = hashlib.sha256(body.encode()).hexdigest()
open(mp, 'w').write(json.dumps(man, indent=2) + '\n')
print(f"{LABEL}: shipped '{SETUP}' as maybe (test precision {s['precision']:.0%}, recall {s['recall']:.0%}, threshold {s['threshold']}); revision {model['revision']}")
