"""Synthesises DJ effects from scratch (and scratches/risers from music), as extra TRAINING examples for the DJ-effect heads.

render.py applies a fixed recipe per effect to plain music clips, ~220 per effect. This adds many more, much more varied
examples, and covers the effects render.py can't make from music: impacts, whooshes, lasers, sirens, air horns, reverse
cymbals and reverse impacts are built from noise and oscillators with randomised pitch, length, envelope, filtering,
distortion, echo and reverb, sometimes over a quiet music bed. Vinyl scratches and pitch-up risers are made by playing
training-split music clips with a randomised speed curve.
Synthetic clips have no uploader: each gets the group "synth:<label>:<k mod 25>", so cross-validation spreads them over
folds, and they never reach the held-out test (train.py keeps renders out of it and picks them per label only when they
help on the REAL training clips). Every clip is mono 48 kHz and at most 10 s. Deterministic (fixed seeds).
Usage: synth.py <audio-manifest.json> <out dir> [shard shards]   env: PER_EFFECT (600, split across shards)
Writes <out dir>/<id>.wav and <out dir>/manifest.json (clips: id, path, labels, group, split='train', kind='render')."""
import json, sys, os, subprocess, wave, random
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

MANIFEST, OUT = sys.argv[1:3]
SHARD, SHARDS = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (0, 1)
PER_EFFECT = int(os.environ.get('PER_EFFECT', 600)) // SHARDS
RATE, MAX = 48000, 10.0
os.makedirs(OUT, exist_ok=True)
rms = lambda x: float(np.sqrt(np.mean(x ** 2)) + 1e-9)
T = lambda L: np.arange(L) / RATE


def decode(path, seconds=MAX):
    raw = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-t', str(seconds), '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def filt(x, kind, f, order=2):
    f = np.clip(f, 20, RATE / 2 - 200)
    return sosfilt(butter(order, f, kind, fs=RATE, output='sos'), x)


def tv_band(x, centres, q, block=512):
    """Band-pass with a centre frequency that changes every block (q: bandwidth as a fraction of the centre)."""
    out = np.zeros(len(x)); zi = None
    for k, i in enumerate(range(0, len(x), block)):
        c = centres[min(k, len(centres) - 1)]
        sos = butter(2, [max(25, c * (1 - q)), min(RATE / 2 - 200, c * (1 + q))], 'band', fs=RATE, output='sos')
        if zi is None: zi = np.zeros((sos.shape[0], 2))
        out[i:i + block], zi = sosfilt(sos, x[i:i + block], zi=zi)
    return out


def osc(freq, r, shape=None):
    ph = 2 * np.pi * np.cumsum(freq) / RATE
    shape = shape or r.choice(['sine', 'saw', 'square', 'tri', 'fm'])
    if shape == 'sine': return np.sin(ph)
    if shape == 'square': return np.tanh(4 * np.sin(ph))
    if shape == 'tri': return 2 / np.pi * np.arcsin(np.sin(ph))
    if shape == 'fm': return np.sin(ph + r.uniform(1, 4) * np.sin(ph * r.choice([.5, 1, 2, 3])))
    return sum(np.sin(ph * k) / k for k in range(1, 9)) * .6  # band-limited-ish saw


def reverb(x, r, wet=None):
    secs = r.uniform(.4, 3.5); L = int(RATE * secs)
    ir = np.random.default_rng(r.randrange(1 << 30)).normal(size=L) * np.exp(-T(L) * 6.9 / secs)
    ir = filt(ir, 'low', r.uniform(2500, 12000))
    y = fftconvolve(np.r_[x, np.zeros(L)], ir)[:len(x) + L]
    y *= rms(x) / rms(y)
    w = r.uniform(.15, .6) if wet is None else wet
    return np.r_[x, np.zeros(L)] * (1 - w) + y * w


def echo(x, r):
    d = int(RATE * r.uniform(.08, .45)); fb = r.uniform(.3, .65); out = np.r_[x, np.zeros(d * 8)]; tap = x.copy(); g = 1
    for k in range(1, 9):
        g *= fb; tap = filt(tap, 'low', 5000)
        out[k * d:k * d + len(tap)] += g * tap
    return out


def colour(y, r):
    """Random finishing: tilt EQ, saturation, echo, reverb, a short silence before, maybe a quiet music bed."""
    if r.random() < .5: y = filt(y, 'high', r.uniform(20, 300))
    if r.random() < .4: y = filt(y, 'low', r.uniform(3000, 16000))
    if r.random() < .3: y = np.tanh(y / (np.max(np.abs(y)) + 1e-9) * r.uniform(1.5, 5))
    if r.random() < .3: y = echo(y, r)
    if r.random() < .6: y = reverb(y, r)
    return np.r_[np.zeros(int(RATE * r.uniform(0, .6))), y]


