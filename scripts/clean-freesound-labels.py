"""Writes a cleaned Freesound training manifest: drops clips whose file name says they are a
different sound than their folder (e.g. a "snare" in the 808-bass folder), plus clips a listener
flagged. Character folders (distorted, reverberant, echoing, filtered) are left out; they are
trained separately as character heads.
Usage: clean-freesound-labels.py <index.json> <out manifest.json> <dropped report.json>"""
import json, re, sys, os

INDEX, OUT, REPORT = sys.argv[1:4]
CHARACTER = {'distorted', 'reverberant', 'echoing', 'filtered'}
# Words a file name uses for each folder's sound. A name with another folder's word and none of its own is dropped.
WORDS = {'808 bass': ['808'], 'atmospheric pad': ['pad', 'atmosphere', 'atmospheric', 'ambient', 'drone'],
         'breakbeat': ['break', 'breakbeat', 'breaks', 'amen'], 'clap': ['clap', 'claps', 'handclap'],
         'glitch effect': ['glitch', 'glitchy', 'stutter', 'bitcrush'], 'impact': ['impact', 'boom', 'hit', 'slam'],
         'kick': ['kick', 'kik', 'bassdrum', 'bd'], 'noise sweep': ['sweep', 'noise'], 'riser': ['riser', 'rise', 'uplifter', 'build'],
         'snare': ['snare', 'sd', 'rimshot'], 'sub bass': ['sub', 'subbass'], 'synth chord': ['chord', 'chords'],
         'synth stab': ['stab', 'stabs'], 'vinyl scratch': ['scratch', 'scratching', 'turntable'], 'whoosh': ['whoosh', 'swoosh', 'woosh', 'swish'],
         'wobble bass': ['wobble', 'wub', 'dubstep']}
# Flagged by ear in a spot check (folder/file): 808sd5horntail is a snare, swoosh a swoosh, DL_BA019_175 a drum loop.
FLAGGED = {'808-bass/808sd5horntail.wav', 'synth-chord/swoosh.wav', 'glitch-effect/dl_ba019_175.wav'}
tokens = lambda s: set(re.findall(r'[a-z0-9]+', s.lower().replace('_', ' ')))
keep, dropped = [], []
for it in json.load(open(INDEX))['items']:
    label = it['label']; folder = os.path.basename(os.path.dirname(it['file']))
    if label in CHARACTER: continue
    name = it.get('name') or os.path.basename(it['file']); t = tokens(name) | tokens(os.path.splitext(os.path.basename(it['file']))[0])
    own = set(WORDS.get(label, [])) & t; other = {l for l, ws in WORDS.items() if l != label and set(ws) & t}
    flagged = f"{folder}/{name}".lower() in FLAGGED or f"{folder}/{os.path.basename(it['file'])}".lower() in FLAGGED
    clip = {'id': f"fs:{folder}:{it['id']}", 'labels': [label], 'group': it['username'], 'name': name}
    if flagged or (other and not own):
        dropped.append({**clip, 'why': 'flagged by ear' if flagged else f"name says {', '.join(sorted(other))}"}); continue
    keep.append(clip)
json.dump({'kind': 'freesound-clean-v1', 'clips': keep}, open(OUT, 'w'), indent=1)
json.dump({'kept': len(keep), 'dropped': dropped}, open(REPORT, 'w'), indent=1)
print(f'kept {len(keep)}, dropped {len(dropped)}')
for d in dropped[:40]: print(f"  {d['id']:<32} {d['name'][:40]:<42} {d['why']}")
