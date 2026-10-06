"""Renders DJ effects onto plain music clips, as extra TRAINING examples for the DJ-effect heads.

Tagged Freesound clips are few for most effects (a tape stop or a backspin is tagged by a handful of uploaders),
so each effect is also applied by DSP to plain music clips (loops, one-shots and vocals that name no effect).
Only clips from TRAINING uploaders are used as sources, and each render keeps its source's uploader as its
group, so a render never reaches the held-out test and cross-validation never splits a source from its renders.
Held-out scoring stays on real tagged clips only; train.py uses renders only where they help on real training clips.
Every render is mono 48 kHz, at most 10 s, loudness-matched to its source. Deterministic (fixed seed).
Usage: render.py <audio-manifest.json> <out dir>   env: PER_EFFECT (220)
Writes <out dir>/<id>.wav and <out dir>/manifest.json (clips: id, path, labels, group, split='train', kind='render')."""
import json, sys, os, subprocess, wave, hashlib, random
import numpy as np
from scipy.signal import butter, sosfilt, sosfilt_zi

MANIFEST, OUT = sys.argv[1:3]
PER_EFFECT = int(os.environ.get('PER_EFFECT', 220))
RATE, MAX = 48000, 10.0
os.makedirs(OUT, exist_ok=True)
rms = lambda x: float(np.sqrt(np.mean(x ** 2)) + 1e-9)

def decode(path, seconds=MAX):
    raw = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-t', str(seconds), '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)

def resample_curve(x, rate_curve):
    """Plays x with a time-varying speed (1 = normal); returns as many samples as rate_curve."""
    pos = np.cumsum(rate_curve) - rate_curve[0]
    pos = np.clip(pos, 0, len(x) - 1)
    return np.interp(pos, np.arange(len(x)), x)

def beat(r):  # one beat in samples at a plausible tempo
    return int(RATE * 60 / r.uniform(85, 150))

def chops(x, r):
    b = beat(r) // r.choice([1, 2]); n = len(x) // b
    if n < 4: return None
    order = [r.randrange(n) for _ in range(n)]
    out = np.concatenate([x[i * b:(i + 1) * b] * np.r_[np.ones(b - 96), np.linspace(1, 0, 96)] for i in order])
    return out

