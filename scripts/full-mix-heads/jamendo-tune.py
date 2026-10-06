"""Tuning set for the full-mix heads in DJ genres: MTG-Jamendo split-0 TRAIN and VALIDATION tracks only.

Usage: python3 scripts/full-mix-heads/jamendo-tune.py <mtg-jamendo metadata dir> <manifest-out.json>

Split-0 test is held out for judging (docs/evaluations/holdout-r3-2026-10-06 on PR #121); MTG-Jamendo splits share no
artist, so no artist here is in that set either. Selection uses identity fields, genre tags, durations and a fixed seed,
never instrument tags or model output:
  * tracks in split-0 autotagging_instrument train/validation (each has at least one uploader instrument tag), at least
    45 s long and present in the low-quality audio archive;
  * at most three tracks per artist; DJ genres first (same DJ_GENRES as the round 3 set), then "electronic", then the rest,
    each tier ranked by hash; first MAX_ITEMS kept.
Excerpt: the middle 30 s (the round 3 set's excerpt), so window voting is tuned on the shape it will be judged on.
Labels: the uploader's raw instrument tags (present; untagged is only a weak absent).
"""
import hashlib, json, os, sys

SEED, MAX_ITEMS, PER_ARTIST, CLIP, MIN_DURATION = 'dge-full-mix-heads-jamendo-tune-2026-10-06', 1500, 3, 30.0, 45.0
DJ_GENRES = {'house', 'deephouse', 'techno', 'minimal', 'trance', 'dance', 'eurodance', 'club', 'edm', 'drumnbass', 'jungle', 'dubstep',
             'breakbeat', 'bigbeat', 'breakcore', 'electro', 'electropop', 'synthpop', 'idm', 'electronica', 'dub', 'trap', 'hiphop',
             'rap', 'triphop', 'downtempo', 'chillout', 'lounge'}
src, out = sys.argv[1:3]
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()

def tsv(rel):
    rows = {}
    for line in open(os.path.join(src, rel), encoding='utf-8').read().splitlines()[1:]:
        p = line.split('\t')
        rows[p[0]] = {'artist': p[1], 'album': p[2], 'path': p[3], 'duration': float(p[4]), 'tags': p[5:]}
    return rows

pool_rows = {**tsv('data/splits/split-0/autotagging_instrument-train.tsv'), **tsv('data/splits/split-0/autotagging_instrument-validation.tsv')}
held = tsv('data/splits/split-0/autotagging_instrument-test.tsv')
assert not {r['artist'] for r in pool_rows.values()} & {r['artist'] for r in held.values()}
alltags = tsv('data/raw_30s_cleantags.tsv')
archived = {line.split()[1].split('/')[-1].split('.')[0] for line in open(os.path.join(src, 'data/download/raw_30s_audio-low_sha256_tracks.txt'))}
genres = lambda k: sorted({t.split('---')[1] for t in alltags[k]['tags'] if t.startswith('genre---')})
tier = lambda k: 0 if set(genres(k)) & DJ_GENRES else 1 if 'electronic' in genres(k) else 2
by_artist = {}
for k in sorted(pool_rows):
    r = pool_rows[k]
    if r['duration'] < MIN_DURATION or k.split('_')[1].lstrip('0') not in archived: continue
    by_artist.setdefault(r['artist'], []).append(k)
pool = [k for ks in by_artist.values() for k in sorted(ks, key=lambda k: (tier(k), h(SEED, 'track', k)))[:PER_ARTIST]]
chosen = sorted(pool, key=lambda k: (tier(k), h(SEED, 'rank', k)))[:MAX_ITEMS]
items = []
for k in chosen:
    r = pool_rows[k]; start = round(max(0.0, r['duration'] / 2 - CLIP / 2), 3)
    items.append({'id': 'fmj-' + h(SEED, k)[:16], 'sampleKey': k, 'artist': r['artist'], 'genres': genres(k), 'djTier': ['dj genre', 'electronic', 'other'][tier(k)],
                  'instruments': sorted(t.split('---')[1] for t in r['tags'] if t.startswith('instrument---')),
                  'archivePath': r['path'].replace('.mp3', '.low.mp3'), 'start': start, 'end': round(start + CLIP, 3)})
json.dump({'version': 1, 'seed': SEED, 'selection': __doc__.strip(), 'items': items}, open(out, 'w'), indent=1)
tiers = {}
for it in items: tiers[it['djTier']] = tiers.get(it['djTier'], 0) + 1
print(f'{len(items)} tracks from {len(pool)} eligible ({len(by_artist)} artists); tiers {tiers}')
