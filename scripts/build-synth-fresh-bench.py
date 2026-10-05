"""Freeze a FRESH synth-only short-clip test set (2026-10-05) before retraining the synth heads.

Why fresh: the 2026-10-04 short-clip test split was used three times and the synth heads were removed after seeing it.

Test sources (frozen here, never trained on):
  * NSynth TRAIN split, 25% of instruments chosen by hash (instruments disjoint from NSynth valid/test and from synth
    training). First 1.0 or 2.0 s of a note, 10 ms fade-out. synthesizer = instrument_source 'synthetic';
    'acoustic' = not a synthesizer; 'electronic' (electric guitar, organ...) = unknown.
  * FSD50K DEV clips from a held-out 20% of the uploaders the old heads trained on, as real-world non-synth negatives
    (drums, voices, impacts...). New synth heads never see these uploaders.
Usage: python3 scripts/build-synth-fresh-bench.py
"""
import csv, hashlib, io, json, os, subprocess, sys, tarfile, wave, zipfile
from collections import Counter

MEDIA = '/Users/chrisjohnson/Documents/Media'
W = f'{MEDIA}/dj-training-fingerprints/short-clips'
AUDIO = f'{W}/synth-bench-audio'
OUT = os.path.join(os.path.dirname(__file__), '..', 'docs', 'evaluations', 'synth-clips-2026-10-05')
TAR = f'{MEDIA}/audio-datasets/nsynth/nsynth-train.jsonwav.tar.gz'
NOW = '2026-10-05T03:30:00Z'
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
os.makedirs(AUDIO, exist_ok=True); os.makedirs(OUT, exist_ok=True)

def heldout_instrument(name): return int(h('synth-fresh-inst', name)[:8], 16) % 4 == 0
def heldout_uploader(up): return int(h('synth-fresh-up', up)[:8], 16) % 5 == 0

def crop(data, secs):
    return subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', 'pipe:0', '-t', str(secs), '-af', f'afade=t=out:st={secs - .01}:d=0.01',
                           '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], input=data, capture_output=True, check=True).stdout

items, train_notes = [], []
ex = json.load(open(f'{W}/nsynth-train/examples.json'))
per = Counter(); test_names = {}; train_names = {}
for n in sorted(ex, key=lambda k: h('nsynth-train', k)):
    m = ex[n]
    if not 36 <= m['pitch'] <= 84 or m['velocity'] < 50: continue
    inst = m['instrument_str']
    if heldout_instrument(inst):
        if per[inst] < 4: per[inst] += 1; test_names[f'nsynth-train/audio/{n}.wav'] = n
    elif per[('t', inst)] < 6: per[('t', inst)] += 1; train_names[f'nsynth-train/audio/{n}.wav'] = n
with tarfile.open(TAR) as tf:
    for member in tf:
        n = test_names.get(member.name) or train_names.get(member.name)
        if not n: continue
        m = ex[n]; secs = 1.0 if int(h('len', n)[:8], 16) % 2 else 2.0
        iid = 'sy-' + h('nsynth-train', n)[:16]
        data = crop(tf.extractfile(member).read(), secs)
        src = m['instrument_source_str']
        truth = {'source:synthesizer': 'present' if src == 'synthetic' else 'absent' if src == 'acoustic' else None,
                 'role:synth hit': 'present' if src == 'synthetic' and m['instrument_family_str'] in ('synth_lead', 'keyboard', 'bass') else 'absent' if src == 'acoustic' else None}
        truth = {k: v for k, v in truth.items() if v}
        rec = {'id': iid, 'groups': {g: f'nsynth:{m["instrument_str"]}' for g in ('original', 'artist', 'pack', 'sampleFamily')},
               'reviews': [{'reviewer': 'NSynth metadata (instrument source/family)', 'at': '2017-04-05T00:00:00Z', 'dimension': k.split(':')[0], 'label': k.split(':')[1], 'state': v} for k, v in truth.items()],
               'meta': {'dataset': 'nsynth-train', 'family': m['instrument_family_str'], 'instrumentSource': src, 'midiPitch': m['pitch'], 'durationSeconds': secs}}
        if member.name in test_names:
            open(f'{AUDIO}/{iid}.wav', 'wb').write(data)
            items.append({**rec, 'split': 'test', 'tier': 'one-shot', 'source': f'NSynth train note {n} (CC BY 4.0)',
                          'rights': {'evaluationAllowed': True, 'basis': 'NSynth, CC BY 4.0'}, 'transformations': [f'first {secs} s, 10 ms fade-out'], 'start': 0, 'end': secs})
        else:
            open(f'{W}/train-audio/{iid}.wav', 'wb').write(data); train_notes.append(rec)

