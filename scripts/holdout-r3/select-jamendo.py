"""Freeze the round 3 held-out sound-tag set: 500 MTG-Jamendo split-0 test tracks, electronic and DJ genres first.

Usage: python3 scripts/holdout-r3/select-jamendo.py <mtg-jamendo-dataset checkout or metadata dir>

Why this source: the OpenMIC test pool is used up (rounds 1 and 2), and MTG-Jamendo is real, full-mix, Creative Commons
music with a large electronic share. DGE's Jamendo instrument head is Essentia's MTG-Jamendo model, which was trained on
this dataset; split-0 test is the partition its published metrics are measured on, so only split-0 test tracks are used.
No DGE script has fetched MTG-Jamendo audio before this set.

Selection depends only on identity fields, genre tags, durations and a fixed seed, never on instrument tags or model
output:
  * tracks in data/splits/split-0/autotagging_instrument-test.tsv (each has at least one uploader instrument tag)
    that are at least 45 s long;
  * at most three tracks per Jamendo artist (best genre tier first, then lowest hash);
  * DJ-relevant genres first: a dance, electronic-beat, hip-hop or chill genre tag (DJ_GENRES), then tracks whose only
    such link is the broad "electronic" tag, then every other track, each tier ranked by hash; first 500 kept.
Excerpt: the middle 30 s of the low-quality (mono VBR) MP3 from the dataset's raw_30s/audio-low archives. Uploader tags
describe the whole track, so a 30 s excerpt (three of the app's 10 s analysis windows) is used instead of 10 s.
Labels (the 11 OpenMIC classes the tag scorer knows, plus cello for later use):
  * present: the uploader tagged the instrument (TAG_MAP);
  * voice: the music-classification-annotations voice/instrumental answer where all three annotators agreed
    (instrumental is a reliable "voice absent"); dropped if it contradicts an uploader voice tag;
  * absent, weak: the uploader did not tag it. Uploader tags are incomplete (bass and voice especially), so these
    carry "weak": true; the workflow scores a strict view without them and a weak view with them. Cymbals have no
    Jamendo tag and are never labelled.
The manifest is written once; later runs refuse to continue if the selection they compute differs from it.
"""
import hashlib, json, os, sys

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'docs', 'evaluations', 'holdout-r3-2026-10-06')
SEED, MAX_ITEMS, PER_ARTIST, CLIP, MIN_DURATION = 'dge-holdout-r3-jamendo-2026-10-06', 500, 3, 30.0, 45.0
TAG_MAP = {'drums': ['drums', 'drummachine'], 'voice': ['voice'], 'synthesizer': ['synthesizer'],
           'piano': ['piano', 'electricpiano', 'rhodes'], 'guitar': ['guitar', 'electricguitar', 'acousticguitar', 'classicalguitar'],
           'bass': ['bass', 'acousticbassguitar', 'doublebass'], 'organ': ['organ', 'pipeorgan'], 'violin': ['violin'],
           'trumpet': ['trumpet'], 'saxophone': ['saxophone'], 'cello': ['cello']}
DJ_GENRES = {'house', 'deephouse', 'techno', 'minimal', 'trance', 'dance', 'eurodance', 'club', 'edm', 'drumnbass', 'jungle', 'dubstep',
             'breakbeat', 'bigbeat', 'breakcore', 'electro', 'electropop', 'synthpop', 'idm', 'electronica', 'dub', 'trap', 'hiphop',
             'rap', 'triphop', 'downtempo', 'chillout', 'lounge'}
src = sys.argv[1]
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()

def tsv(rel):
    rows = {}
    for line in open(os.path.join(src, rel), encoding='utf-8').read().splitlines()[1:]:
        p = line.split('\t')
        rows[p[0]] = {'artist': p[1], 'album': p[2], 'path': p[3], 'duration': float(p[4]), 'tags': p[5:]}
    return rows

test = tsv('data/splits/split-0/autotagging_instrument-test.tsv')
alltags = tsv('data/raw_30s_cleantags.tsv')
voice_ann = {}
for k, r in tsv('derived/music-classification-annotations/music-classification-annotations-clean.tsv').items():
    for t in r['tags']:
        if t.startswith('voice_instrumental---'):
            answers = set(t.split('---')[1].split(','))
            if len(answers) == 1: voice_ann[k] = answers.pop()
