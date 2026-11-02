"""Loop-mix renders: drum and percussion loops built from training one-shots (Nov 2 2026, thread "Try fake loops,
effects and bass-note training"; the DOSE / SampleMatch recipe).

  python3 render_loops.py <one-shots.csv> <out-dir> [--n 2400] [--target cowbell] [--p-target 0.5] [--workers 4] [--seed 1102]

<one-shots.csv> has columns local (audio file), path (source path, for the log) and tags (';'-separated app tags). Use
TRAINING one-shots only, already passed through the private exclude list (filter_training.py) in the container.

Why: drum tags lose recall inside loops (Oct 11 finding), and the test sets grade loops. Each render places real
one-shots on a step grid, so its labels are exact: a tag is present only if one of its hits was placed.
  kit      kick + snare or clap + closed hi-hat, in one of five styles (four-on-the-floor, hip-hop, trap, breakbeat, latin)
  target   the --target one-shot (default cowbell) in half of the renders, 1 to 8 hits a bar, -12 to 0 dB under the kit;
           the other half lists the target as a SURE absence (absent.json), so the loops teach "not cowbell" too
  extras   shaker, conga, bongo, tom, rimshot, tambourine, clave, ride, crash, open hi-hat, each with p 0.2 (one-shots
           whose file name says cowbell or agogo are kept out of every non-target pool)
  bed      half the renders get a code-generated bass line and/or pad, and 1 in 5 of the target-free ones a bell-like
           pluck lead (a cowbell look-alike)
  effects  random EQ, reverb, compression and saturation on the mix (each p 0.4), the "effects augmentation" idea
Output: <out-dir>/audio/<id>.flac (16 kHz mono, the one-shots' own rate), manifest.csv (id, file, tags, absent, bpm,
style, seconds, sources) and absent.json ({'absent': {id: [tag]}}, train.py --absent-fix layout).
Everything is rendered in the container; no test clip is read.
"""
import argparse, csv, json, math, os, random, re
from multiprocessing import Pool
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve

SR = 16000
EXTRAS = ['shaker', 'conga', 'bongo', 'tom', 'rimshot', 'tambourine', 'clave', 'ride cymbal', 'crash cymbal', 'open hi-hat']
LOOKALIKE = re.compile(r'cow|agogo', re.I)
STYLES = ['four', 'hiphop', 'trap', 'break', 'latin']


def load_pools(path, target):
    pools = {}
    for r in csv.DictReader(open(path)):
        tags = set(t for t in r['tags'].split(';') if t)
        if tags & {'drum loop', 'hi-hat loop', 'percussion loop'}: continue           # one-shots only
        if target in tags: pools.setdefault(target, []).append(r['local']); continue
        if LOOKALIKE.search(r['path']): continue                                        # an unlabelled cowbell must not be a negative
        role = None
        if 'kick' in tags and not tags & {'snare', 'tom'}: role = 'kick'
        elif 'snare' in tags and 'kick' not in tags: role = 'snare'
        elif 'clap' in tags and 'snare' not in tags: role = 'clap'
        elif 'open hi-hat' in tags: role = 'open hi-hat'
        elif 'hi-hat' in tags: role = 'hi-hat'
        else:
            for e in EXTRAS:
                if e in tags: role = e; break
        if role: pools.setdefault(role, []).append(r['local'])
    return pools


_cache = {}
def hit(path):
    if path not in _cache:
        x, sr = sf.read(path, dtype='float32', always_2d=True); x = x.mean(1)
        if sr != SR: x = np.interp(np.arange(0, len(x), sr / SR), np.arange(len(x)), x).astype(np.float32)
        x = x[: int(1.5 * SR)]
        pk = np.abs(x).max()
        _cache[path] = x / pk if pk > 0 else x
    return _cache[path]


def pattern(style, role, rng, steps=16):
    p = np.zeros(steps)
    if role == 'kick':
        if style == 'four': p[[0, 4, 8, 12]] = 1
        elif style == 'hiphop': p[[0, 7, 10]] = 1; p[rng.integers(0, 16)] = 1
        elif style == 'trap': p[[0, 11]] = 1; p[rng.choice(16, 2)] = 1
        elif style == 'break': p[[0, 10]] = 1; p[rng.choice([6, 7, 13])] = 1
        else: p[[0, 6, 8, 14]] = 1
    elif role in ('snare', 'clap'):
        p[[8] if style == 'trap' else [4, 12]] = 1
        if style == 'break': p[rng.choice([7, 9, 15])] = rng.uniform(0.3, 0.6)
    elif role == 'hi-hat':
        k = {'four': [2, 6, 10, 14], 'trap': list(range(16))}.get(style, list(range(0, 16, 2)))
        p[k] = rng.uniform(0.4, 1.0, len(k))
        if style == 'trap' and rng.random() < 0.5: p[rng.choice(16, 3)] = 0
    else:   # target and extras: random sparse figure, 1 to 8 hits a bar
        k = rng.choice(steps, int(rng.integers(1, 9)), replace=False); p[k] = rng.uniform(0.5, 1.0, len(k))
    return p


