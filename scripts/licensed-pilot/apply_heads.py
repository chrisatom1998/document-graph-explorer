"""Put pilot heads into public/sound-model/learned.json, the way scripts/dj-effects/ship.py does.

Usage: python3 -I scripts/licensed-pilot/apply_heads.py <heads.json> <plan.json>
plan.json: {"revisionTag": "...", "heads": {"<label>": {"maybe": true, "oneShot": false, "replace": false}}}
A label that already has a head is only touched with "replace": true (the plan records why, from score_app.py on the
locked holdout). Heads are appended, never reordered. Writes the split head files, does not pin learned.json in manifest.json, appends the revision tag,
and rewrites src/audio/calibratedLabels.json (the union of learned and short-clip head labels, as the tests require).
INSTRUMENT_ANALYSIS_REVISION in src/audio/musicTypes.ts is bumped by hand in the same commit.
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from learned_store import load_learned, write_learned, drop_learned_pin

HEADS, PLAN = sys.argv[1:3]
LEARNED, MANIFEST = 'public/sound-model/learned.json', 'public/sound-model/manifest.json'
plan = json.load(open(PLAN)); trained = {h['label']: h for h in json.load(open(HEADS))['heads']}
model = load_learned(LEARNED)
cats = {(c['group'], c['label']) for c in json.load(open('src/audio/djCatalog.json'))['categories']}
for label, how in plan['heads'].items():
    h = dict(trained[label])
    assert (h['group'], label) in cats, f'{label} is not a catalog label'
    assert len(h['weights']) == 512 and 0.5 <= h['threshold'] <= 1, f'{label}: malformed head'
    current = [x for x in model['heads'] if x['label'] == label]
    if current and not how.get('replace'): sys.exit(f'{label} already has a head; set "replace" only with holdout evidence')
    model['heads'] = [x for x in model['heads'] if x['label'] != label]
    if how.get('maybe'): h['maybe'] = True
    if how.get('oneShot'): h['oneShot'] = True
    model['heads'].append(h)
    print(f"{label}: {'replaced' if current else 'added'} ({'maybe' if how.get('maybe') else 'full'}{', one-shots too' if how.get('oneShot') else ''})")
model['revision'] += '+' + plan['revisionTag']
digest = write_learned(LEARNED, model)
drop_learned_pin(MANIFEST)
labels = sorted({x['label'] for x in load_learned(LEARNED)['heads']} | {x['label'] for x in json.load(open('public/sound-model/short-clip.json'))['heads']})
open('src/audio/calibratedLabels.json', 'w').write(json.dumps(labels, indent=0) + '\n')
print(f"learned heads integrity {digest[:12]}, {len(model['heads'])} heads, revision {model['revision']}")
