"""Renders electronic sounds dry and with four effects, as matched training pairs for the character heads.

The effect heads learned from guitar/bass takes (IDMT, EGFxSet) and turned into "guitar with an effect"
detectors. Here every source is electronic (Surge synth notes, Slakh synth and drum parts, WaivOps drum-machine
loops) and appears in five versions, so the only thing separating them is the effect:
  dry          the source, untouched
  distorted    tanh drive (+6 to +24 dB), hard clip or bit crush
  reverberant  convolution with a synthetic room/hall (RT60 0.8-3.5 s, 30-60% wet, 0-40 ms pre-delay)
  echoing      3-6 delay taps, 150-500 ms apart, feedback 0.3-0.6
  filtered     steep low-pass (300-1200 Hz) or high-pass (1.5-4 kHz)
All versions share one length (source + 2 s tail, at most 10 s), are mono 48 kHz, and are matched in RMS
loudness so level is no clue (a variant the peak limit leaves nearly silent is dropped). Surge presets whose names mention an effect are skipped.
Usage: build-effect-renders.py <out dir> [sources]"""
import json, sys, os, re, random, subprocess, wave
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from joblib import Parallel, delayed

OUT = sys.argv[1]; COUNT = int(sys.argv[2]) if len(sys.argv) > 2 else 600
FP = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints'
RATE, MAX = 48000, 10.0
EFFECT_WORDS = re.compile(r'dist|drive|fuzz|crush|grit|dirt|satur|verb|hall|room|space|echo|delay|filter|sweep|lfo|wah', re.I)
rand = random.Random(20261005)

def sources():
    surge = [c for c in json.load(open(f'{FP}/extras/surge.json'))['clips'] if not EFFECT_WORDS.search(c['group'])]
    slakh = [c for c in json.load(open(f'{FP}/extras/slakh.json'))['clips'] if {'synthesizer', 'drums'} & set(c['labels'])]
    loops = [c for c in json.load(open(f'{FP}/extras/waivops.json'))['clips'] if os.path.exists(c['path'])]
    pick = lambda pool, n: rand.sample(pool, min(n, len(pool)))
    out = [('surge:' + re.sub(r'-velocity\d+$', '', c['group']), c) for c in pick(surge, int(COUNT * .4))]
    out += [('slakh:' + c['id'].split('/')[1], c) for c in pick(slakh, int(COUNT * .3))]
    out += [('waivops:' + c['group'], c) for c in pick(loops, COUNT - len(out))]
    return out

def decode(path):
    raw = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-t', str(MAX), '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)
rms = lambda x: float(np.sqrt(np.mean(x ** 2)) + 1e-9)

def distort(x, r):
    kind = r.choice(['drive', 'clip', 'crush'])
    if kind == 'drive': return np.tanh(x / (np.abs(x).max() + 1e-9) * 10 ** (r.uniform(6, 24) / 20)), f'drive'
    if kind == 'clip':
        t = np.abs(x).max() * r.uniform(.05, .25); return np.clip(x, -t, t), 'clip'
    bits, hold = r.choice([4, 5, 6]), r.choice([2, 4, 6])
    y = np.round(x / (np.abs(x).max() + 1e-9) * 2 ** (bits - 1)) / 2 ** (bits - 1)
    return np.repeat(y[::hold], hold)[:len(x)], f'crush{bits}'

def reverb(x, r):
    rt60, wet, pre = r.uniform(.8, 3.5), r.uniform(.3, .6), int(r.uniform(0, .04) * RATE)
    n = int(rt60 * RATE); t = np.arange(n) / RATE
    ir = np.random.default_rng(r.randrange(1 << 30)).standard_normal(n) * np.exp(-6.91 * t / rt60)
    ir = sosfilt(butter(2, r.uniform(4000, 9000), 'low', fs=RATE, output='sos'), ir)   # darker tail, like real rooms
    ir = np.concatenate([np.zeros(pre), ir / np.sqrt(np.sum(ir ** 2))])
    w = fftconvolve(x, ir)[:len(x)]
    return (1 - wet) * x / rms(x) + wet * w / rms(w), f'rt{rt60:.1f}'

def echo(x, r):
    gap, fb, taps = int(r.uniform(.15, .5) * RATE), r.uniform(.3, .6), r.randint(3, 6)
    y = x.copy()
    for k in range(1, taps + 1):
        if k * gap < len(x): y[k * gap:] += fb ** k * x[:len(x) - k * gap]
    return y, f'{gap * 1000 // RATE}ms'

def filt(x, r):
    if r.random() < .6: f = r.uniform(300, 1200); sos = butter(4, f, 'low', fs=RATE, output='sos'); name = f'lp{f:.0f}'
    else: f = r.uniform(1500, 4000); sos = butter(4, f, 'high', fs=RATE, output='sos'); name = f'hp{f:.0f}'
    return sosfilt(sos, sosfilt(sos, x)), name

def render(i, group, clip):
    r = random.Random(f'effect-render|{clip["id"]}')
    x = decode(clip['path'])
    if len(x) < RATE // 2 or rms(x) < 1e-4: return []
    length = min(int(MAX * RATE), len(x) + 2 * RATE)
    x = np.concatenate([x, np.zeros(length - len(x))]) if len(x) < length else x[:length]
    target = .1; rows = []
    for label, fx in (('dry', None), ('distorted', distort), ('reverberant', reverb), ('echoing', echo), ('filtered', filt)):
        y, how = (x, '') if fx is None else fx(x, r)
        y = y * target / rms(y); y *= min(1.0, .95 / (np.abs(y).max() + 1e-9))
        if rms(y) < .02: continue   # a spiky source the peak limit left nearly silent: no usable example
        path = f'{OUT}/audio/{i:05d}-{label}.wav'
        with wave.open(path, 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes((np.clip(y, -1, 1) * 32767).astype('<i2').tobytes())
        rows.append({'id': f'fxr:{i:05d}:{label}', 'path': path, 'label': label, 'labels': [label], 'group': group, 'sourceId': clip['id'], 'how': how})
    return rows

os.makedirs(f'{OUT}/audio', exist_ok=True)
picked = sources()
rows = [r for batch in Parallel(n_jobs=-1)(delayed(render)(i, g, c) for i, (g, c) in enumerate(picked)) for r in batch]
json.dump({'kind': 'effect-renders-v1', 'clips': rows}, open(f'{OUT}/manifest.json', 'w'))
print(len(picked), 'sources ->', len(rows), 'renders,', len({r['group'] for r in rows}), 'groups')
