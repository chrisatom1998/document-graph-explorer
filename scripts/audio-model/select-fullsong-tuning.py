"""Freeze the full-song tuning set for the trained tagger's long-track rule: MTG-Jamendo tracks no held-out set uses.

Usage: python3 scripts/audio-model/select-fullsong-tuning.py <mtg-jamendo-dataset checkout or metadata dir>

The accuracy gate judges full songs on round 3 (500 split-0 test tracks, docs/evaluations/holdout-r3-2026-10-06), so the
rule that turns the tagger's per-window scores into a tag on a long recording must be picked elsewhere. This set:
  * tracks of split-0 autotagging_instrument train or validation (never test), at least 45 s long;
  * whose artist is one of the tagger's validation artists (train.py is_val: never trained on, already used to pick
    the tagger's checkpoint and thresholds), and is in neither split-0 test nor the round 3 manifest;
  * at most four tracks per artist (validation split first, then lowest hash);
  * classes visited rarest first, tracks taken in hash order until each has min(30, all) positives, then filled to
    300 in hash order (the accuracy gate's fast-slice rule, scripts/accuracy-gate/subset.mjs). Selection reads only
    identity fields, durations and uploader tags, never model output.
Excerpt and labels exactly as round 3 (scripts/holdout-r3/select-jamendo.py): the middle 30 s of the low-quality MP3,
uploader instrument tags as present, untagged as weak absent, voice from the three-annotator agreement.
MTG-Jamendo's split-0 train tracks were used to train the app's existing Jamendo instrument model, so main's numbers on
those tracks are if anything optimistic: matching main's precision here is a stricter bar, not a looser one.
The manifest is written once; later runs refuse to continue if the selection they compute differs from it.
"""
import hashlib, json, os, sys

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'docs', 'evaluations', 'all-tags-model-2026-10-06', 'fullsong-tuning-manifest.json')
HOLDOUT = os.path.join(ROOT, 'docs', 'evaluations', 'holdout-r3-2026-10-06', 'jamendo-manifest.json')
SEED, MAX_ITEMS, PER_ARTIST, PER_CLASS, CLIP, MIN_DURATION = 'dge-fullsong-tuning-2026-10-07', 300, 4, 30, 30.0, 45.0
TAG_MAP = {'drums': ['drums', 'drummachine'], 'voice': ['voice'], 'synthesizer': ['synthesizer'],
           'piano': ['piano', 'electricpiano', 'rhodes'], 'guitar': ['guitar', 'electricguitar', 'acousticguitar', 'classicalguitar'],
           'bass': ['bass', 'acousticbassguitar', 'doublebass'], 'organ': ['organ', 'pipeorgan'], 'violin': ['violin'],
           'trumpet': ['trumpet'], 'saxophone': ['saxophone'], 'cello': ['cello']}
src = sys.argv[1]
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
# scripts/audio-model/train.py: about 10% of artists held out as the tagger's validation artists.
is_val = lambda artist: int(hashlib.sha256(f'dge-audio-model|{artist}'.encode()).hexdigest()[:8], 16) % 10 == 0

def tsv(rel, split=None):
    rows = {}
    for line in open(os.path.join(src, rel), encoding='utf-8').read().splitlines()[1:]:
        p = line.split('\t')
        rows[p[0]] = {'artist': p[1], 'album': p[2], 'path': p[3], 'duration': float(p[4]), 'tags': p[5:], 'split': split}
    return rows

test = tsv('data/splits/split-0/autotagging_instrument-test.tsv')
cands = {**tsv('data/splits/split-0/autotagging_instrument-train.tsv', 'train'), **tsv('data/splits/split-0/autotagging_instrument-validation.tsv', 'validation')}
held = json.load(open(HOLDOUT))['items']
held_artists = {r['artist'] for r in test.values()} | {it['groups']['artist'].split(':', 1)[1] for it in held}
held_tracks = set(test) | {it['groups']['original'].split(':', 1)[1] for it in held}
alltags = tsv('data/raw_30s_cleantags.tsv')
voice_ann = {}
for k, r in tsv('derived/music-classification-annotations/music-classification-annotations-clean.tsv').items():
    for t in r['tags']:
        if t.startswith('voice_instrumental---'):
            answers = set(t.split('---')[1].split(','))
            if len(answers) == 1: voice_ann[k] = answers.pop()