def stutter(x, r):
    b = beat(r); out = x.copy(); t = r.randrange(0, max(1, len(x) - 4 * b))
    for _ in range(r.randint(1, 3)):
        L = int(b / r.choice([4, 8, 16])); seg = x[t:t + L] * np.r_[np.ones(max(0, L - 48)), np.linspace(1, 0, min(48, L))]
        reps = np.tile(seg, max(1, int(b * r.choice([1, 2]) // L)))
        out[t:t + len(reps)] = reps[:len(out) - t]; t = min(len(x) - 1, t + len(reps) + r.randrange(b))
    return out

def beat_repeat(x, r):
    b = beat(r); t = r.randrange(0, max(1, len(x) // 3)); out = [x[:t]]
    for div in (2, 4, 8, 16, 32):
        L = b // div; seg = x[t:t + L] * np.r_[np.ones(max(0, L - 32)), np.linspace(1, 0, min(32, L))]
        out.append(np.tile(seg, div // 2 if div > 2 else 2))
    out.append(x[t:])
    return np.concatenate(out)[:int(MAX * RATE)]

def trance_gate(x, r):
    b = beat(r); step = b // r.choice([2, 4]); duty = r.uniform(.35, .6)
    pattern = [1 if r.random() < .75 else 0 for _ in range(16)]
    gate = np.zeros(len(x)); ramp = 64
    for i in range(0, len(x), step):
        if pattern[(i // step) % 16]:
            on = int(step * duty); g = np.r_[np.linspace(0, 1, ramp), np.ones(max(0, on - 2 * ramp)), np.linspace(1, 0, ramp)]
            gate[i:i + len(g)] = g[:len(x) - i]
    # a gate needs something sustained underneath: pad the source with a smeared copy of itself
    smear = sosfilt(butter(2, 1200, 'low', fs=RATE, output='sos'), np.convolve(x, np.ones(2400) / 2400, mode='same') * 8 + x)
    return smear * gate

def record_stop(x, r):
    t = int(len(x) * r.uniform(.3, .7)); L = int(RATE * r.uniform(.6, 2.0))
    curve = np.r_[np.ones(t), np.linspace(1, 0, L) ** r.uniform(.6, 1.6), np.zeros(int(RATE * r.uniform(.2, .8)))]
    return resample_curve(np.r_[x, np.zeros(len(curve))], curve)

def rewind(x, r):
    t = int(len(x) * r.uniform(.35, .7)); L = int(RATE * r.uniform(.6, 1.4))
    speed = -np.r_[np.linspace(.5, r.uniform(3, 6), L // 3), np.full(L - L // 3, r.uniform(3, 6))]
    pos = t + np.cumsum(speed); pos = np.clip(pos, 0, len(x) - 1)
    back = np.interp(pos, np.arange(len(x)), x)
    back = sosfilt(butter(2, 300, 'high', fs=RATE, output='sos'), back)
    tail = x[:int(RATE * r.uniform(0, 2.5))] if r.random() < .6 else np.zeros(int(RATE * .3))
    return np.r_[x[:t], back * np.linspace(1, .6, len(back)), tail]

def filter_sweep(x, r):
    hp = r.random() < .4; n = len(x); out = np.zeros(n); block = 512
    up = r.random() < .5
    f = np.geomspace(150, 9000, n // block + 1) if up else np.geomspace(9000, 150, n // block + 1)
    if hp: f = np.geomspace(40, 4000, n // block + 1) if up else np.geomspace(4000, 40, n // block + 1)
    zi = None
    for k, i in enumerate(range(0, n, block)):
        sos = butter(2, min(f[k], RATE / 2 - 100), 'high' if hp else 'low', fs=RATE, output='sos')
        # resonance: add a narrow band at the cutoff
        if zi is None: zi = sosfilt_zi(sos) * 0
        y, zi = sosfilt(sos, x[i:i + block], zi=zi)
        out[i:i + block] = y
    peak = sosfilt(butter(2, [max(30, f.min()), min(RATE / 2 - 200, f.max())], 'band', fs=RATE, output='sos'), out)
    return out + .3 * peak

def delay_throw(x, r):
    b = beat(r); d = int(b * r.choice([.5, .75, 1.0])); fb = r.uniform(.45, .7)
    cut = int(len(x) * r.uniform(.25, .5)); dry = x[:cut] * np.r_[np.ones(cut - 256), np.linspace(1, 0, 256)]
    out = np.zeros(cut + int(RATE * r.uniform(3, 5))); out[:cut] += dry
    tap, g = dry.copy(), 1.0
    lp = butter(1, 3500, 'low', fs=RATE, output='sos')
    for k in range(1, 30):
        g *= fb; tap = sosfilt(lp, tap)
        s = k * d
        if s >= len(out) or g < .02: break
        out[s:s + len(tap)] += g * tap[:len(out) - s]
    return out

def bitcrushed(x, r):
    bits = r.randint(3, 6); hold = r.randint(4, 16)
    y = np.repeat(x[::hold], hold)[:len(x)]
    q = 2 ** (bits - 1); peak = np.max(np.abs(y)) + 1e-9
    return np.round(y / peak * q) / q * peak

def flanged(x, r):
    n = np.arange(len(x)); rate = r.uniform(.1, .6); depth = r.uniform(.001, .005) * RATE; base = .0005 * RATE
    d = base + depth * (1 + np.sin(2 * np.pi * rate * n / RATE)) / 2
    delayed = np.interp(n - d, n, x, left=0)
    return x + r.uniform(.6, .9) * delayed

def reverse(x, r):
    return x[::-1].copy()

def noise_sweep(x, r, up=None, L=None):
    L = L or int(RATE * r.uniform(2, 6)); n = np.random.default_rng(r.randrange(1 << 30)).normal(size=L)
    up = r.random() < .5 if up is None else up
    f = np.geomspace(300, 10000, L // 512 + 1); f = f if up else f[::-1]
    out = np.zeros(L); zi = None
    for k, i in enumerate(range(0, L, 512)):
        sos = butter(2, [f[k] * .7, min(RATE / 2 - 100, f[k] * 1.3)], 'band', fs=RATE, output='sos')
        if zi is None: zi = sosfilt_zi(sos) * 0
        out[i:i + 512], zi = sosfilt(sos, n[i:i + 512], zi=zi)
    env = np.linspace(.1, 1, L) if up else np.linspace(1, .05, L)
    out *= env
    if r.random() < .5: out = np.r_[out, np.zeros(0)] + .25 * np.resize(x, L) / (rms(x) / rms(out))  # under a music bed
    return out

def pitched_sweep(x, r, up):
    L = int(RATE * r.uniform(2, 6)); t = np.arange(L) / RATE
    f0, f1 = (r.uniform(100, 300), r.uniform(1500, 5000)) if up else (r.uniform(1500, 5000), r.uniform(60, 200))
    f = f0 * (f1 / f0) ** (t / t[-1]); ph = 2 * np.pi * np.cumsum(f) / RATE
    tone = np.sign(np.sin(ph)) * .3 + np.sin(ph * 1.007) * .5
    noise = noise_sweep(x, r, up, L)
    out = tone * (np.linspace(.2, 1, L) if up else np.linspace(1, .05, L)) + .5 * noise / (rms(noise) + 1e-9) * rms(tone)
    return out

def sub_drop(x, r):
    L = int(RATE * r.uniform(1, 3)); t = np.arange(L) / RATE
    f = r.uniform(70, 110) * (r.uniform(25, 40) / 90) ** (t / t[-1]); ph = 2 * np.pi * np.cumsum(f) / RATE
    out = np.sin(ph) * np.exp(-t * r.uniform(.5, 2))
    return np.tanh(out * 2) + (.15 * x[:L] / rms(x[:L]) * rms(out) if r.random() < .5 and len(x) >= L else 0)

EFFECTS = {'chops': chops, 'stutter effect': stutter, 'beat repeat': beat_repeat, 'trance gate': trance_gate,
           'record stop': record_stop, 'rewind': rewind, 'filter sweep': filter_sweep, 'delay throw': delay_throw,
           'bitcrushed': bitcrushed, 'flanged': flanged, 'reverse effect': reverse, 'noise sweep': noise_sweep,
           'riser': lambda x, r: pitched_sweep(x, r, True), 'downlifter': lambda x, r: pitched_sweep(x, r, False), 'sub drop': sub_drop}

def write(path, y):
    y = np.clip(y, -1, 1); pcm = (y * 32767).astype('<i2')
    with wave.open(path, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm.tobytes())

clips = json.load(open(MANIFEST))['clips']
pool = sorted([c for c in clips if c['split'] == 'train' and c.get('kind') == 'plain-music'], key=lambda c: c['id'])
print(f'{len(pool)} training-split plain music sources')
out = []
for label, fx in EFFECTS.items():
    r = random.Random(f'dj-effects-render|{label}')
    made = 0
    for c in r.sample(pool, len(pool)):
        if made >= PER_EFFECT: break
        rid = f"render:{label.replace(' ', '-')}:{c['freesoundId']}"; path = os.path.join(OUT, rid.replace(':', '_') + '.wav')
        if not os.path.exists(path):
            try: x = decode(c['path'])
            except Exception: continue
            if len(x) < RATE * 1.5 or rms(x) < 1e-3: continue
            try: y = fx(x, r)
            except Exception as e: print(f'  {label} {c["id"]}: {e}'); continue
            if y is None or len(y) < RATE: continue
            y = y[:int(MAX * RATE)]
            y = y / rms(y) * min(rms(x), .2)
            if np.max(np.abs(y)) > 1: y /= np.max(np.abs(y)) * 1.01
            write(path, y)
        out.append({'id': rid, 'path': path, 'labels': [label], 'group': c['group'], 'split': 'train', 'kind': 'render', 'source': c['id']})
        made += 1
    print(f'{label:<16}{made:>5} renders')
json.dump({'kind': 'dj-effects-renders-v1', 'clips': out}, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=0)
print(f'{len(out)} renders')
