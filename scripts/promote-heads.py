"""Turns maybe tags into full tags for the named heads, only where head-scorecard.py says they pass the full bar.

Read the scorecard first: a head can be a maybe tag for reasons the score does not show (instrument heads were
kept as maybe because they transfer poorly to real sample libraries), so heads are promoted by name, never in bulk.
Does not pin learned.json in manifest.json. REVISION_TAG (default promoted-50) names the revision suffix.
Usage: promote-heads.py <head-scorecard.json> <label> [label ...]"""
import json, sys, os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from learned_store import load_learned, write_learned, drop_learned_pin

card = {h['label']: h for h in json.load(open(sys.argv[1]))['heads']}
path = 'public/sound-model/learned.json'; model = load_learned(path)
for label in sys.argv[2:]:
    c = card.get(label)
    if not c or c.get('should') != 'full': sys.exit(f'{label}: scorecard does not support a full tag ({c and c.get("verdict")})')
    head = next(h for h in model['heads'] if h['label'] == label)
    head.pop('maybe', None)
    print(f"{label}: full tag ({c['precision']:.0%} / {c['recall']:.0%}, {c['source']})")
model['revision'] += '+' + os.environ.get('REVISION_TAG', 'promoted-50')
write_learned(path, model)
drop_learned_pin()
