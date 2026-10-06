"""Freeze the all-tags full-song set: MTG-Jamendo split-0 VALIDATION tracks, labelled for every app tag Jamendo can speak to.

Usage: python3 scripts/all-tags/select-jamendo-val.py <mtg-jamendo-dataset checkout or metadata dir>

Why validation: split-0 test is the round 3 held-out set (PR #121) and must not be tuned on; split-0 train is what
Essentia's Jamendo instrument model (one of DGE's models) was fitted on. Validation tracks share no artist with either.
No DGE head was trained on MTG-Jamendo audio. This set may be used to PICK thresholds (on the "pick" half, by artist
hash) and to CHECK them (on the "check" half); the DJ clip tests and round 3 stay judge-only.

Labels come from uploader instrument tags (present). (The three-annotator voice answers cover only split-0 test
tracks, so voice has no strong absents here; the code keeps the rule in case a track has one.) An untagged instrument is a weak absent: uploaders under-tag, so precision measured against
weak absents is a floor (true precision is at least that). Two production tags come from genre tags that imply them
(chiptune synth from chiptune/8bit, choir from choir/choral). Every other app tag has no full-song label here.

Selection depends on identity fields, instrument tags, durations and a fixed seed, never on model output:
  * validation tracks at least 45 s long, at most three per Jamendo artist;
  * per app tag, tracks are taken in hash order until the tag has PER_TAG positives (rarest tag first), then the set is
    filled to MAX_ITEMS with DJ-genre tracks, then any track, in hash order. So positive counts are not the dataset's base rates.
Excerpt: the middle 30 s (three of the app's 10 s windows) of the low-quality MP3.
"""
import hashlib, json, os, sys

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'docs', 'evaluations', 'all-tags-2026-10-06')
SEED, MAX_ITEMS, PER_TAG, PER_ARTIST, CLIP, MIN_DURATION = 'dge-all-tags-jamendo-val-2026-10-06', 600, 40, 3, 30.0, 45.0
# App tag -> Jamendo instrument tags that mean it. "guitar" and "bass" are the families the app's scorers already use.
INSTRUMENT = {
    'drums': ['drums', 'drummachine'], 'voice': ['voice'], 'synthesizer': ['synthesizer'], 'piano': ['piano'],
    'electric piano': ['electricpiano', 'rhodes'], 'guitar': ['guitar', 'electricguitar', 'acousticguitar', 'classicalguitar'],
    'acoustic guitar': ['acousticguitar', 'classicalguitar'], 'electric guitar': ['electricguitar'],
    'bass guitar': ['bass', 'acousticbassguitar', 'doublebass'], 'organ': ['organ', 'pipeorgan'], 'violin / fiddle': ['violin'],
    'cello': ['cello'], 'strings': ['strings'], 'trumpet': ['trumpet'], 'trombone': ['trombone'], 'horn': ['horn'],
    'saxophone': ['saxophone'], 'clarinet': ['clarinet'], 'oboe': ['oboe'], 'flute': ['flute'], 'harp': ['harp'],
    'accordion': ['accordion'], 'harmonica': ['harmonica'], 'atmospheric pad': ['pad'],
}
GENRE = {'chiptune synth': ['chiptune', '8bit'], 'choir': ['choir', 'choral']}
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

val = tsv('data/splits/split-0/autotagging_instrument-validation.tsv')
alltags = tsv('data/raw_30s_cleantags.tsv')
voice_ann = {}
for k, r in tsv('derived/music-classification-annotations/music-classification-annotations-clean.tsv').items():
    for t in r['tags']:
        if t.startswith('voice_instrumental---'):
            answers = set(t.split('---')[1].split(','))
            if len(answers) == 1: voice_ann[k] = answers.pop()
archived = {line.split()[1].split('/')[-1].split('.')[0] for line in open(os.path.join(src, 'data/download/raw_30s_audio-low_sha256_tracks.txt'))}
genres = lambda k: {t.split('---')[1] for t in alltags[k]['tags'] if t.startswith('genre---')}
insts = lambda k: {t.split('---')[1] for t in val[k]['tags'] if t.startswith('instrument---')}

def labels(k):
    out = {tag for tag, js in INSTRUMENT.items() if insts(k) & set(js)}
    out |= {tag for tag, gs in GENRE.items() if genres(k) & set(gs)}
    return out

