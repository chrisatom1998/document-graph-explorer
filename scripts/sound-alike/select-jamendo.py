"""Training tracks for the "sounds alike" projection: MTG-Jamendo split-0 train and validation only.

Usage: python3 scripts/sound-alike/select-jamendo.py <mtg-jamendo dir> <holdout-r3 jamendo-manifest.json> <out.json> [--windows 3]

<mtg-jamendo dir> is MTG/mtg-jamendo-dataset at cafd8e20c265ed84f1e61f1c875327971f43a62f (data/raw_30s_cleantags.tsv,
data/splits/split-0/*.tsv, data/download/raw_30s_audio-low_sha256_tracks.txt).

Held out, never selected: every track and artist in any split-0 *-test.tsv, and every track and artist in the round 3
held-out manifest (drawn from split-0 test). The sound-links benchmark (OpenMIC/FMA songs, NSynth notes), the OpenMIC
tuning clips, the DJ clip rounds 1-2 (OpenMIC, GiantSteps/Beatport) and the Beatport holdout are other datasets, so no
Jamendo track can be one of them. Split-0 train and validation are artist-disjoint; any artist found in both is
dropped from validation so the check stays by artist. Each track gets <windows> 10 s windows spread across it (their
mean stands in for the app's mean over the whole track).
"""
import argparse, glob, json, os

ap = argparse.ArgumentParser()
ap.add_argument('meta'); ap.add_argument('holdout'); ap.add_argument('out')
ap.add_argument('--windows', type=int, default=3)
args = ap.parse_args()

def rows(path):
    out = []
    for line in open(path).read().splitlines()[1:]:
        f = line.rstrip().split('\t')
        out.append({'track': f[0], 'artist': f[1], 'path': f[3], 'duration': float(f[4]), 'tags': [t for t in f[5:] if t]})
    return out

split_dir = os.path.join(args.meta, 'data', 'splits', 'split-0')
held_tracks, held_artists = set(), set()
for path in glob.glob(os.path.join(split_dir, '*-test.tsv')):
    for r in rows(path): held_tracks.add(r['track']); held_artists.add(r['artist'])
for it in json.load(open(args.holdout))['items']:
    held_tracks.add(it['groups']['original'].split(':', 1)[1]); held_artists.add(it['groups']['artist'].split(':', 1)[1])
if not held_tracks: raise SystemExit('no held-out tracks found: wrong metadata dir?')

split = {}
for name in ('train', 'validation'):
    for path in glob.glob(os.path.join(split_dir, f'*-{name}.tsv')):
        for r in rows(path): split.setdefault(r['track'], name)
tags = {r['track']: r for r in rows(os.path.join(args.meta, 'data', 'raw_30s_cleantags.tsv'))}
sha = dict(reversed(line.split()) for line in open(os.path.join(args.meta, 'data', 'download', 'raw_30s_audio-low_sha256_tracks.txt')))

tracks = []
for track, name in sorted(split.items()):
    r = tags.get(track)
    if not r or track in held_tracks or r['artist'] in held_artists: continue
    path = r['path'].replace('.mp3', '.low.mp3')
    if path not in sha: continue
    group = lambda prefix: sorted(t.split('---', 1)[1] for t in r['tags'] if t.startswith(prefix + '---'))
    d = r['duration']; length = min(10, d)
    starts = [round(max(0, d * (k + 1) / (args.windows + 1) - length / 2), 2) for k in range(args.windows)]
    tracks.append({'track': track, 'artist': r['artist'], 'split': name, 'archivePath': path, 'sha256': sha[path], 'starts': starts,
                   'genre': group('genre'), 'mood': group('mood/theme'), 'instrument': group('instrument')})
train_artists = {t['artist'] for t in tracks if t['split'] == 'train'}
dropped = [t for t in tracks if t['split'] == 'validation' and t['artist'] in train_artists]
tracks = [t for t in tracks if not (t['split'] == 'validation' and t['artist'] in train_artists)]
json.dump({'source': 'MTG-Jamendo cafd8e20 split-0 train+validation; split-0 test and round 3 holdout tracks/artists removed',
           'tracks': tracks}, open(args.out, 'w'))
for name in ('train', 'validation'):
    s = [t for t in tracks if t['split'] == name]
    print(f'{name}: {len(s)} tracks, {len({t["artist"] for t in s})} artists, {sum(bool(t["genre"]) for t in s)} with a genre tag')
print(f'held out {len(held_tracks)} tracks / {len(held_artists)} artists; dropped {len(dropped)} validation tracks whose artist is in train')