# FSD50K dev negatives from held-out uploaders (only clips the old rules already call 'not a synthesizer').
old = json.load(open(f'{W}/train-items.json'))['items']
fsd = [i for i in old if i['meta'].get('dataset') == 'fsd50k' and heldout_uploader(i['groups']['artist'])]
z = zipfile.ZipFile(f'{W}/dev_merged.zip'); neg = 0
for i in sorted(fsd, key=lambda i: h('neg', i['id'])):
    states = {f"{r['dimension']}:{r['label']}": r['state'] for r in i['reviews']}
    if states.get('source:synthesizer') != 'absent': continue
    data = z.read(i['meta']['zipMember']); iid = 'sy-' + i['id'][3:]
    open(f'{AUDIO}/{iid}.wav', 'wb').write(data)
    items.append({'id': iid, 'split': 'test', 'tier': 'one-shot', 'source': f"FSD50K dev clip {i['groups']['original']}",
                  'rights': {'evaluationAllowed': True, 'basis': 'FSD50K, CC BY 4.0 compilation; per-clip CC licence'},
                  'groups': i['groups'], 'transformations': [], 'start': 0, 'end': i['meta']['durationSeconds'],
                  'reviews': [{'reviewer': 'FSD50K human annotators (mapped)', 'at': '2020-10-02T00:00:00Z', 'dimension': d, 'label': 'synthesizer' if d == 'source' else 'synth hit', 'state': 'absent'} for d in ('source', 'role')],
                  'meta': {'dataset': 'fsd50k-dev-heldout', 'fsdLabels': i['meta']['fsdLabels'], 'durationSeconds': i['meta']['durationSeconds']}})
    neg += 1

path = f'{OUT}/manifest.json'
manifest = {'version': 1, 'frozenAt': NOW, 'items': [{k: v for k, v in i.items() if k != 'meta'} for i in items]}
if os.path.exists(path) and json.load(open(path))['items'] != manifest['items']: sys.exit('Refusing to change a frozen test split.')
json.dump(manifest, open(path, 'w'), indent=1)
json.dump({i['id']: i['meta'] for i in items}, open(f'{OUT}/item-meta.json', 'w'), indent=1)
json.dump({'heldoutInstrumentRule': "sha256('synth-fresh-inst|'+instrument)[:8] % 4 == 0",
           'heldoutUploaderRule': "sha256('synth-fresh-up|'+artistGroup)[:8] % 5 == 0",
           'nsynthTestInstruments': sorted({i['groups']['artist'] for i in items if i['groups']['artist'].startswith('nsynth:')}),
           'fsdUploaders': sorted({i['groups']['artist'] for i in items if i['groups']['artist'].startswith('freesound')})}, open(f'{OUT}/reserved-test-families.json', 'w'), indent=1)
json.dump({'items': train_notes}, open(f'{W}/train-items-nsynth.json', 'w'))
c = Counter((i['meta']['dataset'], r['label'], r['state']) for i in items for r in i['reviews'])
print(json.dumps({'test': len(items), 'fsdNegatives': neg, 'nsynthTrainNotes': len(train_notes), 'labels': {str(k): v for k, v in sorted(c.items())},
                  'families': len({i['groups']['artist'] for i in items}), 'sha256': hashlib.sha256(open(path, 'rb').read()).hexdigest()}, indent=1))