def impact(r, x=None):
    L = int(RATE * r.uniform(1.5, 5)); t = T(L)
    n = np.random.default_rng(r.randrange(1 << 30)).normal(size=L)
    body = filt(n, 'low', r.uniform(800, 6000)) * np.exp(-t * r.uniform(3, 15))
    f = r.uniform(45, 90) * (r.uniform(.3, .8)) ** (t / t[-1]); thump = np.sin(2 * np.pi * np.cumsum(f) / RATE) * np.exp(-t * r.uniform(1, 4))
    metal = sum(np.sin(2 * np.pi * r.uniform(150, 3000) * t + r.uniform(0, 6)) for _ in range(r.randint(0, 6))) * np.exp(-t * r.uniform(2, 8)) * .15
    y = body * r.uniform(.3, 1) + thump * r.uniform(.6, 1.5) + metal
    return reverb(y, r, r.uniform(.3, .7))


def reverse_impact(r, x=None):
    y = impact(r)[::-1]
    return np.r_[y, impact(r)[:int(RATE * r.uniform(0, 1))] * (r.random() < .5)]


def whoosh(r, x=None):
    L = int(RATE * r.uniform(.4, 2.5)); n = np.random.default_rng(r.randrange(1 << 30)).normal(size=L)
    peak = r.uniform(.3, .7); t = np.linspace(0, 1, L)
    env = np.exp(-((t - peak) / r.uniform(.12, .3)) ** 2)
    lo, hi = r.uniform(200, 900), r.uniform(1500, 7000)
    c = lo + (hi - lo) * np.exp(-((np.linspace(0, 1, L // 512 + 1) - peak) / .25) ** 2)
    y = tv_band(n, c, r.uniform(.3, .7)) * env
    if r.random() < .4: y += osc(c.repeat(512)[:L] * r.uniform(.2, .5), r, 'sine') * env * .2
    return y


def laser(r, x=None):
    out = []
    for _ in range(r.randint(1, 4)):
        L = int(RATE * r.uniform(.08, .7)); t = T(L)
        f0, f1 = r.uniform(1200, 6000), r.uniform(80, 600)
        if r.random() < .25: f0, f1 = f1, f0
        f = f0 * (f1 / f0) ** ((t / t[-1]) ** r.uniform(.3, 1.5))
        y = osc(f, r) * np.exp(-t * r.uniform(0, 8))
        out.append(np.r_[y, np.zeros(int(RATE * r.uniform(0, .3)))])
    return np.concatenate(out)


def siren(r, x=None):
    L = int(RATE * r.uniform(1.5, 6)); t = T(L); base = r.uniform(400, 1100); depth = r.uniform(.2, .8)
    kind = r.choice(['wail', 'yelp', 'dub', 'hilo'])
    rate = {'wail': r.uniform(.15, .5), 'yelp': r.uniform(3, 8), 'dub': r.uniform(2, 10), 'hilo': r.uniform(.6, 1.5)}[kind]
    lfo = np.sin(2 * np.pi * rate * t) if kind in ('wail', 'yelp') else (2 * ((rate * t) % 1) - 1 if kind == 'dub' else np.sign(np.sin(2 * np.pi * rate * t)))
    f = base * (1 + depth * lfo)
    if kind == 'dub' and r.random() < .5: f *= (1 + .5 * t / t[-1])
    y = osc(f, r)
    if kind == 'dub' and r.random() < .6: y = echo(y, r)
    return y


def air_horn(r, x=None):
    base = r.uniform(300, 520); ratios = r.choice([[1, 1.26, 1.5], [1, 1.5, 2], [1, 1.19, 1.5], [1, 1.005, .998]])
    out = []
    pattern = r.choice([[.15, .15, .7], [.12] * 6 + [.6], [.9], [.2, .2, .2, .8]])
    for d in pattern:
        L = int(RATE * d * r.uniform(.8, 1.2)); t = T(L)
        vib = 1 + .004 * np.sin(2 * np.pi * 6 * t)
        y = sum(osc(np.full(L, base * k) * vib, r, 'saw') for k in ratios)
        env = np.minimum(1, t / .015) * np.minimum(1, (t[-1] - t) / .03 + .02)
        out.append(np.r_[np.tanh(y * r.uniform(.6, 2)) * env, np.zeros(int(RATE * r.uniform(.03, .1)))])
    return np.concatenate(out)


def cymbal(r, L):
    t = T(L); n = np.random.default_rng(r.randrange(1 << 30)).normal(size=L)
    y = filt(n, 'high', r.uniform(3000, 7000)) + .3 * sum(np.sin(2 * np.pi * r.uniform(3000, 12000) * t + r.uniform(0, 6)) for _ in range(12))
    return y * np.exp(-t * r.uniform(1, 3.5))


def reverse_cymbal(r, x=None):
    L = int(RATE * r.uniform(1, 4.5)); y = reverb(cymbal(r, L), r, r.uniform(.1, .5))[::-1]
    if r.random() < .5: y = np.r_[y, impact(r)[:int(RATE * r.uniform(.2, 1))] * .5]
    return y


def riser_from_music(r, x):
    """A music loop pitched and sped up with a rising filter: a common way risers are made."""
    L = int(RATE * r.uniform(2, 6)); curve = np.geomspace(1, r.uniform(1.6, 4), L)
    y = np.interp(np.clip(np.cumsum(curve), 0, len(x) - 1), np.arange(len(x)), x)
    c = np.geomspace(r.uniform(200, 600), r.uniform(4000, 10000), L // 512 + 1)
    y = tv_band(y, c, .6) * np.linspace(.2, 1, L) + .3 * np.random.default_rng(r.randrange(1 << 30)).normal(size=L) * np.linspace(0, 1, L) * rms(y)
    return y


def vinyl_scratch(r, x):
    """Baby, chirp and transformer scratches: a short music snippet played forwards and backwards at speed."""
    s = int(len(x) * r.uniform(0, .6)); snip = x[s:s + int(RATE * r.uniform(.25, .7))]
    if len(snip) < RATE * .2: return None
    moves = []
    for _ in range(r.randint(4, 14)):
        L = int(RATE * r.uniform(.06, .25)); amp = r.uniform(.4, 1)
        moves.append(np.sin(np.linspace(0, np.pi, L)) * amp * r.choice([1, -1]) * r.uniform(2, 6))
    speed = np.concatenate(moves)
    pos = np.clip(np.cumsum(speed) + len(snip) * .5, 0, len(snip) - 1)
    y = np.interp(pos, np.arange(len(snip)), snip)
    if r.random() < .5:  # transformer: crossfader cuts
        gate = (np.sin(2 * np.pi * r.uniform(8, 20) * T(len(y))) > r.uniform(-.3, .3)).astype(float)
        y *= filt(gate, 'low', 400)
    y = filt(y, 'high', 150)
    if r.random() < .4 and len(x) > len(y): y = y + .3 * x[:len(y)] / rms(x[:len(y)]) * rms(y)  # over the beat
    return y


SYNTH = {'impact': impact, 'reverse impact': reverse_impact, 'whoosh': whoosh, 'laser': laser, 'siren': siren,
         'air horn': air_horn, 'reverse cymbal': reverse_cymbal}
FROM_MUSIC = {'riser': riser_from_music, 'vinyl scratch': vinyl_scratch}


def write(path, y):
    y = np.clip(y, -1, 1); pcm = (y * 32767).astype('<i2')
    with wave.open(path, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm.tobytes())


def finish(y, x, r):
    y = colour(y, r)[:int(MAX * RATE)]
    y = y / (np.max(np.abs(y)) + 1e-9) * r.uniform(.3, .95)
    if x is not None and r.random() < .3:  # a quiet music bed under it
        bed = np.resize(x, len(y)); y = y + bed / rms(bed) * rms(y) * r.uniform(.05, .3)
        y /= np.max(np.abs(y)) * 1.01
    return y


pool = sorted([c for c in json.load(open(MANIFEST))['clips'] if c['split'] == 'train' and c.get('kind') == 'plain-music'], key=lambda c: c['id'])
print(f'{len(pool)} training-split plain music sources; {PER_EFFECT} per effect in shard {SHARD}/{SHARDS}')
cache = {}
def music(r):
    for _ in range(20):
        c = r.choice(pool)
        if c['id'] not in cache:
            try: cache[c['id']] = decode(c['path'])
            except Exception: cache[c['id']] = None
        x = cache[c['id']]
        if x is not None and len(x) >= RATE * 1.5 and rms(x) > 1e-3: return x
    return None

out = []
for label, fx in {**SYNTH, **FROM_MUSIC}.items():
    r = random.Random(f'dj-effects-synth|{label}|{SHARD}')
    made = tries = 0
    while made < PER_EFFECT and tries < PER_EFFECT * 3:
        tries += 1
        rid = f"synth:{label.replace(' ', '-')}:{SHARD}-{made}"; path = os.path.join(OUT, rid.replace(':', '_') + '.wav')
        x = music(r) if pool else None
        if label in FROM_MUSIC and x is None: continue
        try: y = fx(r, x)
        except Exception as e: print(f'  {label}: {e}'); continue
        if y is None or len(y) < RATE * .15 or not np.isfinite(y).all(): continue
        write(path, finish(y, x, r))
        out.append({'id': rid, 'path': path, 'labels': [label], 'group': f'synth:{label}:{(SHARD * PER_EFFECT + made) % 25}',
                    'split': 'train', 'kind': 'render', 'source': 'synth'})
        made += 1
    print(f'{label:<16}{made:>5} clips')
json.dump({'kind': 'dj-effects-synth-v1', 'clips': out}, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=0)
print(f'{len(out)} synthetic clips')
