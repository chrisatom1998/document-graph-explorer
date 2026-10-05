"""Builds layered training and test mixtures: an effect or synth sound placed inside a drum loop.

The app hears sounds inside 10-second song windows, under drums. These mixes copy that:
  bed     a WaivOps drum loop, tiled to exactly 10.0 s (mono, 48 kHz, so CLAP never repeat-pads)
  target  an effect or synth clip (Epidemic, Freesound, Surge) at a random start that keeps its tail
          inside the window, set -12 to +6 dB against the bed (stored per mix as `levelDb`)
Labels are the target's effect/synth/texture labels plus "drum loop" (the bed), so drum heads never
read a mix as "no drums". Only families a drum bed cannot contain are targets.

Test mixes use held-out target groups (Freesound uploaders, Surge presets with every velocity,
Epidemic clips) and held-out drum kits. `excludeIds` lists every isolated clip those test targets
came from, so training (isolated or mixed) never hears them.
REPEATS=k layers every training target into k different drum loops; SPLITS=train builds only training mixes
(the test set and its exclusions do not depend on either). Rendering runs on every core.
Usage: build-mixtures.py <out dir> [train per label] [test per label]"""
import json, sys, os, re, hashlib, random, subprocess, wave, collections
import numpy as np
from joblib import Parallel, delayed

OUT = sys.argv[1]; PER_TRAIN = int(sys.argv[2]) if len(sys.argv) > 2 else 120; PER_TEST = int(sys.argv[3]) if len(sys.argv) > 3 else 40
FP = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints'
INDEX = '/Users/chrisjohnson/Documents/Media/dj-training-sounds/index.json'
RATE, SECONDS = 48000, 10.0
N = int(RATE * SECONDS)
FAMILIES = {'transition', 'texture', 'synth'}
catalog = {c['label']: c for c in json.load(open('src/audio/djCatalog.json'))['categories']}
rand = random.Random(20261005)
held = lambda key, share=0.25: int(hashlib.sha256(f'mix|{key}'.encode()).hexdigest()[:8], 16) / 0xffffffff < share

def wanted(labels): return sorted(l for l in labels if catalog.get(l, {}).get('family') in FAMILIES)

# Targets: (id, labels, independence key, audio path). Surge velocities of one preset share a key.
targets = []
fs_paths = {f"fs:{os.path.basename(os.path.dirname(it['file']))}:{it['id']}": it['file'] for it in json.load(open(INDEX))['items']}
for c in json.load(open(f'{FP}/extras/freesound-clean.json'))['clips']:
    if c['id'] in fs_paths and wanted(c['labels']): targets.append((c['id'], wanted(c['labels']), 'fs:' + c['group'], fs_paths[c['id']]))
for c in json.load(open(f'{FP}/extras/epidemic.json'))['clips']:
    if wanted(c['labels']): targets.append((c['id'], wanted(c['labels']), c['group'], c['path']))
for c in json.load(open(f'{FP}/extras/surge.json'))['clips']:
    if wanted(c['labels']): targets.append((c['id'], wanted(c['labels']), 'surge:' + re.sub(r'-velocity\d+$', '', c['group']), c['path']))
beds = [c for c in json.load(open(f'{FP}/extras/waivops.json'))['clips'] if os.path.exists(c['path'])]
test_beds = [b for b in beds if held('bed:' + b['group'])]; train_beds = [b for b in beds if not held('bed:' + b['group'])]

def pick(split):
    """Up to PER label clips per label, rarest labels first so small labels keep their share."""
    pool = [t for t in targets if held(t[2]) == (split == 'test')]; per = PER_TEST if split == 'test' else PER_TRAIN
    by = collections.defaultdict(list)
    for t in pool:
        for l in t[1]: by[l].append(t)
    chosen, count = {}, collections.Counter()
    for l in sorted(by, key=lambda l: len(by[l])):
        rand.shuffle(by[l])
        for t in by[l]:
            if count[l] >= per: break
            if t[0] not in chosen: chosen[t[0]] = t; count.update(t[1])
    return list(chosen.values())

def decode(path, limit=None):
    args = ['ffmpeg', '-nostdin', '-v', 'error', '-i', path] + (['-t', str(limit)] if limit else []) + ['-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-']
    return np.frombuffer(subprocess.run(args, capture_output=True, check=True).stdout, dtype=np.float32).copy()
rms = lambda x: float(np.sqrt(np.mean(x.astype(np.float64) ** 2)) + 1e-9)

def render(target, bed, level_db, path, u):
    b = decode(bed['path'])
    b = np.tile(b, int(np.ceil(N / max(len(b), 1))))[:N]
    t = decode(target[3], limit=SECONDS)
    # Trim leading/trailing near-silence so "start" and level refer to the audible sound.
    loud = np.where(np.abs(t) > 1e-3)[0]
    t = t[loud[0]:loud[-1] + 1] if len(loud) else t
    if len(t) < RATE // 20: return None
    start = int(u * (N - len(t))) if len(t) < N else 0
    t = t[:N - start]
    gain = rms(b) / rms(t) * 10 ** (level_db / 20)
    mix = b.copy(); mix[start:start + len(t)] += gain * t
    mix *= 0.89 / max(float(np.abs(mix).max()), 1e-9)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes((np.clip(mix, -1, 1) * 32767).astype('<i2').tobytes())
    return start / RATE, len(t) / RATE

os.makedirs(f'{OUT}/audio', exist_ok=True)
exclude = sorted({t[0] for t in targets if held(t[2])})
REPEATS = int(os.environ.get('REPEATS', '1')); SPLITS = os.environ.get('SPLITS', 'train,test').split(',')
for split, bedset in (('train', train_beds), ('test', test_beds)):
    jobs = []
    for t in pick(split):
        for _ in range(REPEATS if split == 'train' else 1):
            bed = rand.choice(bedset); level = round(rand.uniform(-12, 6), 1)
            mid = 'mix:' + hashlib.sha256(f'{split}|{t[0]}|{bed["id"]}'.encode()).hexdigest()[:16]
            jobs.append((t, bed, level, f'{OUT}/audio/{mid[4:]}.wav', rand.random(), mid))
    if split not in SPLITS: continue
    placed = Parallel(n_jobs=-1)(delayed(render)(t, bed, level, path, u) for t, bed, level, path, u, _ in jobs)
    clips = [{'id': mid, 'path': path, 'labels': t[1] + ['drum loop'], 'group': t[2], 'targetId': t[0], 'bedId': bed['id'],
              'levelDb': level, 'startSeconds': p[0], 'targetSeconds': p[1]}
             for (t, bed, level, path, _, mid), p in zip(jobs, placed) if p is not None]
    json.dump({'kind': 'mixtures-v1', 'split': split, 'excludeIds': exclude, 'clips': clips}, open(f'{OUT}/{split}.json', 'w'))
    print(split, len(clips), 'mixes,', len({c['bedId'] for c in clips}), 'beds;',
          dict(collections.Counter(l for c in clips for l in c['labels'] if l != 'drum loop').most_common()))
print(len(exclude), 'isolated clips excluded from training (test targets)')
