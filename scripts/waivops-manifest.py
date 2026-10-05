"""Turns the WaivOps drum-loop sets into training clips. Each loop ships with the list of drum
notes it plays, so loop types come from what is actually in the loop, not from file names:
no kick -> top loop, only hats -> hi-hat loop, only hand percussion -> percussion loop.
Usage: waivops-manifest.py <out manifest.json> [clips per set]"""
import json, sys, glob, os, random, collections
ROOT = '/Users/chrisjohnson/Documents/Media/audio-datasets'
OUT = sys.argv[1]; PER_SET = int(sys.argv[2]) if len(sys.argv) > 2 else 1500
SETS = {'waivops-edm-tech': 'json/*.json', 'waivops-edm-hse': 'json/*/*.json', 'waivops-hh-trp': 'json/*.json'}
KICK = ('kick', '808')
HAT = ('hat',)
PERC = ('shaker', 'claves', 'clave', 'percussion', 'conga', 'cabasa', 'maracas', 'tambourine', 'wood block', 'cowbell', 'stick')

def loop_labels(names):
    names = [n.lower() for n in names]
    out = ['drum loop']
    if not any(k in n for n in names for k in KICK): out.append('top loop')
    if names and all(any(k in n for k in HAT) for n in names): out.append('hi-hat loop')
    if names and all(any(k in n for k in PERC) for n in names):
        out.append('shaker loop' if all('shaker' in n for n in names) else 'percussion loop')
    return out

random.seed(20261004); clips = []
for ds, pattern in SETS.items():
    keymap = {k['note']: k['label'] for k in json.load(open(f'{ROOT}/{ds}/key_map_drum_note_labels.json'))['key_map_drum_note_labels']}
    rows = []
    for f in glob.glob(f'{ROOT}/{ds}/{pattern}'):
        for name, info in json.load(open(f)).items():
            labels = loop_labels([keymap[p] for p in info.get('pitch', []) if p in keymap])
            kit = name.split('_drm_')[-1].rsplit('_', 1)[0] if '_drm_' in name else name.split('bpm_')[-1].rsplit('_', 1)[0]
            rows.append({'id': f'{ds}:{name}', 'name': name, 'labels': labels, 'group': f'{ds}:{kit}'})
    # Keep every rarer loop type, then split the rest evenly between loops with and without a kick.
    random.shuffle(rows)
    rare = [r for r in rows if len(r['labels']) > 2]
    top = [r for r in rows if r['labels'] == ['drum loop', 'top loop']]; kick = [r for r in rows if r['labels'] == ['drum loop']]
    half = max(0, PER_SET - len(rare)) // 2
    picked = rare + top[:half] + kick[:PER_SET - len(rare) - min(half, len(top))]; clips += picked
    print(ds, len(rows), 'loops,', len(picked), 'picked:', dict(collections.Counter(l for r in picked for l in r['labels'])))
json.dump({'kind': 'waivops-loops-v1', 'clips': clips}, open(OUT, 'w'))
