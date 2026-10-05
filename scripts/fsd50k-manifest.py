"""Turns FSD50K into training clips. Its labels were checked by people, and every clip lists
every sound class heard in it, so a clip without "Piano" is real evidence of no piano. That
makes FSD50K the real-recording answer key for instruments. The uploader is the split key.
Usage: fsd50k-manifest.py <fsd50k extract dir> <out manifest.json> [cap per label] [negatives]"""
import json, sys, csv, random, collections
ROOT, OUT = sys.argv[1:3]; CAP = int(sys.argv[3]) if len(sys.argv) > 3 else 400
NEG = int(sys.argv[4]) if len(sys.argv) > 4 else 3000
MAP = {  # FSD50K class -> catalog label (instruments are 'source' labels, the rest DJ sounds)
    'Piano': 'piano', 'Acoustic_guitar': 'acoustic guitar', 'Electric_guitar': 'electric guitar',
    'Bass_guitar': 'bass guitar', 'Organ': 'organ', 'Trumpet': 'trumpet', 'Bowed_string_instrument': 'strings',
    'Marimba_and_xylophone': 'mallet instrument', 'Glockenspiel': 'mallet instrument', 'Harp': 'harp',
    'Harmonica': 'harmonica', 'Accordion': 'accordion', 'Tabla': 'tabla', 'Gong': 'gong', 'Drum_kit': 'drums',
    'Rain': 'rain ambience', 'Raindrop': 'rain ambience', 'Thunderstorm': 'rain ambience',
    'Stream': 'water ambience', 'Waves_and_surf': 'water ambience', 'Ocean': 'water ambience',
    'Trickle_and_dribble': 'water ambience', 'Wind': 'wind ambience', 'Crowd': 'crowd ambience',
    'Cheering': 'crowd ambience', 'Bird_vocalization_and_bird_call_and_bird_song': 'bird ambience',
    'Siren': 'siren', 'Whoosh_and_swoosh_and_swish': 'whoosh', 'Scratching_(performance_technique)': 'vinyl scratch',
    'Bass_drum': 'kick', 'Snare_drum': 'snare', 'Crash_cymbal': 'crash cymbal', 'Finger_snapping': 'finger snap',
    'Cowbell': 'cowbell', 'Tambourine': 'tambourine', 'Whispering': 'whisper', 'Screaming': 'vocal scream',
    'Laughter': 'vocal laugh', 'Gasp': 'vocal gasp'}
info = {**json.load(open(f'{ROOT}/FSD50K.metadata/dev_clips_info_FSD50K.json')),
        **json.load(open(f'{ROOT}/FSD50K.metadata/eval_clips_info_FSD50K.json'))}
rows, negatives = collections.defaultdict(list), []
for split in ('dev', 'eval'):
    for r in csv.DictReader(open(f'{ROOT}/FSD50K.ground_truth/{split}.csv')):
        labels = sorted({MAP[c] for c in r['labels'].split(',') if c in MAP})
        clip = {'id': f"fsd50k:{r['fname']}", 'member': f"FSD50K.{split}_audio/{r['fname']}.wav", 'labels': labels,
                'group': f"fsd50k:{info.get(r['fname'], {}).get('uploader', r['fname'])}"}
        if labels:
            for l in labels: rows[l].append(clip)
        else: negatives.append(clip)
random.seed(20261004); chosen = {}
for label, items in sorted(rows.items()):
    # Spread the cap across uploaders so no single recordist defines the label.
    random.shuffle(items); per = collections.defaultdict(list)
    for it in items: per[it['group']].append(it)
    got, i = [], 0
    while len(got) < CAP and any(i < len(v) for v in per.values()):
        for v in per.values():
            if i < len(v) and len(got) < CAP: got.append(v[i])
        i += 1
    for c in got: chosen[c['id']] = c
    print(f'  {label:<18}{len(items):>6} clips  {len(got):>4} chosen  from {len({c["group"] for c in got})} uploaders')
random.shuffle(negatives)
for c in negatives[:NEG]: chosen[c['id']] = c
print(f'{len(chosen)} clips ({min(NEG, len(negatives))} with none of these sounds)')
json.dump({'kind': 'fsd50k-v1', 'clips': list(chosen.values())}, open(OUT, 'w'))
