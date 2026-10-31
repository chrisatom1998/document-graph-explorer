"""DSP effects for the tagger's effect renders, at 32 kHz. Ported from scripts/build-effect-renders.py (distorted,
reverberant, echoing, filtered) and scripts/build-character-renders.py (the other character effects), plus the two DJ
edits those scripts lack: a reversed sound and a stutter (beat-repeat) edit. Every render is loudness matched to the
dry note so level is no clue. apply(name, x, seed) returns the rendered float64 signal, or None if it came out unusable.
"""
import random
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

RATE = 32000
rms = lambda x: float(np.sqrt(np.mean(x ** 2)) + 1e-9)

def frac_delay(x, d):
    idx = np.arange(len(x)) - d; i0 = np.floor(idx).astype(int); f = idx - i0
    a = np.where((i0 >= 0) & (i0 < len(x)), x[np.clip(i0, 0, len(x) - 1)], 0); b = np.where((i0 + 1 >= 0) & (i0 + 1 < len(x)), x[np.clip(i0 + 1, 0, len(x) - 1)], 0)
    return a * (1 - f) + b * f

def warp(x, semitones):
    rate = 2 ** (semitones / 12); pos = np.cumsum(rate); pos = pos[pos < len(x) - 1]
    i0 = pos.astype(int); f = pos - i0; y = x[i0] * (1 - f) + x[i0 + 1] * f
    return np.concatenate([y, np.zeros(len(x) - len(y))])

def shelf(x, f, gain_db): return x + (10 ** (gain_db / 20) - 1) * sosfilt(butter(2, f, 'high', fs=RATE, output='sos'), x)

