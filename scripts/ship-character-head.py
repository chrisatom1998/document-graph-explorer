"""Swaps one character head in public/sound-model/learned.json for a setup from train-character-hardneg.py.

It always ships as a faded "maybe" tag: these setups are judged on folder labels that a listening check
showed are unreliable, so no score here earns a full tag. Re-pins the learned.json hash in manifest.json.
Setup "none" removes the head instead, for a label where no setup reaches 50% precision.
Usage: ship-character-head.py <character-hardneg.json> <label> <setup|none>"""
import json, sys, hashlib, re

REPORT, LABEL, SETUP = sys.argv[1:4]
path = 'public/sound-model/learned.json'; model = json.load(open(path))
at = next(i for i, h in enumerate(model['heads']) if h['label'] == LABEL)
if SETUP == 'none':
    del model['heads'][at]
else:
    s = next(r for r in json.load(open(REPORT))['results'] if r['label'] == LABEL)['setups'][SETUP]
    model['heads'][at] = {'group': 'character', 'label': LABEL, **s['head'], 'threshold': round(s['threshold'], 4), 'maybe': True}
model['revision'] = re.sub(rf'\+hardneg-{LABEL}-[a-z]+', '', model['revision']) + f'+hardneg-{LABEL}-{SETUP}'
body = json.dumps(model, separators=(',', ':')) + '\n'
open(path, 'w').write(body)
mp = 'public/sound-model/manifest.json'; man = json.load(open(mp)); man['sha256']['learned.json'] = hashlib.sha256(body.encode()).hexdigest()
open(mp, 'w').write(json.dumps(man, indent=2) + '\n')
print(f"{LABEL}: " + ('head removed' if SETUP == 'none' else f"shipped '{SETUP}' as maybe (test precision {s['precision']:.0%}, recall {s['recall']:.0%}, threshold {s['threshold']})") + f"; {len(model['heads'])} heads, revision {model['revision']}")
