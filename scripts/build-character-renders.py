"""Renders electronic sources with character/processing effects that build-effect-renders.py does not
cover, as matched training sets: each source appears dry and with up to EFFECTS_PER_SOURCE of these
(chosen per source by a fixed seed), loudness matched so level is no clue.
  chorused    2-3 voices, 12-30 ms delay swept 1.5-5 ms by 0.3-1.5 Hz LFOs, 50% wet
  flanged     1-6 ms delay swept by a 0.1-0.6 Hz LFO, feedback 0.5-0.8
  bitcrushed  3-6 bits with 4-16x sample-and-hold
  saturated   gentle tanh drive (+3 to +9 dB), unlike the heavy "distorted" renders
  wobbling    low-pass cutoff swept 250-3500 Hz by a 1-6 Hz LFO (dubstep-style wobble)
  swelling    volume rises from silence over 60-100% of the clip
  pulsing     80-100% depth square/sine tremolo at 2-8 Hz
  gliding     2-3 held pitches joined by 80-300 ms portamento slides (+-2..7 semitones)
  rising      pitch climbs 5-24 semitones across the clip
  falling     pitch drops 5-24 semitones across the clip
  bright      +8..+14 dB high shelf above 3-6 kHz
  dark        -8..-14 dB high shelf above 0.8-2 kHz (a gentle tilt, not the steep "filtered" low-pass)
Group = source preset/song/kit, so held-out tests never hear a training source.
Usage: build-character-renders.py <out dir> [sources]"""
import json, sys, os, re, random, subprocess, wave
import numpy as np
from scipy.signal import butter, sosfilt
from joblib import Parallel, delayed

OUT = sys.argv[1]; COUNT = int(sys.argv[2]) if len(sys.argv) > 2 else 900
PER = int(os.environ.get('EFFECTS_PER_SOURCE', 4))
FP = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints'
RATE, MAX = 48000, 10.0
EFFECT_WORDS = re.compile(r'dist|drive|fuzz|crush|grit|dirt|satur|verb|hall|room|space|echo|delay|filter|sweep|lfo|wah|chorus|flang|phase|wobble|glide|swell|pulse|trem', re.I)
rand = random.Random(20261006)

def sources():
    surge = [c for c in json.load(open(f'{FP}/extras/surge.json'))['clips'] if not EFFECT_WORDS.search(c['group'])]
    slakh = [c for c in json.load(open(f'{FP}/extras/slakh.json'))['clips'] if {'synthesizer', 'drums', 'piano', 'strings', 'electric guitar', 'organ'} & set(c['labels'])]
    loops = [c for c in json.load(open(f'{FP}/extras/waivops.json'))['clips'] if os.path.exists(c['path'])]
    pick = lambda pool, n: rand.sample(pool, min(n, len(pool)))
    out = [('surge:' + re.sub(r'-velocity\d+$', '', c['group']), c) for c in pick(surge, int(COUNT * .45))]
    out += [('slakh:' + c['id'].split('/')[1], c) for c in pick(slakh, int(COUNT * .35))]
    out += [('waivops:' + c['group'], c) for c in pick(loops, COUNT - len(out))]
    return out

def decode(path):
    raw = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-t', str(MAX), '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)
rms = lambda x: float(np.sqrt(np.mean(x ** 2)) + 1e-9)
t_of = lambda x: np.arange(len(x)) / RATE

def frac_delay(x, d):
    """y[n] = x[n - d[n]] with linear interpolation; d in samples (array)."""
    idx = np.arange(len(x)) - d; i0 = np.floor(idx).astype(int); f = idx - i0
    a = np.where((i0 >= 0) & (i0 < len(x)), x[np.clip(i0, 0, len(x) - 1)], 0); b = np.where((i0 + 1 >= 0) & (i0 + 1 < len(x)), x[np.clip(i0 + 1, 0, len(x) - 1)], 0)
    return a * (1 - f) + b * f

def warp(x, semitones):
    """Variable-rate resample: semitones[n] is the pitch shift at output sample n (tape-style, length kept)."""
    rate = 2 ** (semitones / 12); pos = np.cumsum(rate); pos = pos[pos < len(x) - 1]
    i0 = pos.astype(int); f = pos - i0; y = x[i0] * (1 - f) + x[i0 + 1] * f
    return np.concatenate([y, np.zeros(len(x) - len(y))])

def shelf(x, f, gain_db):
    hp = sosfilt(butter(2, f, 'high', fs=RATE, output='sos'), x)
    return x + (10 ** (gain_db / 20) - 1) * hp