archived = {line.split()[1].split('/')[-1].split('.')[0] for line in open(os.path.join(src, 'data/download/raw_30s_audio-low_sha256_tracks.txt'))}

genres = lambda k: sorted({t.split('---')[1] for t in alltags[k]['tags'] if t.startswith('genre---')})
tier = lambda k: 0 if set(genres(k)) & DJ_GENRES else 1 if 'electronic' in genres(k) else 2
by_artist = {}
for k in sorted(test):
    r = test[k]
    if r['duration'] < MIN_DURATION or k.split('_')[1].lstrip('0') not in archived: continue
    by_artist.setdefault(r['artist'], []).append(k)
pool = [k for ks in by_artist.values() for k in sorted(ks, key=lambda k: (tier(k), h(SEED, 'track', k)))[:PER_ARTIST]]
chosen = sorted(pool, key=lambda k: (tier(k), h(SEED, 'rank', k)))[:MAX_ITEMS]
if len(chosen) < MAX_ITEMS: sys.exit(f'only {len(chosen)} eligible tracks; refusing to freeze a smaller set')

AT = '2019-06-01T00:00:00Z'
items = []
for k in chosen:
    r = test[k]; inst = {t.split('---')[1] for t in r['tags'] if t.startswith('instrument---')}
    reviews = []
    for cls, tags in TAG_MAP.items():
        tagged = bool(inst & set(tags))
        if cls == 'voice' and k in voice_ann:
            said = 'present' if voice_ann[k] == 'voice' else 'absent'
            if said == 'absent' and tagged: continue          # annotators and uploader disagree: leave unknown
            reviews.append({'reviewer': 'MTG-Jamendo music-classification annotations (3 annotators agree)', 'at': AT,
                            'dimension': 'source', 'label': cls, 'state': said})
        elif tagged:
            reviews.append({'reviewer': 'MTG-Jamendo uploader tags', 'at': AT, 'dimension': 'source', 'label': cls, 'state': 'present'})
        else:
            reviews.append({'reviewer': 'MTG-Jamendo uploader tags (not tagged)', 'at': AT, 'dimension': 'source', 'label': cls,
                            'state': 'absent', 'weak': True})
    start = round(max(0.0, r['duration'] / 2 - CLIP / 2), 3)
    items.append({'id': 'h3j-' + h(SEED, k)[:16], 'source': f'MTG-Jamendo {k} (split-0 test)',
                  'rights': {'evaluationAllowed': True, 'basis': 'MTG-Jamendo dataset (Creative Commons tracks; non-commercial research use); audio fetched at run time, never committed'},
                  'groups': {'original': f'jamendo:{k}', 'artist': f"jamendo:{r['artist']}", 'pack': f"jamendo:{r['album']}", 'sampleFamily': f"jamendo:{r['artist']}"},
                  'genres': genres(k), 'djTier': ['dj genre', 'electronic', 'other'][tier(k)], 'sampleKey': k, 'archivePath': r['path'].replace('.mp3', '.low.mp3'),
                  'start': start, 'end': round(start + CLIP, 3), 'split': 'test', 'tier': 'song', 'transformations': [], 'reviews': reviews})

os.makedirs(OUT, exist_ok=True)
path = f'{OUT}/jamendo-manifest.json'
if os.path.exists(path):
    if json.load(open(path))['items'] != items: sys.exit('Computed selection differs from the frozen manifest; refusing to continue.')
else:
    json.dump({'version': 1, 'frozenAt': '2026-10-06T05:00:00Z', 'seed': SEED, 'selection': __doc__.strip(), 'items': items},
              open(path, 'w'), indent=1)
counts, tiers = {}, {}
for it in items:
    tiers[it['djTier']] = tiers.get(it['djTier'], 0) + 1
    for r in it['reviews']:
        c = counts.setdefault(r['label'], {'present': 0, 'absent': 0, 'weakAbsent': 0})
        c['weakAbsent' if r.get('weak') else r['state']] += 1
print(f'{len(items)} tracks from {len(pool)} eligible ({len(by_artist)} artists); tiers {tiers}')
print('labels per class:', json.dumps(counts))
print('manifest sha256', hashlib.sha256(open(path, 'rb').read()).hexdigest())
