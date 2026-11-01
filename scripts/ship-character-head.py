"""Swaps one character head in public/sound-model/learned.json for a setup from train-character-hardneg.py.

It ships as a faded "maybe" tag unless `full` is given; `full` is refused unless the setup passed the pass bar
recorded in the report (60/60 since 2026-10-05) on held-out uploaders. Writes that head's file and does not pin manifest.json.
Setup "none" removes the head instead, for a label where no setup reaches 50% precision.
Usage: ship-character-head.py <character-hardneg.json> <label> <setup|none> [full]"""
import json, sys, re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from learned_store import load_learned, write_learned, drop_learned_pin

REPORT, LABEL, SETUP = sys.argv[1:4]; FULL = sys.argv[4:5] == ['full']
path = 'public/sound-model/learned.json'; model = load_learned(path)
at = next(i for i, h in enumerate(model['heads']) if h['label'] == LABEL)
if SETUP == 'none':
    del model['heads'][at]
else:
    s = next(r for r in json.load(open(REPORT))['results'] if r['label'] == LABEL)['setups'][SETUP]
    if FULL and not s['passes']: sys.exit(f"{LABEL} '{SETUP}' did not pass the bar ({s['precision']:.0%}/{s['recall']:.0%}); not shipping as a full tag")
    model['heads'][at] = {'group': 'character', 'label': LABEL, **s['head'], 'threshold': round(s['threshold'], 4), **({} if FULL else {'maybe': True})}
model['revision'] = re.sub(rf'\+hardneg-{LABEL}-[a-z]+', '', model['revision']) + f'+hardneg-{LABEL}-{SETUP}'
write_learned(path, model)
drop_learned_pin()
print(f"{LABEL}: " + ('head removed' if SETUP == 'none' else f"shipped '{SETUP}' as {'full tag' if FULL else 'maybe'} (test precision {s['precision']:.0%}, recall {s['recall']:.0%}, threshold {s['threshold']})") + f"; {len(model['heads'])} heads, revision {model['revision']}")
