"""Augments the REAL training-split DJ-effect clips, as extra TRAINING examples for the DJ-effect heads.

synth.py's from-scratch effects sounded too unlike real producer effects to help (train.py never picked them). This keeps the
real sound and varies it the way the same effect varies between sample packs and DJ sets: pitch/speed shift (±4 semitones),
EQ tilt, saturation, reverb, a random start offset, and often a music bed underneath at a random level (as in a mix).
Every copy keeps its source's labels and uploader group, so cross-validation never splits a clip from its copies and no copy
reaches the held-out test (held-out uploaders are never sources). train.py picks the copies per label only where they help
on the REAL training clips. Mono 48 kHz, at most 10 s. Deterministic.
Usage: aug.py <audio-manifest.json> <out dir>   env: COPIES (2)
Writes <out dir>/<id>.wav and <out dir>/manifest.json (clips: id, path, labels, group, split='train', kind='render')."""
import json, sys, os, subprocess, wave, random
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

MANIFEST, OUT = sys.argv[1:3]
COPIES = int(os.environ.get('COPIES', 2))
RATE, MAX = 48000, 10.0
os.makedirs(OUT, exist_ok=True)
rms = lambda x: float(np.sqrt(np.mean(x ** 2)) + 1e-9)


def decode(path, seconds=MAX + 2):
    raw = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-t', str(seconds), '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def filt(x, kind, f):
    return sosfilt(butter(2, np.clip(f, 20, RATE / 2 - 200), kind, fs=RATE, output='sos'), x)


def augment(x, r, bed):
    semis = r.uniform(-4, 4)
    if abs(semis) > .3:  # speed and pitch together, as on a turntable or a sampler
        ratio = 2 ** (semis / 12); n = int(len(x) / ratio)
        x = np.interp(np.arange(n) * ratio, np.arange(len(x)), x)
    if r.random() < .4: x = x[int(len(x) * r.uniform(0, .25)):]
    if r.random() < .5: x = filt(x, 'high', r.uniform(30, 400))
    if r.random() < .5: x = filt(x, 'low', r.uniform(2500, 14000))
    if r.random() < .25: x = np.tanh(x / (np.max(np.abs(x)) + 1e-9) * r.uniform(1.5, 4))
    if r.random() < .4:
        secs = r.uniform(.3, 2.5); L = int(RATE * secs)
        ir = np.random.default_rng(r.randrange(1 << 30)).normal(size=L) * np.exp(-np.arange(L) / RATE * 6.9 / secs)
        wet = fftconvolve(x, filt(ir, 'low', r.uniform(3000, 10000)))[:len(x)]
        w = r.uniform(.1, .45); x = x * (1 - w) + wet / rms(wet) * rms(x) * w
    x = x[:int(MAX * RATE)]
    if bed is not None and r.random() < .5:
        b = np.resize(bed, len(x)); x = x + b / rms(b) * rms(x) * r.uniform(.1, .6)
    return x / (np.max(np.abs(x)) + 1e-9) * r.uniform(.3, .95)


def write(path, y):
    pcm = (np.clip(y, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm.tobytes())


clips = json.load(open(MANIFEST))['clips']
train = [c for c in clips if c['split'] == 'train']
sources = sorted([c for c in train if c.get('labels')], key=lambda c: c['id'])
beds = sorted([c for c in train if c.get('kind') == 'plain-music'], key=lambda c: c['id'])
print(f'{len(sources)} training-split effect clips, {len(beds)} music beds, {COPIES} copies each')
r = random.Random('dj-effects-aug'); out = []; bed_cache = {}
for c in sources:
    try: x = decode(c['path'])
    except Exception: continue
    if len(x) < RATE * .1 or rms(x) < 1e-4: continue
    for k in range(COPIES):
        bed = None
        if beds:
            b = r.choice(beds)
            if b['id'] not in bed_cache:
                try: bed_cache[b['id']] = decode(b['path'])
                except Exception: bed_cache[b['id']] = None
                if len(bed_cache) > 300: bed_cache.pop(next(iter(bed_cache)))
            bed = bed_cache.get(b['id'])
        rid = f"aug:{k}:{c['id']}"; path = os.path.join(OUT, rid.replace(':', '_') + '.wav')
        y = augment(x, r, bed)
        if len(y) < RATE * .1 or not np.isfinite(y).all(): continue
        write(path, y)
        out.append({'id': rid, 'path': path, 'labels': list(c['labels']), 'group': c['group'], 'split': 'train', 'kind': 'render', 'source': c['id']})
json.dump({'kind': 'dj-effects-aug-v1', 'clips': out}, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=0)
print(f'{len(out)} augmented copies')
