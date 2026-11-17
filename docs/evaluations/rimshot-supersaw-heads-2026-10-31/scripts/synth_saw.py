"""DSP renders for supersaw training (renders only ever sit in training folds): detuned stacks of 5-9 saw voices
(positives) and matched non-supersaw synths (one saw, square, triangle/sine pads, FM plucks) as hard negatives, same notes,
envelopes and filters. Usage: synth_saw.py <out dir> <n per class>"""
import json, os, sys, numpy as np, wave
OUT, N = sys.argv[1], int(sys.argv[2]); SR = 48000; os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)
def saw(f, t, ph): return 2 * ((f * t + ph) % 1) - 1
def blsaw(f, t, ph):  # mild band-limit: average two half-sample offsets
    return 0.5 * (saw(f, t, ph) + saw(f, t + 0.5 / SR, ph))
def env(n, a, d, s, r):
    e = np.ones(n) * s; ai, di, ri = int(a * SR), int(d * SR), int(r * SR)
    e[:ai] = np.linspace(0, 1, ai) if ai else e[:ai]; e[ai:ai + di] = np.linspace(1, s, len(e[ai:ai + di]))
    if ri: e[-ri:] *= np.linspace(1, 0, ri)
    return e
from scipy.signal import butter, sosfilt, fftconvolve
def lp(x, fc): return sosfilt(butter(2, fc, fs=SR, output='sos'), x)
def rev(x):
    ir = rng.standard_normal(int(SR * 1.2)) * np.exp(-np.linspace(0, 6, int(SR * 1.2))); ir /= np.abs(ir).sum() / 3
    return x + 0.25 * fftconvolve(x, ir)[:len(x)]
def notes():
    root = 36 + rng.integers(0, 36); kind = rng.choice(['note', 'chord', 'chord', 'seq'])
    if kind == 'note': return [[root]], kind
    ch = [root, root + rng.choice([3, 4]), root + 7] + ([root + 12] if rng.random() < .5 else [])
    if kind == 'chord': return [ch], kind
    return [[root + rng.choice([0, 3, 5, 7, 10, 12])] for _ in range(rng.integers(3, 9))], kind
def voice(cls, f, t):
    if cls == 'supersaw':
        nv = rng.integers(5, 10); spread = rng.uniform(10, 45)
        return sum(blsaw(f * 2 ** (rng.uniform(-spread, spread) / 1200), t, rng.random()) for _ in range(nv)) / np.sqrt(nv)
    if cls == 'saw': return blsaw(f, t, rng.random())
    if cls == 'square': return np.sign(np.sin(2 * np.pi * f * t)) * .7
    if cls == 'pad': return np.sin(2 * np.pi * f * t) + .3 * (2 * np.abs(saw(f, t, 0)) - 1)
    return np.sin(2 * np.pi * f * t + rng.uniform(1, 4) * np.exp(-6 * t) * np.sin(2 * np.pi * f * 2 * t))  # fm pluck
items = []
for cls in ['supersaw'] * 2 + ['saw', 'square', 'pad', 'fm']:
    for k in range(N if cls != 'supersaw' else N // 2 + N % 2):
        seq, kind = notes(); dur = rng.uniform(1.0, 6.0) if kind != 'seq' else rng.uniform(2, 8)
        step = dur / len(seq); x = np.zeros(int(dur * SR) + SR // 2)
        a, d, s, r = (rng.uniform(.001, .4), rng.uniform(.05, .6), rng.uniform(.3, 1), rng.uniform(.05, .8))
        if rng.random() < .3: a, s = .002, rng.uniform(0, .3)  # pluck / stab
        for i, ch in enumerate(seq):
            n = int(step * SR); t = np.arange(n) / SR; y = sum(voice(cls, 440 * 2 ** ((m - 69) / 12), t) for m in ch) / len(ch)
            o = int(i * step * SR); x[o:o + n] += y * env(n, min(a, step / 3), d, s, min(r, step / 3))
        x = lp(x, rng.uniform(1500, 14000))
        if rng.random() < .6: x = rev(x)
        x = x / (np.abs(x).max() + 1e-9) * rng.uniform(.3, .95)
        name = f'render-{cls}-{len(items):04d}'
        with wave.open(f'{OUT}/{name}.wav', 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x * 32767).astype('<i2').tobytes())
        items.append({'id': name, 'group': f'render-{cls}', 'kind': 'render-pos' if cls == 'supersaw' else 'render-neg',
                      'labels': ['supersaw'] if cls == 'supersaw' else [], 'path': f'{name}.wav'})
json.dump({'clips': items}, open(f'{OUT}/renders.json', 'w')); print(len(items), 'renders')