def fx(name, x, r):
    t = np.arange(len(x)) / RATE; n = len(x); peak = np.abs(x).max() + 1e-9
    if name == 'distorted':
        kind = r.choice(['drive', 'clip', 'crush'])
        if kind == 'drive': return np.tanh(x / peak * 10 ** (r.uniform(6, 24) / 20))
        if kind == 'clip': th = peak * r.uniform(.05, .25); return np.clip(x, -th, th)
        bits, hold = r.choice([4, 5, 6]), r.choice([2, 4, 6])
        return np.repeat((np.round(x / peak * 2 ** (bits - 1)) / 2 ** (bits - 1))[::hold], hold)[:n]
    if name == 'reverberant':
        rt60, wet, pre = r.uniform(.8, 3.5), r.uniform(.3, .6), int(r.uniform(0, .04) * RATE)
        m = int(rt60 * RATE); ir = np.random.default_rng(r.randrange(1 << 30)).standard_normal(m) * np.exp(-6.91 * np.arange(m) / RATE / rt60)
        ir = sosfilt(butter(2, r.uniform(4000, 9000), 'low', fs=RATE, output='sos'), ir)
        ir = np.concatenate([np.zeros(pre), ir / np.sqrt(np.sum(ir ** 2))]); w = fftconvolve(x, ir)[:n]
        return (1 - wet) * x / rms(x) + wet * w / rms(w)
    if name == 'echoing':
        gap, fb, y = int(r.uniform(.15, .5) * RATE), r.uniform(.3, .6), x.copy()
        for k in range(1, r.randint(3, 6) + 1):
            if k * gap < n: y[k * gap:] += fb ** k * x[:n - k * gap]
        return y
    if name == 'filtered':
        sos = butter(4, r.uniform(300, 1200), 'low', fs=RATE, output='sos') if r.random() < .6 else butter(4, r.uniform(1500, 4000), 'high', fs=RATE, output='sos')
        return sosfilt(sos, sosfilt(sos, x))
    if name == 'chorused':
        y = x.copy()
        for _ in range(r.randint(2, 3)):
            base, depth, lfo = r.uniform(.012, .03) * RATE, r.uniform(.0015, .005) * RATE, r.uniform(.3, 1.5)
            y += frac_delay(x, base + depth * np.sin(2 * np.pi * lfo * t + r.uniform(0, 6.3)))
        return y
    if name == 'flanged':
        d = (r.uniform(.001, .002) + r.uniform(.002, .004) * (1 + np.sin(2 * np.pi * r.uniform(.1, .6) * t)) / 2) * RATE
        fb, y = r.uniform(.5, .8), x.copy()
        for _ in range(3): y = x + fb * frac_delay(y, d)
        return .5 * x + .5 * y / (np.abs(y).max() + 1e-9) * peak
    if name == 'bitcrushed':
        bits, hold = r.randint(3, 6), r.choice([4, 6, 8, 12, 16])
        return np.repeat((np.round(x / peak * 2 ** (bits - 1)) / 2 ** (bits - 1))[::hold], hold)[:n]
    if name == 'saturated': return np.tanh(x / peak * 10 ** (r.uniform(3, 9) / 20))
    if name == 'wobbling':
        lfo, lo, hi = r.uniform(1, 6), r.uniform(200, 400), r.uniform(2000, 3500); y, zi, B = np.zeros(n), None, 256
        for s in range(0, n, B):
            sos = butter(2, lo * (hi / lo) ** ((1 + np.sin(2 * np.pi * lfo * s / RATE)) / 2), 'low', fs=RATE, output='sos')
            if zi is None: zi = np.zeros((sos.shape[0], 2))
            y[s:s + B], zi = sosfilt(sos, x[s:s + B], zi=zi)
        return y
    if name == 'swelling': return x * np.clip(t / (r.uniform(.6, 1.0) * t[-1] + 1e-9), 0, 1) ** r.uniform(1.5, 3)
    if name == 'pulsing':
        rate, depth = r.uniform(2, 8), r.uniform(.8, 1)
        lfo = (np.sin(2 * np.pi * rate * t) > 0).astype(float) if r.random() < .5 else (1 + np.sin(2 * np.pi * rate * t)) / 2
        return x * (1 - depth + depth * lfo)
    if name == 'gliding':
        k = r.randint(2, 3); cuts = sorted(r.uniform(.15, .6) for _ in range(k - 1)); levels = [0.0]
        for _ in cuts: levels.append(levels[-1] + r.choice([-1, 1]) * r.uniform(2, 7))
        st = np.full(n, levels[0]); slide = r.uniform(.08, .3) * RATE
        for c, a, b in zip(cuts, levels, levels[1:]): st += (b - a) * np.clip((np.arange(n) - int(c * n)) / slide, 0, 1)
        return warp(x, st)
    if name in ('rising', 'falling'): return warp(x, r.uniform(5, 24) * (1 if name == 'rising' else -1) * (t / t[-1]) ** r.uniform(.7, 1.6))
    if name == 'bright': return shelf(x, r.uniform(3000, 6000), r.uniform(8, 14))
    if name == 'dark': return shelf(x, r.uniform(800, 2000), -r.uniform(8, 14))
    if name == 'reverse effect':
        y = x[::-1].copy(); lead = int(np.argmax(np.abs(y) > .01 * peak)); return np.concatenate([y[lead:], np.zeros(lead)])
    if name == 'stutter effect':
        sl = int(RATE * 60 / r.uniform(110, 175) / r.choice([4, 8])); start = int(r.uniform(0, .3) * n); reps = r.randint(4, 12)
        piece = x[start:start + sl] * np.minimum(1, np.minimum(np.arange(sl), np.arange(sl)[::-1]) / 64)     # 2 ms fades
        y = np.concatenate([x[:start], np.tile(piece, reps), x[start + sl:]])[:n]
        return np.concatenate([y, np.zeros(n - len(y))])
    if name == 'record stop':   # turntable/tape stop: playback slows to a halt over 0.4-1.5 s from a point in the sound
        at, dur = int(r.uniform(.2, .6) * n), r.uniform(.4, 1.5)
        speed = np.concatenate([np.ones(at), np.clip(1 - np.arange(n - at) / (dur * RATE), 0, 1) ** r.uniform(1, 2)])
        pos = np.cumsum(speed); pos = pos[pos < n - 1]; i0 = pos.astype(int); f = pos - i0
        y = x[i0] * (1 - f) + x[i0 + 1] * f; y[-int(.02 * RATE):] *= np.linspace(1, 0, int(.02 * RATE))
        return np.concatenate([y[:at + int(dur * RATE)], np.zeros(n - min(len(y), at + int(dur * RATE)))])[:n]
    if name in ('vinyl crackle', 'static noise'):
        g = np.random.default_rng(r.randrange(1 << 30))
        if name == 'vinyl crackle':
            noise = np.zeros(n); k = g.integers(0, n, int(n / RATE * r.uniform(40, 200)))
            noise[k] = g.standard_normal(len(k)) * g.pareto(2.5, len(k)); noise = sosfilt(butter(2, [800, 9000], 'band', fs=RATE, output='sos'), noise)
            noise += .05 * sosfilt(butter(2, 400, 'low', fs=RATE, output='sos'), g.standard_normal(n))     # rumble
        else: noise = sosfilt(butter(2, r.uniform(2000, 8000), 'low', fs=RATE, output='sos'), g.standard_normal(n))
        return x / rms(x) + noise / rms(noise) * 10 ** (-r.uniform(6, 18) / 20)
    raise ValueError(name)

def apply(name, x, seed):
    y = fx(name, np.asarray(x, np.float64), random.Random(seed))
    if not np.isfinite(y).all(): return None
    y = y * rms(x) / rms(y); y *= min(1.0, .95 / (np.abs(y).max() + 1e-9))
    return None if rms(y) < .25 * rms(x) else y

# Effects rendered onto real music windows (Mixing Secrets songs, Chris's train-half loops and stems) for run 7:
# the processing tags plus the DJ edits that stay recognisable on a full mix.
MUSIC_FX = ['bitcrushed', 'flanged', 'chorused', 'saturated', 'filtered', 'reverberant', 'echoing', 'rising', 'falling',
            'distorted', 'stutter effect', 'reverse effect', 'wobbling', 'pulsing', 'gliding']
# Effects a dry real recording almost never carries, so a dry window can count as a (weak) absence of them.
CLEAR_FX = ['bitcrushed', 'flanged', 'rising', 'falling', 'stutter effect', 'reverse effect', 'gliding']
# Edits that rearrange the audio in time, after which a loop's own tags (e.g. 'drum loop') may no longer hold.
TIME_EDITS = {'stutter effect', 'reverse effect', 'rising', 'falling', 'gliding'}
