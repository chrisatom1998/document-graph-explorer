"""Per-label scorecard for every djCatalog label: what ships today (learned.json / short-clip.json, full or maybe),
plus the best held-out measurement from a training round (precision, recall, support, where it was tested).
Buckets use the 45/45 bar (full tags also meet 60/60). Usage: open-vocab-scorecard.py <round.json> <out.json> [baseline-learned.json]"""
import json, sys, subprocess
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from learned_store import load_learned
ROUND, OUT = sys.argv[1:3]
cat = json.load(open('src/audio/djCatalog.json'))['categories']
learned = {h['label']: h for h in load_learned()['heads']}
short = {h['label'] for h in json.load(open('public/sound-model/short-clip.json'))['heads']}
base = set()
if len(sys.argv) > 3:
    shown = json.loads(subprocess.check_output(['git', 'show', sys.argv[3]]))
    shown_heads = shown.get('heads') or []
    if shown_heads and isinstance(shown_heads[0], str):
        sys.exit('baseline learned.json is a split index; pass a monolithic learned.json')
    base = {h['label'] for h in shown_heads} | short
OWNED = {'reversed vocal', 'pitched vocal', 'vocoder vocal', 'reverse cymbal', 'reverse impact', 'record stop', 'sub drop', 'noise', 'vinyl crackle',
         'animal sound', 'bell', 'glockenspiel', 'tuned percussion', 'breath', 'vocal shout', 'hi-hat', 'cymbal', 'voice', 'turntable',
         'machine ambience', 'foley', 'hand percussion', 'environmental sound', 'dry', 'distorted', 'reverberant', 'echoing', 'filtered'}
res = {}
for r in json.load(open(ROUND))['results']:
    if r['name'] in res and 'precision' in res[r['name']]: continue
    res[r['name']] = r
rows = []
for c in cat:
    l = c['label']; r = res.get(l, {}); h = learned.get(l)
    shipped = 'full' if (h and not h.get('maybe')) or l in short else 'maybe' if h else None
    P, R, n = r.get('precision'), r.get('recall'), r.get('testPositive', 0)
    if shipped: bucket = f'active ({shipped})'
    elif l in OWNED: bucket = 'other session'
    elif 'precision' not in r: bucket = 'untestable (too few clips)'
    elif r.get('testedOn') not in ('real recordings', 'library brands'): bucket = 'made-up clips only'
    elif min(P, R) >= .45: bucket = 'passes, not shipped'
    elif P >= .45 or R >= .45: bucket = 'near'
    else: bucket = 'failing'
    rows.append({'label': l, 'group': c['group'], 'family': c['family'], 'bucket': bucket, 'shipped': shipped, 'activeBefore': l in base,
                 'precision': None if P is None else round(P, 3), 'recall': None if R is None else round(R, 3), 'testPositive': n,
                 'tp': r.get('tp'), 'testedOn': r.get('testedOn'), 'verdict': r.get('verdict')})
from collections import Counter
summary = {'labels': len(rows), 'activeNow': sum(1 for x in rows if x['shipped']), 'activeBefore': sum(1 for x in rows if x['activeBefore']),
           'buckets': dict(Counter(x['bucket'] for x in rows))}
json.dump({'kind': 'open-vocab-scorecard-v1', 'round': ROUND.split('/')[-1], 'bar': '45/45 (full = 60/60)', 'summary': summary, 'labels': rows}, open(OUT, 'w'), indent=1)
print(json.dumps(summary, indent=1))
