"""Build the sound-link benchmark: which tracks should a "sounds alike" link connect?

Usage: python3 scripts/sound-links/select.py <openmic-2018-v1.0.0.tgz> <fma_metadata.zip> <nsynth-test.jsonwav.tar.gz> <out-dir>

Two kinds of audio, each with a tuning set and a separate held-out test set. Selection uses identity fields and a
fixed seed only, never model output.
  * songs: 10 s OpenMIC-2018 full-mix clips (FMA music). Ground truth is the FMA top-level genre of the clip's track
    (fma_metadata tracks.csv) and the artist. Tuning clips come from OpenMIC's official train partition, test clips
    from its test partition. At most two clips per artist, at most PER_GENRE per genre, genres with fewer than
    MIN_GENRE clips left out.
  * notes: 4 s NSynth (test set) single notes. Ground truth is the instrument family (and the instrument itself).
    Instruments are split between tuning and test by a hash of the instrument name, so test instruments were never
    seen while tuning. Up to PER_INSTRUMENT notes per instrument across its pitch range.
Writes <out-dir>/<set>.json (manifest: items with id, path relative to <out-dir>, split, labels) and the audio under
<out-dir>/audio/.
"""
import csv, hashlib, io, json, os, sys, tarfile, zipfile

SEED = 'dge-sound-links-2026-10-05'
PER_GENRE, MIN_GENRE, PER_ARTIST = 30, 12, 2
PER_INSTRUMENT = 10
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
openmic, fma_zip, nsynth_tgz, out = sys.argv[1:5]
os.makedirs(f'{out}/audio', exist_ok=True)

# --- songs -------------------------------------------------------------------------------------------------------
tf = tarfile.open(openmic)
members = {m.name: m for m in tf.getmembers() if m.isfile() and not os.path.basename(m.name).startswith('._')}
def member(suffix):
    found = [m for n, m in members.items() if n == suffix or n.endswith('/' + suffix)]
    if len(found) != 1: sys.exit(f'expected one archive member ending {suffix}, found {len(found)}')
    return found[0]
read = lambda suffix: tf.extractfile(member(suffix)).read().decode('utf-8-sig')
partition = {k: 'tune' for k in read('partitions/split01_train.csv').split()}
partition.update({k: 'test' for k in read('partitions/split01_test.csv').split()})
meta = {r['sample_key']: r for r in csv.DictReader(io.StringIO(read('openmic-2018-metadata.csv')))}
instruments = {}
for r in csv.DictReader(io.StringIO(read('openmic-2018-aggregated-labels.csv'))):
    if float(r['relevance']) >= .5: instruments.setdefault(r['sample_key'], set()).add(r['instrument'])

with zipfile.ZipFile(fma_zip) as z:
    name = next(n for n in z.namelist() if os.path.basename(n) == 'tracks.csv')
    rows = csv.reader(io.TextIOWrapper(z.open(name), encoding='utf-8'))
    top, sub = next(rows), next(rows); next(rows)
    cols = [i for i, b in enumerate(sub) if b.strip() == 'genre_top'] or [i for i, a in enumerate(top) if a.strip() == 'genre_top']
    if not cols: sys.exit(f'no genre_top column in {name}: {top[:8]} / {sub[:8]}')
    col = cols[0]
    genre = {int(r[0]): r[col] for r in rows if len(r) > col and r[col] and r[0].isdigit()}
track = lambda m: int(m['track_id']) if m.get('track_id', '').strip().isdigit() else None
print(f'FMA genre_top known for {len(genre)} tracks')

songs = {'tune': [], 'test': []}
wanted = {}  # archive file name -> output path; gzip archives are read once, in order (random access re-decompresses)
for split in songs:
    pool = {}
    for key, p in partition.items():
        m = meta.get(key)
        g = m and genre.get(track(m))
        if p == split and g: pool.setdefault(g, []).append(key)
    for g, keys in sorted(pool.items()):
        per_artist, chosen = {}, []
        for key in sorted(keys, key=lambda k: h(SEED, 'song', k)):
            a = meta[key]['artist_id']
            if per_artist.get(a, 0) >= PER_ARTIST: continue
            per_artist[a] = per_artist.get(a, 0) + 1; chosen.append(key)
            if len(chosen) == PER_GENRE: break
        if len(chosen) < MIN_GENRE: continue
        for key in chosen:
            m = meta[key]; iid = 'sl-' + h(SEED, key)[:16]
            songs[split].append({'id': iid, 'path': f'audio/{iid}.ogg', 'split': split, 'tier': 'song',
                                 'labels': {'genre': g, 'artist': m['artist_id'], 'instruments': sorted(instruments.get(key, []))},
                                 'source': f"OpenMIC-2018 {key}: {m.get('track_title', '')} by {m.get('artist_name', '')} ({m.get('license_url', '')})"})
            wanted[f'{key}.ogg'] = f'{out}/audio/{iid}.ogg'
tf.close()
def extract(archive, wanted):
    with tarfile.open(archive, 'r|gz') as stream:
        for m in stream:
            path = wanted.get(os.path.basename(m.name))
            if path and m.isfile() and not os.path.basename(m.name).startswith('._'):
                open(path, 'wb').write(stream.extractfile(m).read())
    missing = [p for p in wanted.values() if not os.path.exists(p)]
    if missing: sys.exit(f'{len(missing)} clips missing from {archive}')
extract(openmic, wanted)

# --- notes -------------------------------------------------------------------------------------------------------
notes = {'tune': [], 'test': []}
with tarfile.open(nsynth_tgz) as nt:
    nm = {m.name: m for m in nt.getmembers() if m.isfile()}
    examples = json.load(nt.extractfile(next(m for n, m in nm.items() if n.endswith('examples.json'))))
    by_instrument = {}
    for note, e in examples.items():
        if 36 <= e['pitch'] <= 84 and e['velocity'] >= 75: by_instrument.setdefault(e['instrument_str'], []).append(note)
    wanted = {}
    for inst, keys in sorted(by_instrument.items()):
        split = 'tune' if int(h(SEED, 'instrument', inst)[:8], 16) % 2 == 0 else 'test'
        keys = sorted(keys, key=lambda k: examples[k]['pitch'])
        step = max(1, len(keys) / PER_INSTRUMENT)
        for k in sorted({keys[int(i * step)] for i in range(min(PER_INSTRUMENT, len(keys)))}):
            e = examples[k]; iid = 'sn-' + h(SEED, k)[:16]
            notes[split].append({'id': iid, 'path': f'audio/{iid}.wav', 'split': split, 'tier': 'note',
                                 'labels': {'family': e['instrument_family_str'], 'instrument': inst, 'source': e['instrument_source_str'], 'pitch': e['pitch']},
                                 'source': f'NSynth test note {k} (CC BY 4.0)'})
            wanted[f'{k}.wav'] = f'{out}/audio/{iid}.wav'
extract(nsynth_tgz, wanted)

for kind, sets in (('songs', songs), ('notes', notes)):
    for split, items in sets.items():
        items.sort(key=lambda it: it['id'])  # ids are hashes: any prefix of the list is a fair sample
        json.dump({'version': 1, 'seed': SEED, 'kind': kind, 'items': items, 'clips': items}, open(f'{out}/{kind}-{split}.json', 'w'), indent=1)
        groups = {}
        for it in items:
            g = it['labels'].get('genre') or it['labels'].get('family'); groups[g] = groups.get(g, 0) + 1
        print(f'{kind}-{split}: {len(items)} clips; {json.dumps(groups, sort_keys=True)}')
