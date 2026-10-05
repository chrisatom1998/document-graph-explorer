"""Labels Surge preset renders with synth-TYPE tags taken from the preset's own name
(e.g. "Emu-Basses-Acidy-FM-Boy" -> fm synth, acid bass). The existing surge.json only uses the
preset category (Leads, Pads...), so these types had almost no training audio.
One clip per rendered note, NOTES_PER_PRESET notes spread over the range; group = preset, so tests
hold out whole presets. Reuses fingerprints already in surge-clap; the rest need embed-clap.mjs.
Usage: surge-name-manifest.py <out-dir>"""
import json, sys, os, re, glob
ROOT = '/Users/chrisjohnson/Documents/Media/audio-datasets/surge-presets/x/surge'
FP = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints'
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
N = int(os.environ.get('NOTES_PER_PRESET', 14))
RULES = [  # (label, name regex, category restriction or None, max midi note or None)
    ('fm synth', r'fm|dx|chowning', None, None),
    ('acid synth', r'acid|303', ('Leads', 'Sequences', 'Lead', 'Plucks'), None),
    ('acid bass', r'acid|303', ('Basses', 'Bass'), None),
    ('organ synth', r'organ|hammond|drawbar', None, None),
    ('string synth', r'strings?|ensemble|solina', ('Pads', 'Leads', 'Chords', 'Atmospheres', 'Plucks'), None),
    ('brass synth', r'brass|horns?', None, None),
    ('vocal-like synth', r'vox|formant|vocoder|voices?|choir|vowel|talk', None, None),
    ('synth stab', r'stab', None, None),
    ('synth hit', r'hit|orch', None, None),
    ('supersaw', r'super ?saw|hoover|trance', None, None),
    ('rubbery bass', r'rubber', None, None),
    ('chiptune synth', r'chip|8 ?bit|nes|gameboy|square', ('Leads', 'Lead', 'Sequences', 'Plucks', 'Arps'), None),
    ('bass pluck', r'pluck|short|staccato', ('Basses', 'Bass'), None),
    ('bass pluck', r'.', ('Plucks',), 45),
    ('reese bass', r'reese|hoover', ('Basses', 'Bass'), None),
    ('bell synth', r'bells?', None, None),
]
existing = {}
for f in glob.glob(f'{FP}/surge-clap/emb-*.jsonl'):
    for line in open(f): r = json.loads(line); existing.setdefault(r['id'], line)
clips = {}
for preset in sorted(os.listdir(ROOT)):
    m = re.match(r'surge-patches-(?:3rdparty-[^-]+(?:-[^-]+)?|factory)-([A-Za-z]+)-(.*)-velocity64$', preset)
    if not m: continue
    words = ' ' + preset.lower().replace('-', ' ') + ' '
    category = next((c for c in ('Basses', 'Bass', 'Leads', 'Lead', 'Pads', 'Plucks', 'Atmospheres', 'Sequences', 'Chords', 'Arps', 'Organs', 'Brass', 'Percussion', 'Keys') if f'-{c}-' in preset), None)
    notes = sorted(glob.glob(f'{ROOT}/{preset}/note*.ogg'))
    if not notes: continue
    pick = notes if len(notes) <= N else [notes[round(i * (len(notes) - 1) / (N - 1))] for i in range(N)]
    for path in dict.fromkeys(pick):
        midi = int(re.search(r'note(\d+)', path).group(1))
        labels = [lab for lab, rx, cats, top in RULES if re.search(rf'(?<![a-z])({rx})(?![a-z])', words) and (cats is None or category in cats) and (top is None or midi <= top)]
        if not labels: continue
        cid = 'surge:' + path.split('/x/', 1)[1]
        clips[cid] = {'id': cid, 'path': path, 'labels': sorted(set(labels)), 'group': preset, 'midi': midi}
# Replaces surge.json in a round (same clips plus name labels): one row per clip, never two disagreeing copies.
base = {c['id']: c for c in json.load(open(f'{FP}/extras/surge.json'))['clips']}
for cid, c in clips.items():
    if cid in base: base[cid] = {**base[cid], 'labels': sorted(set(base[cid]['labels']) | set(c['labels']))}
    else: base[cid] = c
clips = base
json.dump({'kind': 'surge-names-v1', 'clips': list(clips.values())}, open(f'{OUT}/manifest.json', 'w'), indent=1)
reused = [existing[c] for c in clips if c in existing]
open(f'{OUT}/emb-reused.jsonl', 'w').writelines(reused)
todo = [c for c in clips.values() if c['id'] not in existing]
json.dump({'clips': todo}, open(f'{OUT}/todo.json', 'w'))
from collections import Counter
cnt = Counter(l for c in clips.values() for l in c['labels']); presets = Counter(l for l in {(l, c['group']) for c in clips.values() for l in c['labels']} for l in [l[0]])
for l, n in sorted(cnt.items()): print(f'{l:<18}{n:>5} clips {presets[l]:>4} presets')
print(f'{len(clips)} clips, {len(reused)} fingerprints reused, {len(todo)} to embed')
