"""Freeze a second set of 500 DJ-leaning 10 s OpenMIC-2018 clips that no earlier DGE tuning or benchmark used.

Usage: python3 scripts/dj-clips/openmic-round2.py <openmic-2018-v1.0.0.tgz> <audio-out-dir>

Same rules as openmic.py (round 1), except: round 1's 500 clips and their artists are excluded too, and share-alike
clips are allowed. Round 1 left only two eligible non-share-alike test clips, so this round opens the sealed reserve.

Selection depends only on identity fields, FMA genre names and a fixed seed, never on instrument labels or model output:
  * official split01_test sample keys only (the fusion heads were fitted on OpenMIC's train partition);
  * Creative Commons BY licence of any kind (share-alike included) or CC0;
  * no clip and no artist from docs/evaluations/mixed-music-2026-10-05 (the 900 clips PR #113 calibrated its full-mix
    Jamendo thresholds on, split by artist) or from docs/evaluations/dj-clips-2026-10-06 (round 1);
  * at most three clips per FMA artist (raised one at a time only if that cannot fill 500), lowest hashes first;
  * DJ-relevant genres first: clips tagged with a dance, electronic-beat or hip-hop genre (DJ_GENRES), then clips whose
    only DJ link is the broad "Electronic" genre, then every other clip, each tier ranked by hash; first 500 kept.
Labels: OpenMIC aggregated crowd annotations; relevance >= 0.5 is present, lower is absent, a missing pair is unknown.
Audio: the unchanged OpenMIC Ogg clip, written as <id>.ogg.

The manifest is written to docs/evaluations/dj-clips-round2-2026-10-06/openmic-manifest.json the first time; later runs only
re-extract audio and refuse to continue if the selection they compute differs from the frozen one.
"""
import ast, csv, hashlib, io, json, os, sys, tarfile

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'docs', 'evaluations', 'dj-clips-round2-2026-10-06')
EARLIER = [os.path.join(ROOT, 'docs', 'evaluations', d, f) for d, f in
           [('mixed-music-2026-10-05', 'manifest.json'), ('dj-clips-2026-10-06', 'openmic-manifest.json')]]
SEED = 'dge-dj-clips-round2-2026-10-06'
MAX_ITEMS, PER_ARTIST = 500, 3
CLASSES = ['drums', 'voice', 'synthesizer', 'piano', 'guitar', 'bass', 'cymbals', 'organ', 'violin', 'trumpet', 'saxophone']
DJ_GENRES = {'Dance', 'Techno', 'House', 'Breakbeat', 'Drum & Bass', 'Dubstep', 'Jungle', 'Bigbeat', 'Trip-Hop', 'Downtempo',
             'Chill-out', 'IDM', 'Glitch', 'Chip Music', 'Chiptune', 'Electro-Punk', 'Breakcore - Hard', 'Wonky', 'Club', 'Disco',
             'Dub', 'Reggae - Dub', 'Hip-Hop', 'Rap', 'Hip-Hop Beats', 'Alternative Hip-Hop', 'Abstract Hip-Hop', 'Nerdcore'}
tgz, audio_out = sys.argv[1], sys.argv[2]
os.makedirs(audio_out, exist_ok=True); os.makedirs(OUT, exist_ok=True)
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()

earlier = [it for p in EARLIER for it in json.load(open(p))['items']]
used_keys = {it['sampleKey'] for it in earlier}
used_artists = {it['groups']['artist'].split(':', 1)[1] for it in earlier}

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

def genres(m):
    raw = m.get('track_genres', '') or m.get('genres', '')
    try: return {g['genre_title'] for g in ast.literal_eval(raw)}
    except (ValueError, SyntaxError, TypeError, KeyError): return set()
