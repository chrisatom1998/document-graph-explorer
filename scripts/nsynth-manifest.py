"""Turns NSynth notes into instrument training clips. Each note names its instrument family and
whether it was played acoustically, electronically or synthesized. Brass and reed are left out
because NSynth does not say which brass or reed instrument it is. The instrument (one sampled
instrument, e.g. guitar_acoustic_010) is the split key.
Usage: nsynth-manifest.py <nsynth extract dir> <out manifest.json> [cap per label]"""
import json, sys, glob, os, random, collections
ROOT, OUT = sys.argv[1:3]; CAP = int(sys.argv[3]) if len(sys.argv) > 3 else 300
LABEL = {('guitar', 'acoustic'): 'acoustic guitar', ('guitar', 'electronic'): 'electric guitar',
         ('keyboard', 'acoustic'): 'piano', ('keyboard', 'electronic'): 'electric piano',
         ('organ', 'electronic'): 'organ', ('string', 'acoustic'): 'strings', ('mallet', 'acoustic'): 'mallet instrument',
         ('flute', 'acoustic'): 'flute', ('bass', 'electronic'): 'bass guitar',
         ('bass', 'synthetic'): 'synthesizer', ('keyboard', 'synthetic'): 'synthesizer'}
rows = collections.defaultdict(list)
for split in sorted(glob.glob(f'{ROOT}/*/examples.json')):
    folder = os.path.dirname(split)
    for key, v in json.load(open(split)).items():
        label = LABEL.get((v['instrument_family_str'], v['instrument_source_str']))
        if label: rows[label].append({'id': f'nsynth:{key}', 'path': f'{folder}/audio/{key}.wav',
                                      'labels': [label], 'group': f"nsynth:{v['instrument_str']}"})
random.seed(20261004); clips = []
for label, items in sorted(rows.items()):
    # Spread the cap across instruments so no single sampled instrument defines the label.
    random.shuffle(items); per = collections.defaultdict(list)
    for it in items: per[it['group']].append(it)
    chosen, i = [], 0
    while len(chosen) < CAP and any(i < len(v) for v in per.values()):
        for v in per.values():
            if i < len(v) and len(chosen) < CAP: chosen.append(v[i])
        i += 1
    clips += chosen
    print(f'  {label:<18}{len(items):>6} notes  {len(chosen):>4} chosen  from {len({c["group"] for c in chosen})} instruments')
json.dump({'kind': 'nsynth-notes-v1', 'clips': clips}, open(OUT, 'w'))
