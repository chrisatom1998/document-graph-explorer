"""Freeze a mixed-music (full-mix) tag benchmark from the official OpenMIC-2018 test partition.

Usage: python3 scripts/mixed-music/build.py <openmic-2018-v1.0.0.tgz> <audio-out-dir>

Selection depends only on identity fields and a fixed seed, never on labels or model output:
  * official split01_test sample keys only (the fusion source policy was developed on OpenMIC's train partition);
  * metadata license_url must be a Creative Commons licence without share-alike (BY, BY-NC, BY-ND, BY-NC-ND) or CC0;
    share-alike clips are left out because the fusion work keeps them as a sealed reserve;
  * at most three 10 s clips per FMA artist, the artist's clips with the lowest hashes;
  * clips ranked by hash, first MAX_ITEMS kept.
Labels: OpenMIC aggregated crowd annotations; relevance >= 0.5 is present, lower is absent, a missing pair is unknown.
Audio: the unchanged OpenMIC Ogg clip, written as <id>.ogg.

The manifest is written to docs/evaluations/mixed-music-2026-10-05/manifest.json the first time; later runs only
re-extract audio and refuse to continue if the selection they compute differs from the frozen one.
"""
import csv, hashlib, io, json, os, sys, tarfile

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'docs', 'evaluations', 'mixed-music-2026-10-05')
SEED = 'dge-mixed-music-2026-10-05'
MAX_ITEMS = 900
CLASSES = ['drums', 'voice', 'synthesizer', 'piano', 'guitar', 'bass', 'cymbals', 'organ', 'violin', 'trumpet', 'saxophone']
tgz, audio_out = sys.argv[1], sys.argv[2]
os.makedirs(audio_out, exist_ok=True); os.makedirs(OUT, exist_ok=True)
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()

tf = tarfile.open(tgz)
members = {m.name: m for m in tf.getmembers() if m.isfile()}
def member(suffix):
    found = [m for n, m in members.items() if n == suffix or n.endswith('/' + suffix)]   # not macOS ._ shadow files
    if len(found) != 1: sys.exit(f'expected one archive member ending {suffix}, found {len(found)}')
    return found[0]
read = lambda suffix: tf.extractfile(member(suffix)).read().decode('utf-8-sig')
test_keys = set(read('partitions/split01_test.csv').split())
meta = {r['sample_key']: r for r in csv.DictReader(io.StringIO(read('openmic-2018-metadata.csv')))}
labels = {}
for r in csv.DictReader(io.StringIO(read('openmic-2018-aggregated-labels.csv'))):
    labels.setdefault(r['sample_key'], {})[r['instrument']] = float(r['relevance'])   # a later duplicate row wins

cc = lambda url: ('creativecommons.org/licenses/by' in url and '-sa' not in url) or ('publicdomain/zero' in url)
PER_ARTIST = 3
by_artist = {}
for key in sorted(test_keys):
    m = meta.get(key)
    if not m or not cc(m.get('license_url', '')) or key not in labels: continue
    by_artist.setdefault(m['artist_id'], []).append(key)
chosen = sorted((k for keys in by_artist.values() for k in sorted(keys, key=lambda k: h(SEED, 'clip', k))[:PER_ARTIST]),
                key=lambda k: h(SEED, 'rank', k))[:MAX_ITEMS]

items = []
for key in chosen:
    m = meta[key]; iid = 'mm-' + h(SEED, key)[:16]
    reviews = [{'reviewer': 'OpenMIC-2018 aggregated annotations', 'at': '2018-09-01T00:00:00Z', 'dimension': 'source', 'label': c,
                'state': 'present' if rel >= .5 else 'absent'} for c, rel in sorted(labels[key].items()) if c in CLASSES]
    items.append({'id': iid, 'source': f"OpenMIC-2018 {key}: {m.get('track_title', '')} by {m.get('artist_name', '')}",
                  'rights': {'evaluationAllowed': True, 'basis': f"OpenMIC-2018 (CC BY 4.0, Zenodo 1432913); clip licence {m['license_url']}"},
                  'groups': {'original': f'openmic:{key}', 'artist': f"fma-artist:{m['artist_id']}", 'pack': f"fma-album:{m.get('album_id', '')}",
                             'sampleFamily': f"fma-artist:{m['artist_id']}"},
                  'genres': m.get('track_genres', '') or m.get('genres', ''), 'sampleKey': key, 'start': 0, 'end': 10, 'split': 'test', 'tier': 'song',
                  'transformations': [], 'reviews': reviews})

manifest = {'version': 1, 'frozenAt': '2026-10-05T17:00:00Z', 'seed': SEED, 'selection': __doc__.strip().split('\n\n')[2], 'items': items}
path = f'{OUT}/manifest.json'
if os.path.exists(path):
    if json.load(open(path))['items'] != items: sys.exit('Computed selection differs from the frozen manifest; refusing to continue.')
else:
    json.dump(manifest, open(path, 'w'), indent=1)
for it in items:
    key = it['sampleKey']
    data = tf.extractfile(member(f'audio/{key[:3]}/{key}.ogg')).read()
    open(os.path.join(audio_out, f"{it['id']}.ogg"), 'wb').write(data)
counts = {}
for it in items:
    for r in it['reviews']: counts.setdefault(r['label'], [0, 0])[r['state'] == 'absent'] += 1
print(f'{len(items)} clips from {len(by_artist)} eligible artists; present/absent per class: {json.dumps(counts)}')
print('manifest sha256', hashlib.sha256(open(path, 'rb').read()).hexdigest())
