"""Turns two small percussion sets into training clips.
Freesound One-Shot Percussive: 10,254 single hits, each checked by ear to be one clean event.
  Drum type comes from the file name using the library labeller's words; the uploader is the split key.
Beatbox (BaDumTss): mouth imitations of kick/snare/hihat/clap. Labelled only "beatbox", so the
  trainer also learns that a mouth kick is not a kick. Augmented copies (-a-, -n-) are skipped.
Usage: percussion-manifest.py <out dir for audio> <out manifest.json>"""
import json, sys, os, re, zipfile, tarfile, importlib.util, collections
DATA = '/Users/chrisjohnson/Documents/Media/audio-datasets'
AUDIO, OUT = sys.argv[1:3]
spec = importlib.util.spec_from_file_location('labeler', 'scripts/label-sample-library.py')
labeler = importlib.util.module_from_spec(spec); spec.loader.exec_module(labeler)
catalog = {c['label']: c for c in json.load(open('src/audio/djCatalog.json'))['categories']}
DRUM_HIT = {l for l, c in catalog.items() if c.get('family') == 'drum-hit'}

def choose_labels(matched):
    """matched: drum-hit labels whose words appear in the file name (may be empty or several).
    Returns the labels to train with, or None to leave the file out."""
    # Every file is a checked single hit, so an unnamed one is still a percussion hit.
    if not matched: return {'percussion hit'}
    if len(matched) == 1: return matched
    # Rimshot and snare are one sound; other pairs are usually two sounds layered.
    return matched if matched == {'rimshot', 'snare'} else None

clips = []
# Freesound One-Shot Percussive
fs = f'{DATA}/freesound-one-shot-percussive'
names = json.load(open(f'{fs}/licenses.txt'))
out = f'{AUDIO}/freesound-percussive'; os.makedirs(out, exist_ok=True)
with zipfile.ZipFile(f'{fs}/one_shot_percussive_sounds.zip') as z:
    for member in z.namelist():
        if not member.endswith('.wav'): continue
        sid = os.path.basename(member)[:-4]; meta = names.get(sid)
        if not meta: continue
        matched = {l for l in labeler.match('x/' + meta['name']) if l in DRUM_HIT}
        labels = choose_labels(matched)
        if not labels: continue
        path = f'{out}/{sid}.wav'
        if not os.path.exists(path): open(path, 'wb').write(z.read(member))
        clips.append({'id': f'fsperc:{sid}', 'path': path, 'labels': sorted(labels), 'group': f"fsperc:{meta['username']}"})
print('freesound percussive:', dict(collections.Counter(l for c in clips for l in c['labels'])))
# Beatbox
bb = f'{DATA}/beatbox/dataset'; out = f'{AUDIO}/beatbox'; n = 0
for split in ('train', 'test'):
    with tarfile.open(f'{bb}/audio_{split}.tar.gz') as t:     # the test split's csv is a 72-byte stub, so read names here
        for m in t:
            if not m.isfile() or not m.name.endswith('.wav') or re.search(r'-[an]-\d+\.wav$', m.name): continue
            path = f'{out}/{m.name}'; os.makedirs(os.path.dirname(path), exist_ok=True)
            if not os.path.exists(path): open(path, 'wb').write(t.extractfile(m).read())
            take = re.match(r'\w+/\w+-(\d+)', m.name).group(1)       # one recorded take, all its sounds
            clips.append({'id': f'beatbox:{m.name}', 'path': path, 'labels': ['beatbox'], 'group': f'beatbox:{split}:{take}'}); n += 1
print('beatbox:', n)
json.dump({'kind': 'percussion-v1', 'clips': clips}, open(OUT, 'w'))
