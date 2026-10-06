"""Freeze the TinySOL test: isolated orchestral notes, a clean JUDGE-ONLY set for 11 app tags.

Usage: python3 scripts/all-tags/select-tinysol.py <TinySOL_metadata.csv> [<extracted TinySOL dir> <audio-out-dir>]

TinySOL v6 (zenodo.org/records/3685367, CC-BY-4.0): 2913 single notes by 14 instruments, all "ordinario". No DGE script
has used it (training or tuning), and the "Train an audio model" thread was asked to keep it out. Nothing is tuned on it.
Each recording is exactly one named instrument, so labels are strong both ways: a note is present for its own tag and
absent for every tag of a different instrument family. Viola, contrabass and tuba have no app tag of their own; they are
negatives for the wind and brass tags, and left unknown for violin / cello (a string player could plausibly hear those).
Selection: per instrument, up to PER_INSTRUMENT notes in hash order, so every instrument has a similar weight.
With the extracted archive, copies the chosen notes to <audio-out-dir>/<id>.wav.
"""
import csv, hashlib, json, os, shutil, sys

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'docs', 'evaluations', 'all-tags-2026-10-06')
SEED, PER_INSTRUMENT = 'dge-all-tags-tinysol-2026-10-06', 60
TAG = {'Accordion': 'accordion', 'Cello': 'cello', 'Violin': 'violin / fiddle', 'French Horn': 'horn', 'Bassoon': 'bassoon',
       'Clarinet in Bb': 'clarinet', 'Flute': 'flute', 'Trombone': 'trombone', 'Oboe': 'oboe', 'Alto Saxophone': 'saxophone',
       'Trumpet in C': 'trumpet', 'Viola': None, 'Contrabass': None, 'Bass Tuba': None}
STRINGS = {'Violin', 'Viola', 'Cello', 'Contrabass'}
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
rows = list(csv.DictReader(open(sys.argv[1], encoding='utf-8')))
chosen = []
for inst in TAG:
    chosen += sorted((r for r in rows if r['Instrument (in full)'] == inst), key=lambda r: h(SEED, r['Path']))[:PER_INSTRUMENT]
AT = '2020-02-25T00:00:00Z'
items = []
for r in sorted(chosen, key=lambda r: h(SEED, 'order', r['Path'])):
    inst, reviews = r['Instrument (in full)'], []
    for other, tag in TAG.items():
        if tag is None: continue
        if other == inst: state = 'present'
        elif inst in STRINGS and other in STRINGS: continue          # string family: leave unknown
        else: state = 'absent'
        reviews.append({'reviewer': 'TinySOL instrument identity', 'at': AT, 'dimension': 'source', 'label': tag, 'state': state})
    items.append({'id': 'ats-' + h(SEED, r['Path'])[:16], 'source': f"TinySOL v6 {r['Path']}",
                  'rights': {'evaluationAllowed': True, 'basis': 'TinySOL (CC-BY-4.0); audio fetched at run time, never committed'},
                  'groups': {'original': f"tinysol:{r['Path']}", 'artist': f"tinysol:{inst}:{r['Instance ID']}", 'pack': f"tinysol:{inst}",
                             'sampleFamily': f"tinysol:{inst}:{r['Instance ID']}"},
                  'instrument': inst, 'pitch': r['Pitch'], 'dynamics': r['Dynamics'], 'path': r['Path'],
                  'split': 'test', 'tier': 'one-shot', 'transformations': [], 'reviews': reviews})
os.makedirs(OUT, exist_ok=True)
path = f'{OUT}/tinysol-manifest.json'
if os.path.exists(path):
    if json.load(open(path))['items'] != items: sys.exit('Computed selection differs from the frozen manifest; refusing to continue.')
else:
    json.dump({'version': 1, 'frozenAt': '2026-10-06T07:45:00Z', 'seed': SEED, 'selection': __doc__.strip(), 'items': items}, open(path, 'w'), indent=1)
if len(sys.argv) > 3:
    src, out = sys.argv[2:4]; os.makedirs(out, exist_ok=True)
    for it in items:
        cands = [os.path.join(d, it['path']) for d in (src, os.path.join(src, 'TinySOL'))]
        shutil.copy(next(c for c in cands if os.path.exists(c)), os.path.join(out, it['id'] + '.wav'))
print(f"{len(items)} notes; per instrument {PER_INSTRUMENT}")