eligible = [k for k in sorted(val) if val[k]['duration'] >= MIN_DURATION and k.split('_')[1].lstrip('0') in archived]
chosen, per_artist = [], {}
def take(k):
    a = val[k]['artist']
    if k in chosen or per_artist.get(a, 0) >= PER_ARTIST: return False
    chosen.append(k); per_artist[a] = per_artist.get(a, 0) + 1; return True

counts = lambda tag: sum(tag in labels(k) for k in chosen)
for tag in sorted(list(INSTRUMENT) + list(GENRE), key=lambda t: sum(t in labels(k) for k in eligible)):
    for k in sorted((k for k in eligible if tag in labels(k)), key=lambda k: h(SEED, tag, k)):
        if counts(tag) >= PER_TAG or len(chosen) >= MAX_ITEMS: break
        take(k)
for k in sorted(eligible, key=lambda k: (not genres(k) & DJ_GENRES, h(SEED, 'fill', k))):
    if len(chosen) >= MAX_ITEMS: break
    take(k)

AT = '2019-06-01T00:00:00Z'
items = []
for k in sorted(chosen, key=lambda k: h(SEED, 'order', k)):
    r, have, reviews = val[k], labels(k), []
    for tag in list(INSTRUMENT) + list(GENRE):
        if tag == 'voice' and k in voice_ann:
            said = 'present' if voice_ann[k] == 'voice' else 'absent'
            if said == 'absent' and tag in have: continue
            reviews.append({'reviewer': 'MTG-Jamendo music-classification annotations (3 annotators agree)', 'at': AT, 'dimension': 'source', 'label': tag, 'state': said})
        elif tag in have:
            reviews.append({'reviewer': 'MTG-Jamendo uploader tags', 'at': AT, 'dimension': 'source', 'label': tag, 'state': 'present'})
        else:
            reviews.append({'reviewer': 'MTG-Jamendo uploader tags (not tagged)', 'at': AT, 'dimension': 'source', 'label': tag, 'state': 'absent', 'weak': True})
    start = round(max(0.0, r['duration'] / 2 - CLIP / 2), 3)
    items.append({'id': 'atj-' + h(SEED, k)[:16], 'source': f'MTG-Jamendo {k} (split-0 validation)',
                  'rights': {'evaluationAllowed': True, 'basis': 'MTG-Jamendo dataset (Creative Commons tracks; non-commercial research use); audio fetched at run time, never committed'},
                  'groups': {'original': f'jamendo:{k}', 'artist': f"jamendo:{r['artist']}", 'pack': f"jamendo:{r['album']}", 'sampleFamily': f"jamendo:{r['artist']}"},
                  'half': 'pick' if int(h(SEED, 'half', r['artist'])[:8], 16) % 2 == 0 else 'check',
                  'genres': sorted(genres(k)), 'sampleKey': k, 'archivePath': r['path'].replace('.mp3', '.low.mp3'),
                  'start': start, 'end': round(start + CLIP, 3), 'split': 'validation', 'tier': 'song', 'transformations': [], 'reviews': reviews})

os.makedirs(OUT, exist_ok=True)
path = f'{OUT}/jamendo-val-manifest.json'
if os.path.exists(path):
    if json.load(open(path))['items'] != items: sys.exit('Computed selection differs from the frozen manifest; refusing to continue.')
else:
    json.dump({'version': 1, 'frozenAt': '2026-10-06T07:00:00Z', 'seed': SEED, 'selection': __doc__.strip(), 'items': items}, open(path, 'w'), indent=1)
summary = {}
for it in items:
    for r in it['reviews']:
        c = summary.setdefault(r['label'], {'present': 0, 'absent': 0, 'weakAbsent': 0, 'pickPresent': 0})
        c['weakAbsent' if r.get('weak') else r['state']] += 1
        if r['state'] == 'present' and it['half'] == 'pick': c['pickPresent'] += 1
print(f"{len(items)} tracks from {len(eligible)} eligible; halves {sum(i['half'] == 'pick' for i in items)} pick / {sum(i['half'] == 'check' for i in items)} check")
for tag, c in summary.items(): print(f'  {tag:18} {c}')
print('manifest sha256', hashlib.sha256(open(path, 'rb').read()).hexdigest())