tier = lambda m: 0 if genres(m) & DJ_GENRES else 1 if 'Electronic' in genres(m) else 2
cc = lambda url: 'creativecommons.org/licenses/by' in url or 'publicdomain/zero' in url
by_artist = {}
for key in sorted(test_keys):
    m = meta.get(key)
    if not m or not cc(m.get('license_url', '')) or key not in labels or key in used_keys or m['artist_id'] in used_artists: continue
    by_artist.setdefault(m['artist_id'], []).append(key)
# Raise the per-artist cap only if three per artist cannot fill the set (label-blind; the bootstrap is over artists).
for PER_ARTIST in range(PER_ARTIST, 21):
    pool = [k for keys in by_artist.values() for k in sorted(keys, key=lambda k: h(SEED, 'clip', k))[:PER_ARTIST]]
    if len(pool) >= MAX_ITEMS: break
chosen = sorted(pool, key=lambda k: (tier(meta[k]), h(SEED, 'rank', k)))[:MAX_ITEMS]
if len(chosen) < MAX_ITEMS: sys.exit(f'only {len(chosen)} eligible clips; refusing to freeze a smaller set')

items = []
for key in chosen:
    m = meta[key]; iid = 'dj2-' + h(SEED, key)[:16]
    reviews = [{'reviewer': 'OpenMIC-2018 aggregated annotations', 'at': '2018-09-01T00:00:00Z', 'dimension': 'source', 'label': c,
                'state': 'present' if rel >= .5 else 'absent'} for c, rel in sorted(labels[key].items()) if c in CLASSES]
    items.append({'id': iid, 'source': f"OpenMIC-2018 {key}: {m.get('track_title', '')} by {m.get('artist_name', '')}",
                  'rights': {'evaluationAllowed': True, 'basis': f"OpenMIC-2018 (CC BY 4.0, Zenodo 1432913); clip licence {m['license_url']}"},
                  'groups': {'original': f'openmic:{key}', 'artist': f"fma-artist:{m['artist_id']}", 'pack': f"fma-album:{m.get('album_id', '')}",
                             'sampleFamily': f"fma-artist:{m['artist_id']}"},
                  'genres': sorted(genres(m)), 'djTier': ['dj genre', 'electronic', 'other'][tier(m)],
                  'sampleKey': key, 'start': 0, 'end': 10, 'split': 'test', 'tier': 'song', 'transformations': [], 'reviews': reviews})

manifest = {'version': 1, 'frozenAt': '2026-10-06T01:00:00Z', 'seed': SEED, 'selection': __doc__.strip().split('\n\n')[2], 'items': items}
path = f'{OUT}/openmic-manifest.json'
if os.path.exists(path):
    if json.load(open(path))['items'] != items: sys.exit('Computed selection differs from the frozen manifest; refusing to continue.')
else:
    json.dump(manifest, open(path, 'w'), indent=1)
# One sequential pass: random access into a .tgz re-decompresses from the start for every clip.
wanted = {f"{it['sampleKey']}.ogg": it['id'] for it in items}
with tarfile.open(tgz, 'r|gz') as stream:
    for m in stream:
        name = os.path.basename(m.name)
        if m.isfile() and '/audio/' in f'/{m.name}' and not name.startswith('._') and name in wanted:
            open(os.path.join(audio_out, f"{wanted.pop(name)}.ogg"), 'wb').write(stream.extractfile(m).read())
if wanted: sys.exit(f'{len(wanted)} selected clips missing from the archive, e.g. {list(wanted)[:3]}')
counts, tiers = {}, {}
for it in items:
    tiers[it['djTier']] = tiers.get(it['djTier'], 0) + 1
    for r in it['reviews']: counts.setdefault(r['label'], [0, 0])[r['state'] == 'absent'] += 1
print(f'{len(items)} clips from {len(pool)} eligible ({len(by_artist)} artists, cap {PER_ARTIST}/artist); tiers {tiers}; present/absent per class: {json.dumps(counts)}')
print('manifest sha256', hashlib.sha256(open(path, 'rb').read()).hexdigest())