def synth_bed(kind, n, bpm, rng):
    t = np.arange(n) / SR; out = np.zeros(n, np.float32); step = 60 / bpm / 4
    root = 2 ** ((rng.integers(-12, 0)) / 12) * 55.0
    if kind == 'bass':
        notes = rng.choice([0, 0, 0, 3, 5, 7, 10, 12], 16)
        for s in range(int(n / SR / step)):
            if rng.random() < 0.45: continue
            a, b = int(s * step * SR), min(n, int((s + rng.uniform(0.6, 1.8)) * step * SR))
            f = root * 2 ** (notes[s % 16] / 12); tt = t[a:b] - t[a]
            saw = 2 * ((f * tt) % 1) - 1 if rng.random() < 0.6 else np.sin(2 * np.pi * f * tt)
            out[a:b] += (saw * np.exp(-tt * rng.uniform(1, 8))).astype(np.float32)
        out = sosfilt(butter(2, rng.uniform(300, 1500), 'low', fs=SR, output='sos'), out).astype(np.float32)
    elif kind == 'pad':
        for iv in [[0, 3, 7], [0, 4, 7], [0, 3, 7, 10], [0, 5, 7]][int(rng.integers(4))]:
            f = root * 4 * 2 ** (iv / 12)
            out += sum(np.sin(2 * np.pi * f * (1 + d) * t) for d in (-0.004, 0, 0.004)).astype(np.float32) / 3
        out *= np.minimum(1, t / 0.5).astype(np.float32)
    else:   # bell-like pluck lead: a cowbell look-alike (2-op FM, short decay)
        for s in range(int(n / SR / step)):
            if rng.random() < 0.7: continue
            a = int(s * step * SR); b = min(n, a + int(0.4 * SR)); tt = t[a:b] - t[a]
            f = root * 8 * 2 ** (rng.choice([0, 3, 5, 7, 10, 12]) / 12)
            out[a:b] += (np.sin(2 * np.pi * f * tt + 2 * np.sin(2 * np.pi * f * 1.41 * tt)) * np.exp(-tt * 12)).astype(np.float32)
    pk = np.abs(out).max()
    return out / pk if pk > 0 else out


def effects(x, rng, log):
    if rng.random() < 0.4:   # EQ: a random peak or dip plus a gentle tilt
        f0 = rng.uniform(120, 6000); g = rng.uniform(-9, 9); band = sosfilt(butter(2, [f0 / 1.4, min(f0 * 1.4, SR / 2 - 100)], 'band', fs=SR, output='sos'), x)
        x = x + (10 ** (g / 20) - 1) * band; log.append(f'eq{f0:.0f}:{g:+.0f}')
    if rng.random() < 0.4:   # reverb: decaying noise impulse response
        rt = rng.uniform(0.2, 1.8); n = int(rt * SR); ir = rng.standard_normal(n) * np.exp(-6.9 * np.arange(n) / n)
        wet = fftconvolve(x, ir)[: len(x)]; wet /= max(1e-9, np.abs(wet).max()); w = rng.uniform(0.1, 0.5)
        x = (1 - w) * x / max(1e-9, np.abs(x).max()) + w * wet; log.append(f'rev{rt:.1f}')
    if rng.random() < 0.4:   # compression: a 10 ms RMS follower above a threshold
        env = np.sqrt(np.convolve(x ** 2, np.ones(160) / 160, 'same') + 1e-9); thr = np.quantile(env, rng.uniform(0.5, 0.8)); r = rng.uniform(2, 6)
        gain = np.where(env > thr, (thr / env) ** (1 - 1 / r), 1.0); x = x * gain; log.append(f'comp{r:.0f}')
    if rng.random() < 0.4:
        d = rng.uniform(1.5, 6); x = np.tanh(d * x / max(1e-9, np.abs(x).max())) ; log.append(f'sat{d:.1f}')
    return x