archived = {line.split()[1].split('/')[-1].split('.')[0] for line in open(os.path.join(src, 'data/download/raw_30s_audio-low_sha256_tracks.txt'))}
genres = lambda k: sorted({t.split('---')[1] for t in alltags[k]['tags'] if t.startswith('genre---')})
inst = lambda k: {t.split('---')[1] for t in cands[k]['tags'] if t.startswith('instrument---')}
positives = lambda k: [c for c, tags in TAG_MAP.items() if inst(k) & set(tags)]

by_artist = {}
for k in sorted(cands):
    r = cands[k]
    if k in held_tracks or r['artist'] in held_artists or not is_val(r['artist']): continue
    if r['duration'] < MIN_DURATION or k.split('_')[1].lstrip('0') not in archived: continue
    by_artist.setdefault(r['artist'], []).append(k)
pool = sorted((k for ks in by_artist.values() for k in sorted(ks, key=lambda k: (cands[k]['split'] != 'validation', h(SEED, 'track', k)))[:PER_ARTIST]),
              key=lambda k: h(SEED, 'rank', k))
totals = {}
for k in pool:
    for c in positives(k): totals[c] = totals.get(c, 0) + 1
chosen = []
for cls in sorted(totals, key=lambda c: (totals[c], c)):
    have = sum(cls in positives(k) for k in chosen)
    for k in pool:
        if have >= min(PER_CLASS, totals[cls]): break
        if k not in chosen and cls in positives(k): chosen.append(k); have += 1
for k in pool:
    if len(chosen) >= MAX_ITEMS: break
    if k not in chosen: chosen.append(k)
chosen.sort(key=lambda k: h(SEED, 'rank', k))

AT = '2019-06-01T00:00:00Z'
items = []
for k in chosen:
    r = cands[k]; tagged_any = inst(k)
    reviews = []
    for cls, tags in TAG_MAP.items():
        tagged = bool(tagged_any & set(tags))
        if cls == 'voice' and k in voice_ann:
            said = 'present' if voice_ann[k] == 'voice' else 'absent'
            if said == 'absent' and tagged: continue
            reviews.append({'reviewer': 'MTG-Jamendo music-classification annotations (3 annotators agree)', 'at': AT,
                            'dimension': 'source', 'label': cls, 'state': said})
        elif tagged:
            reviews.append({'reviewer': 'MTG-Jamendo uploader tags', 'at': AT, 'dimension': 'source', 'label': cls, 'state': 'present'})
        else:
            reviews.append({'reviewer': 'MTG-Jamendo uploader tags (not tagged)', 'at': AT, 'dimension': 'source', 'label': cls,
                            'state': 'absent', 'weak': True})
    start = round(max(0.0, r['duration'] / 2 - CLIP / 2), 3)
    items.append({'id': 'ftj-' + h(SEED, k)[:16], 'source': f"MTG-Jamendo {k} (split-0 {r['split']}, tagger validation artist)",
                  'rights': {'evaluationAllowed': True, 'basis': 'MTG-Jamendo dataset (Creative Commons tracks; non-commercial research use); audio fetched at run time, never committed'},
                  'groups': {'original': f'jamendo:{k}', 'artist': f"jamendo:{r['artist']}", 'pack': f"jamendo:{r['album']}", 'sampleFamily': f"jamendo:{r['artist']}"},
                  'genres': genres(k), 'sampleKey': k, 'archivePath': r['path'].replace('.mp3', '.low.mp3'),
                  'start': start, 'end': round(start + CLIP, 3), 'split': 'tuning', 'tier': 'song', 'transformations': [], 'reviews': reviews})

if os.path.exists(OUT):
    if json.load(open(OUT))['items'] != items: sys.exit('Computed selection differs from the frozen manifest; refusing to continue.')
else:
    json.dump({'version': 1, 'frozenAt': '2026-10-07T00:00:00Z', 'seed': SEED, 'selection': __doc__.strip(), 'items': items}, open(OUT, 'w'), indent=1)
counts = {}
for it in items:
    for r in it['reviews']:
        c = counts.setdefault(r['label'], {'present': 0, 'absent': 0, 'weakAbsent': 0})
        c['weakAbsent' if r.get('weak') else r['state']] += 1
splits = {s: sum(cands[k]['split'] == s for k in chosen) for s in ('train', 'validation')}
print(f'{len(items)} tracks from {len(pool)} eligible ({len(by_artist)} artists, {len({cands[k]["artist"] for k in chosen})} chosen); splits {splits}')
print('labels per class:', json.dumps(counts))
print('manifest sha256', hashlib.sha256(open(OUT, 'rb').read()).hexdigest())
