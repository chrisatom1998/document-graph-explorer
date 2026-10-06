"""Build the genre and energy tuning and judging lists (no audio).

Usage: python3 scripts/genre-energy/build-sets.py <giantsteps-tempo checkout> <giantsteps-mtg-key checkout> <mtg-jamendo metadata dir> <out-dir>

Genre truth is the Beatport genre of GiantSteps tracks; energy truth is MTG-Jamendo mood/theme tags.
  beatport-tune:  GiantSteps tempo tracks outside round 1's 500, plus MTG key tracks outside round 2's 500 that the
                  round 3 hash rule leaves free (odd). Used to fit the genre mapping.
  beatport-judge: round 1's 500 GiantSteps tempo tracks and round 2's 500 MTG key tracks. Judging only. Genre was never
                  tuned on them; earlier threads read only their tempo, key and sound-tag results.
  jamendo-fit:    split-0 train + validation tracks with an energy tag. Used to fit the energy head.
  jamendo-judge:  split-0 test tracks with an energy tag, minus round 3's 500. Judging only.
Energy tags: high = energetic, powerful, fast, upbeat, party, sport, action, heavy; low = calm, relaxing, meditative,
soft, slow. A track tagged from both sides is left out. Selection is ranked by a seeded hash, at most 2 tracks per
artist in fit and 3 in judge, at most 1500 (fit) or 500 (judge) per side, tracks of at least 45 s; the excerpt is the
middle 30 s. Beatport tracks are whole two-minute previews.
"""
import csv, hashlib, json, os, sys

gs, mk, mj, out = sys.argv[1:5]
HERE = os.path.join(os.path.dirname(__file__), '..', '..', 'docs', 'evaluations')
SEED, SPLIT_SEED = 'dge-genre-energy-2026-10-06', 'dge-holdout-r3-2026-10-06'
HIGH = {'energetic', 'powerful', 'fast', 'upbeat', 'party', 'sport', 'action', 'heavy'}
LOW = {'calm', 'relaxing', 'meditative', 'soft', 'slow'}
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
norm = lambda g: g.strip().lower().replace(' & ', '-and-').replace('&', '-and-').replace(' / ', '-').replace('/', '-').replace(' ', '-')
os.makedirs(out, exist_ok=True)

# GiantSteps tempo (round 1 used 500 of these).
round1 = {it['sampleKey'] for it in json.load(open(os.path.join(HERE, 'dj-clips-2026-10-06', 'giantsteps-manifest.json')))['items']}
gs_items = []
for f in sorted(os.listdir(os.path.join(gs, 'annotations', 'genre'))):
    n = f[:-len('.genre')]
    md5 = os.path.join(gs, 'md5', n + '.md5')
    if not os.path.exists(md5): continue
    gs_items.append({'id': f'ge-gs-{h(SEED, n)[:12]}', 'name': n, 'dataset': 'giantsteps-tempo',
                     'url': f'https://www.cp.jku.at/datasets/giantsteps/backup/{n}.mp3', 'md5': open(md5).read().split()[0],
                     'genre': norm(open(os.path.join(gs, 'annotations', 'genre', f)).read()), 'judge': n in round1})

# GiantSteps MTG key (round 2 used 500; round 3 holds the even-hash half of the rest).
round2 = set(open(os.path.join(HERE, 'genre-energy-2026-10-06', 'round2-mtg-key-tracks.txt')).read().split())
meta = {r['ID'].strip(): r for r in csv.DictReader(open(os.path.join(mk, 'annotations', 'beatport_metadata.txt')), delimiter='\t')}
mk_items = []
for f in sorted(os.listdir(os.path.join(mk, 'md5'))):
    n = f[:-len('.md5')]
    m = meta.get(n.split('.')[0])
    if not m or not m.get('BP GENRE', '').strip(): continue
    if n not in round2 and int(h(SPLIT_SEED, n)[:8], 16) % 2 == 0: continue      # round 3's reserved half: never read
    mk_items.append({'id': f'ge-mk-{h(SEED, n)[:12]}', 'name': n, 'dataset': 'giantsteps-mtg-key',
                     'url': f'https://www.cp.jku.at/datasets/giantsteps/mtg_key_backup/{n}.mp3', 'md5': open(os.path.join(mk, 'md5', f)).read().split()[0],
                     'genre': norm(m['BP GENRE']), 'artist': m.get('ARTIST', '').strip(), 'judge': n in round2})
bp = gs_items + mk_items
for name, judge in (('beatport-tune', False), ('beatport-judge', True)):
    items = [it for it in bp if it['judge'] == judge]
    json.dump(items, open(os.path.join(out, f'{name}.json'), 'w'), indent=0)
    counts = {}
    for it in items: counts[it['genre']] = counts.get(it['genre'], 0) + 1
    print(name, len(items), dict(sorted(counts.items(), key=lambda kv: -kv[1])))

# MTG-Jamendo mood/theme.
def tsv(rel):
    rows = {}
    for line in open(os.path.join(mj, rel), encoding='utf-8').read().splitlines()[1:]:
        p = line.split('\t')
        rows[p[0]] = {'artist': p[1], 'path': p[3], 'duration': float(p[4]), 'tags': p[5:]}
    return rows
archived = {line.split()[1] for line in open(os.path.join(mj, 'data/download/raw_30s_audio-low_sha256_tracks.txt'))}
round3 = set(open(os.path.join(HERE, 'genre-energy-2026-10-06', 'round3-jamendo-tracks.txt')).read().split())
alltags = tsv('data/raw_30s_cleantags.tsv')
def pick(splits, per_artist, per_side, exclude):
    rows = {}
    for s in splits: rows.update(tsv(f'data/splits/split-0/autotagging_moodtheme-{s}.tsv'))
    pool = {'high': [], 'low': []}
    by_artist = {}
    for k in sorted(rows):
        r = rows[k]
        moods = {t.split('---')[1] for t in r['tags'] if t.startswith('mood/theme---')}
        side = 'high' if moods & HIGH and not moods & LOW else 'low' if moods & LOW and not moods & HIGH else None
        archive = r['path'].replace('.mp3', '.low.mp3')
        if not side or k in exclude or r['duration'] < 45 or archive not in archived: continue
        by_artist.setdefault((side, r['artist']), []).append(k)
    for (side, _), ks in by_artist.items(): pool[side] += sorted(ks, key=lambda k: h(SEED, 'track', k))[:per_artist]
    items = []
    for side, ks in pool.items():
        for k in sorted(ks, key=lambda k: h(SEED, 'rank', k))[:per_side]:
            r = rows[k]; mid = r['duration'] / 2
            items.append({'id': f'ge-mj-{h(SEED, k)[:12]}', 'name': k, 'dataset': 'mtg-jamendo', 'archivePath': r['path'].replace('.mp3', '.low.mp3'),
                          'start': round(mid - 15, 3), 'end': round(mid + 15, 3), 'energy': side, 'artist': r['artist'],
                          'moods': sorted({t.split('---')[1] for t in r['tags'] if t.startswith('mood/theme---')}),
                          'genres': sorted({t.split('---')[1] for t in alltags.get(k, r)['tags'] if t.startswith('genre---')})})
    return items
for name, splits, per_artist, per_side in (('jamendo-fit', ['train', 'validation'], 2, 1500), ('jamendo-judge', ['test'], 3, 500)):
    items = pick(splits, per_artist, per_side, round3)
    json.dump(items, open(os.path.join(out, f'{name}.json'), 'w'), indent=0)
    print(name, len(items), {s: sum(it['energy'] == s for it in items) for s in ('high', 'low')})
