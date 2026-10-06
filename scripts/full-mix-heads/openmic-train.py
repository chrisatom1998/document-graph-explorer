"""Training clips for the full-mix instrument heads: OpenMIC-2018's official train partition, minus every artist any DGE
benchmark used.

Usage: python3 scripts/full-mix-heads/openmic-train.py <openmic-2018-v1.0.0.tgz> <audio-out-dir> <labels-out.json>

  * split01_train sample keys only; every DGE OpenMIC benchmark (the 900-clip mixed-music set and both DJ clip rounds)
    draws from split01_test, so no benchmark clip can be trained on;
  * clips by any FMA artist in those benchmarks are dropped too, so a benchmark never scores an artist the heads saw;
  * labels: OpenMIC aggregated crowd annotations for all 20 classes, kept as relevance in [0, 1] (>= 0.5 present,
    lower absent, a missing pair unknown); no label is ever inferred.
Writes <audio-out-dir>/<sample_key>.ogg (unchanged clip) and the label file
{items: [{id, artist, genres, labels: {class: relevance}}]}.
"""
import ast, csv, io, json, os, sys, tarfile

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
BENCHMARKS = [os.path.join(ROOT, 'docs', 'evaluations', *p) for p in
              [('mixed-music-2026-10-05', 'manifest.json'), ('dj-clips-2026-10-06', 'openmic-manifest.json')]]
# Round 2 (PR #119) lives on its own branch; its artists are listed here so this selection does not depend on that branch.
ROUND2 = os.path.join(os.path.dirname(__file__), 'round2-artists.json')
tgz, audio_out, labels_out = sys.argv[1:4]
os.makedirs(audio_out, exist_ok=True)

used_artists = {it['groups']['artist'].split(':', 1)[1] for p in BENCHMARKS for it in json.load(open(p))['items']}
used_artists |= set(json.load(open(ROUND2)))
tf = tarfile.open(tgz)
members = {m.name: m for m in tf.getmembers() if m.isfile()}
def read(suffix):
    found = [m for n, m in members.items() if n == suffix or n.endswith('/' + suffix)]
    if len(found) != 1: sys.exit(f'expected one archive member ending {suffix}, found {len(found)}')
    return tf.extractfile(found[0]).read().decode('utf-8-sig')
train = set(read('partitions/split01_train.csv').split())
test = set(read('partitions/split01_test.csv').split())
assert not train & test
meta = {r['sample_key']: r for r in csv.DictReader(io.StringIO(read('openmic-2018-metadata.csv')))}
labels = {}
for r in csv.DictReader(io.StringIO(read('openmic-2018-aggregated-labels.csv'))):
    labels.setdefault(r['sample_key'], {})[r['instrument']] = float(r['relevance'])
def genres(m):
    try: return sorted({g['genre_title'] for g in ast.literal_eval(m.get('track_genres', '') or m.get('genres', ''))})
    except (ValueError, SyntaxError, TypeError, KeyError): return []

items = [{'id': k, 'artist': meta[k]['artist_id'], 'genres': genres(meta[k]), 'labels': labels[k]}
         for k in sorted(train) if k in meta and k in labels and meta[k]['artist_id'] not in used_artists]
dropped = sum(1 for k in train if k in meta and meta[k]['artist_id'] in used_artists)
wanted = {f"{it['id']}.ogg" for it in items}
tf.close()
with tarfile.open(tgz, 'r|gz') as stream:
    for m in stream:
        name = os.path.basename(m.name)
        if m.isfile() and '/audio/' in f'/{m.name}' and not name.startswith('._') and name in wanted:
            open(os.path.join(audio_out, name), 'wb').write(stream.extractfile(m).read())
            wanted.discard(name)
if wanted: sys.exit(f'{len(wanted)} clips missing from the archive, e.g. {sorted(wanted)[:3]}')
json.dump({'source': 'OpenMIC-2018 split01_train, benchmark artists removed', 'items': items}, open(labels_out, 'w'))
counts = {}
for it in items:
    for c, r in it['labels'].items(): counts.setdefault(c, [0, 0])[r < .5] += 1
print(f'{len(items)} train clips ({len({i["artist"] for i in items})} artists); {dropped} dropped for benchmark artists')
print('present/absent per class:', json.dumps(dict(sorted(counts.items()))))