def fx(name, x, r):
    t = t_of(x); n = len(x)
    if name == 'chorused':
        y = x.copy()
        for _ in range(r.randint(2, 3)):
            base, depth, lfo = r.uniform(.012, .03) * RATE, r.uniform(.0015, .005) * RATE, r.uniform(.3, 1.5)
            y += frac_delay(x, base + depth * np.sin(2 * np.pi * lfo * t + r.uniform(0, 6.3)))
        return y
    if name == 'flanged':
        d = (r.uniform(.001, .002) + r.uniform(.002, .004) * (1 + np.sin(2 * np.pi * r.uniform(.1, .6) * t)) / 2) * RATE
        fb, y = r.uniform(.5, .8), x.copy()
        for _ in range(3): y = x + fb * frac_delay(y, d)   # feedback approximated by iteration
        return .5 * x + .5 * y / (np.abs(y).max() + 1e-9) * np.abs(x).max()
    if name == 'bitcrushed':
        bits, hold = r.randint(3, 6), r.choice([4, 6, 8, 12, 16])
        y = np.round(x / (np.abs(x).max() + 1e-9) * 2 ** (bits - 1)) / 2 ** (bits - 1)
        return np.repeat(y[::hold], hold)[:n]
    if name == 'saturated':
        return np.tanh(x / (np.abs(x).max() + 1e-9) * 10 ** (r.uniform(3, 9) / 20))
    if name == 'wobbling':
        lfo, lo, hi = r.uniform(1, 6), r.uniform(200, 400), r.uniform(2000, 3500)
        y, zi, B = np.zeros(n), None, 256
        for s in range(0, n, B):
            c = lo * (hi / lo) ** ((1 + np.sin(2 * np.pi * lfo * s / RATE)) / 2)
            sos = butter(2, c, 'low', fs=RATE, output='sos')
            if zi is None: zi = np.zeros((sos.shape[0], 2))
            y[s:s + B], zi = sosfilt(sos, x[s:s + B], zi=zi)
        return y
    if name == 'swelling':
        k = r.uniform(.6, 1.0); env = np.clip(t / (k * t[-1] + 1e-9), 0, 1) ** r.uniform(1.5, 3)
        return x * env
    if name == 'pulsing':
        rate, depth = r.uniform(2, 8), r.uniform(.8, 1)
        lfo = (np.sin(2 * np.pi * rate * t) > 0).astype(float) if r.random() < .5 else (1 + np.sin(2 * np.pi * rate * t)) / 2
        return x * (1 - depth + depth * lfo)
    if name == 'gliding':
        k = r.randint(2, 3); cuts = sorted(r.uniform(.15, .85) for _ in range(k - 1)); levels = [0.0]
        for _ in cuts: levels.append(levels[-1] + r.choice([-1, 1]) * r.uniform(2, 7))
        st = np.full(n, levels[0]); slide = r.uniform(.08, .3) * RATE
        for c, a, b in zip(cuts, levels, levels[1:]):
            s = int(c * n); ramp = np.clip((np.arange(n) - s) / slide, 0, 1); st += (b - a) * ramp
        return warp(x, st)
    if name in ('rising', 'falling'):
        amount = r.uniform(5, 24) * (1 if name == 'rising' else -1)
        return warp(x, amount * (t / t[-1]) ** r.uniform(.7, 1.6))
    if name == 'bright': return shelf(x, r.uniform(3000, 6000), r.uniform(8, 14))
    if name == 'dark': return shelf(x, r.uniform(800, 2000), -r.uniform(8, 14))
    raise ValueError(name)

EFFECTS = ['chorused', 'flanged', 'bitcrushed', 'saturated', 'wobbling', 'swelling', 'pulsing', 'gliding', 'rising', 'falling', 'bright', 'dark']

def write(path, y):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes((np.clip(y, -1, 1) * 32767).astype('<i2').tobytes())

def render(i, group, clip):
    r = random.Random(f'character-render|{clip["id"]}')
    try: x = decode(clip['path'])
    except Exception: return []
    if len(x) < RATE or rms(x) < 1e-4: return []
    length = min(int(MAX * RATE), len(x) + RATE)
    x = np.concatenate([x, np.zeros(length - len(x))]) if len(x) < length else x[:length]
    rows = []
    for label in ['dry'] + r.sample(EFFECTS, PER):
        y = x if label == 'dry' else fx(label, x, r)
        y = y * .1 / rms(y); y *= min(1.0, .95 / (np.abs(y).max() + 1e-9))
        if rms(y) < .02 or not np.isfinite(y).all(): continue
        path = f'{OUT}/audio/{i:05d}-{label}.wav'; write(path, y)
        # 'dry' here only means "none of these effects"; it is not the catalog's dry/space label.
        rows.append({'id': f'chr:{i:05d}:{label}', 'path': path, 'labels': [] if label == 'dry' else [label], 'group': group, 'sourceId': clip['id']})
    return rows

os.makedirs(f'{OUT}/audio', exist_ok=True)
picked = sources()
rows = [r for batch in Parallel(n_jobs=int(os.environ.get('JOBS', 6)))(delayed(render)(i, g, c) for i, (g, c) in enumerate(picked)) for r in batch]
json.dump({'kind': 'character-renders-v1', 'clips': rows}, open(f'{OUT}/manifest.json', 'w'))
from collections import Counter
print(len(picked), 'sources ->', len(rows), 'renders,', len({r['group'] for r in rows}), 'groups', dict(Counter(l for r in rows for l in r['labels'])))