def render(job):
    i, seed, pools, target, p_target = job
    rng = np.random.default_rng(seed); log = []
    bpm = float(rng.uniform(80, 170)); style = STYLES[int(rng.integers(len(STYLES)))]
    step = 60 / bpm / 4; secs = float(rng.uniform(4, 8)); n = int(secs * SR); bars = math.ceil(secs / (16 * step))
    swing = rng.uniform(0, 0.25) if style in ('hiphop', 'break', 'latin') else 0.0
    mix = np.zeros(n + SR, np.float32); tags = {'drums', 'drum loop'}; srcs = []
    layers = [('kick', 0.0), ('clap' if rng.random() < 0.35 else 'snare', -2.0), ('hi-hat', -8.0)]
    has_target = rng.random() < p_target
    if has_target: layers.append((target, float(rng.uniform(-12, 0))))
    for e in EXTRAS:
        if e in pools and rng.random() < 0.2: layers.append((e, float(rng.uniform(-14, -4))))
    for role, db in layers:
        if role not in pools: continue
        path = pools[role][int(rng.integers(len(pools[role])))]; x = hit(path); srcs.append(os.path.basename(path))
        pat = pattern(style, role, rng); placed = False
        for b in range(bars):
            for s in range(16):
                if pat[s] <= 0: continue
                at = int(((b * 16 + s) * step + (swing * step if s % 2 else 0)) * SR)
                if at >= n: continue
                v = 10 ** (db / 20) * pat[s] * (10 ** (rng.uniform(-4, 0) / 20)); m = min(len(x), len(mix) - at)
                mix[at:at + m] += v * x[:m]; placed = True
        if placed:
            tags.add(role)
            if role in ('open hi-hat',): tags.add('hi-hat')
            if role in ('crash cymbal', 'ride cymbal'): tags.add('cymbal')
            if role in ('conga', 'bongo', 'shaker', 'tambourine', 'clave', 'cowbell'): tags.add('percussion')
    mix = mix[:n]; pk = np.abs(mix).max(); mix = mix / pk if pk > 0 else mix
    bed = []
    if rng.random() < 0.5:
        for kind, tag in (('bass', 'synth bass'), ('pad', 'synthesizer')):
            if rng.random() < 0.6: mix = mix + 10 ** (rng.uniform(-10, -3) / 20) * synth_bed(kind, n, bpm, rng); bed.append(kind); tags |= {tag, 'synthesizer'}
    if not has_target and rng.random() < 0.2:
        mix = mix + 10 ** (rng.uniform(-10, -4) / 20) * synth_bed('bell', n, bpm, rng); bed.append('bell'); tags.add('synthesizer')
    mix = effects(mix.astype(np.float64), rng, log)
    mix = (0.89 * mix / max(1e-9, np.abs(mix).max())).astype(np.float32)
    rid = f'loopmix:{i:05d}'
    return {'id': rid, 'mix': mix, 'tags': sorted(tags), 'absent': [] if target in tags else [target], 'bpm': round(bpm, 1),
            'style': style, 'seconds': round(secs, 2), 'bed': '+'.join(bed), 'fx': ' '.join(log), 'sources': '|'.join(srcs)}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('oneshots'); ap.add_argument('out')
    ap.add_argument('--n', type=int, default=2400); ap.add_argument('--target', default='cowbell'); ap.add_argument('--p-target', type=float, default=0.5)
    ap.add_argument('--workers', type=int, default=4); ap.add_argument('--seed', type=int, default=1102)
    a = ap.parse_args()
    pools = load_pools(a.oneshots, a.target)
    print({k: len(v) for k, v in sorted(pools.items())}, flush=True)
    assert a.target in pools and 'kick' in pools and 'hi-hat' in pools, 'need target, kick and hi-hat one-shots'
    os.makedirs(os.path.join(a.out, 'audio'), exist_ok=True)
    jobs = [(i, a.seed * 100003 + i, pools, a.target, a.p_target) for i in range(a.n)]
    rows, absent = [], {}
    with Pool(a.workers) as p:
        for r in p.imap(render, jobs, chunksize=8):
            f = os.path.join('audio', r['id'].replace(':', '-') + '.flac'); sf.write(os.path.join(a.out, f), r.pop('mix'), SR, subtype='PCM_16')
            if r['absent']: absent[r['id']] = r['absent']
            rows.append(dict(r, file=f, tags=';'.join(r['tags']), absent=';'.join(r['absent'])))
    with open(os.path.join(a.out, 'manifest.csv'), 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=['id', 'file', 'tags', 'absent', 'bpm', 'style', 'seconds', 'bed', 'fx', 'sources']); w.writeheader(); w.writerows(rows)
    json.dump({'absent': absent}, open(os.path.join(a.out, 'absent.json'), 'w'))
    print(f'{len(rows)} renders, {sum(1 for r in rows if a.target in r["tags"].split(";"))} with {a.target}', flush=True)


if __name__ == '__main__':
    main()
