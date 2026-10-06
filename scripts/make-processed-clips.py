"""Make training clips for DJ tags that no dataset has, by editing or synthesizing audio.

The label is exact because the script made the sound: a reversed cymbal is a crash cymbal played
backwards, a record stop is a loop slowed to zero, a vocoder vocal is a vocal run through a vocoder.
Each clip keeps its source's group (Freesound uploader, sample-pack brand, Slakh track), so a
held-out split by group still never hears the source recording in training. Synthetic-only tags
(sub drop, noise, vinyl crackle) are grouped by seed bucket and need a real-library check before
shipping, since they were never recorded.

Sources skip every Freesound id and uploader in the frozen short-clip test set.
Usage: make-processed-clips.py [per_tag=400]
Writes <FP>/processed-audio/<tag>/<id>.wav and <FP>/extras/processed.json (id, labels, group, path)."""
import json, os, sys, csv, random, subprocess
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, sosfiltfilt
from multiprocessing import Pool

FP = os.path.expanduser('~/Documents/Media/dj-training-fingerprints')
FSD = os.path.expanduser('~/Documents/Media/audio-datasets/fsd50k/x')
OUT = f'{FP}/processed-audio'
SR, PER = 48000, int(sys.argv[1]) if len(sys.argv) > 1 else 400
res = json.load(open('docs/evaluations/short-clips-2026-10-04/reserved-test-families.json'))
BAD_IDS = {str(i) for i in res['freesoundIds']}; BAD_UP = {str(u).lower() for u in res['freesoundUploaders']}

def read(path, seconds=8):
    raw = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', path, '-t', str(seconds), '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32).copy()
    on = np.flatnonzero(np.abs(x) > 0.02 * (np.abs(x).max() + 1e-9))   # trim leading/trailing silence
    return x[on[0]:on[-1] + 1] if len(on) else x

def norm(x, rng): return (x / (np.abs(x).max() + 1e-9) * rng.uniform(0.5, 0.95)).astype(np.float32)
def band(lo, hi, order=2): return butter(order, [lo, hi], 'bandpass', fs=SR, output='sos')

def clips(name):   # clips with audio on disk from an existing extras manifest, minus the frozen test set
    for c in json.load(open(f'{FP}/extras/{name}.json'))['clips']:
        fid = c['id'].split(':')[-1]; up = c.get('group', '').split(':')[-1].lower()
        if c.get('path') and os.path.exists(c['path']) and fid not in BAD_IDS and up not in BAD_UP: yield c

def fsd_vocals():  # FSD50K dev clips of people singing or talking with no instruments
    info = json.load(open(f'{FSD}/FSD50K.metadata/dev_clips_info_FSD50K.json'))
    for r in csv.DictReader(open(f'{FSD}/FSD50K.ground_truth/dev.csv')):
        ls, up = set(r['labels'].split(',')), info.get(r['fname'], {}).get('uploader', '?')
        if ls & {'Singing', 'Male_singing', 'Female_singing', 'Speech', 'Chant', 'Choir', 'Male_speech_and_man_speaking',
                 'Female_speech_and_woman_speaking'} and 'Musical_instrument' not in ls and r['fname'] not in BAD_IDS and up.lower() not in BAD_UP:
            yield {'id': f"fsd50k:{r['fname']}", 'group': f'fsd50k:{up}', 'path': f"{FSD}/audio/FSD50K.dev_audio/{r['fname']}.wav", 'labels': []}

# ---- transforms: each takes (rng, sources) and returns (audio, extra labels, group, source id) ----
def reverse(rng, src):
    c = src[0]; x = read(c['path'])
    if len(x) > 4 * SR: x = x[:int(rng.uniform(1.5, 4) * SR)]   # a reverse swell, not a whole reversed phrase
    x = x * np.linspace(1, 0, len(x)) ** 0.3                       # fade out the tail so the hit lands at the end once reversed
    return x[::-1], [], c['group'], c['id']

def pitched(rng, src):
    c = src[0]; x = read(c['path'], 10)
    k = 2 ** (rng.choice([-1, 1]) * rng.uniform(5, 12) / 12)        # speed change = pitch and formants move together (sampler style)
    y = np.interp(np.arange(0, len(x) - 1, k), np.arange(len(x)), x)
    return y[:6 * SR], ['voice'], c['group'], c['id']

def vocoder(rng, src):
    c = src[0]; m = read(c['path'], 6)
    t = np.arange(len(m)) / SR; root = rng.uniform(90, 260)
    chords = [[0, 4, 7], [0, 3, 7], [0, 7, 12], [0, 3, 7, 10], [0, 4, 7, 11]]
    notes = root * 2 ** (np.array(chords[rng.integers(len(chords))]) / 12)
    car = sum(2 * ((f * t * (1 + rng.uniform(-.003, .003))) % 1) - 1 for f in notes) + 0.05 * rng.standard_normal(len(t))
    edges = np.geomspace(120, 7500, int(rng.integers(12, 24)) + 1); env_lp = butter(2, 40, 'lowpass', fs=SR, output='sos'); y = np.zeros_like(m)
    for lo, hi in zip(edges[:-1], edges[1:]):
        s = band(lo, hi); y += sosfilt(s, car) * np.maximum(sosfilt(env_lp, np.abs(sosfilt(s, m))), 0)
    return y, [], c['group'], c['id']

def record_stop(rng, src):
    a, b = src[0], src[1]; x = read(a['path'], 6); y = read(b['path'], 6); n = min(len(x), len(y))
    mix = x[:n] / (np.abs(x[:n]).max() + 1e-9) + 0.7 * y[:n] / (np.abs(y[:n]).max() + 1e-9)
    keep, stop = int(rng.uniform(1, 3) * SR), int(rng.uniform(0.4, 1.6) * SR)
    rate = np.concatenate([np.ones(keep), np.linspace(1, 0, stop) ** rng.uniform(0.6, 2)])
    pos = np.cumsum(rate); pos = pos[pos < n - 1]
    out = np.interp(pos, np.arange(n), mix)
    return np.concatenate([out, np.zeros(int(rng.uniform(0, 0.3) * SR))]), sorted(set(a['labels']) | set(b['labels'])), b['group'], f"{a['id']}+{b['id']}"

def sub_drop(rng, _):
    d = rng.uniform(0.6, 3); t = np.arange(int(d * SR)) / SR
    f = rng.uniform(70, 160) * (rng.uniform(25, 45) / 110) ** ((t / d) ** rng.uniform(0.5, 1.5))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * rng.uniform(0.3, 2.5)) * np.minimum(t / 0.005, 1)
    x = np.tanh(x * rng.uniform(1, 4))                                 # some packs saturate the drop for harmonics
    if rng.random() < 0.4: x[:int(0.03 * SR)] += 0.3 * rng.standard_normal(int(0.03 * SR)) * np.linspace(1, 0, int(0.03 * SR))
    return x, [], None, None

def noise(rng, _):
    d = rng.uniform(0.2, 4); n = int(d * SR); w = rng.standard_normal(n)
    kind = rng.choice(['white', 'pink', 'brown'])
    if kind != 'white': w = np.cumsum(w) if kind == 'brown' else sosfilt(butter(1, 1500, 'lowpass', fs=SR, output='sos'), w) + 0.3 * w
    t = np.arange(n) / SR; shape = rng.choice(['burst', 'swell', 'gate', 'flat'])
    env = {'burst': np.exp(-t * rng.uniform(2, 15)), 'swell': (t / d) ** 2, 'gate': (np.sin(2 * np.pi * rng.uniform(2, 12) * t) > 0).astype(float),
           'flat': np.ones(n)}[shape] * np.minimum(t / 0.003, 1)
    return w * env, [], None, None

def crackle(rng, src):
    d = rng.uniform(2, 6); n = int(d * SR)
    hiss = sosfilt(band(800, 9000), rng.standard_normal(n)) * rng.uniform(0.005, 0.03)
    pops = np.zeros(n); k = rng.poisson(rng.uniform(5, 60) * d); idx = rng.integers(0, n, k)
    pops[idx] = rng.pareto(2.5, k) * rng.choice([-1, 1], k)            # mostly small ticks, a few loud pops
    x = hiss + sosfilt(band(600, 8000, 1), pops) * 0.3
    if rng.random() < 0.5:                                             # half sit under quiet music, as in a sampled record
        c = src[0]; m = read(c['path'], 6); m = np.resize(m, n) / (np.abs(m).max() + 1e-9)
        return x / (np.abs(x).max() + 1e-9) + m * rng.uniform(0.3, 1), list(c['labels']), c['group'], c['id']
    return x, [], None, None

JOBS = {   # tag: (transform, source pools)
    'reversed vocal': (reverse, ['vocal']), 'pitched vocal': (pitched, ['vocal']), 'vocoder vocal': (vocoder, ['vocal']),
    'reverse cymbal': (reverse, ['cymbal']), 'reverse impact': (reverse, ['impact']), 'record stop': (record_stop, ['loop', 'slakh']),
    'sub drop': (sub_drop, []), 'noise': (noise, []), 'vinyl crackle': (crackle, ['slakh']),
}

def make(job):
    tag, i, srcs, seed = job
    rng = np.random.default_rng(seed); fn, _ = JOBS[tag]
    try: x, extra, group, sid = fn(rng, srcs)
    except Exception as e: return None
    if len(x) < 0.15 * SR or not np.isfinite(x).all(): return None
    slug = tag.replace(' ', '-'); cid = f'proc:{slug}:{i}'; path = f'{OUT}/{slug}/{i}.wav'
    wavfile.write(path, SR, norm(np.asarray(x, np.float64), rng))
    return {'id': cid, 'labels': [tag] + [l for l in extra if l != tag], 'group': group or f'synthetic:{slug}:{i % 10}',
            'path': path, 'source': sid, 'transform': fn.__name__}

if __name__ == '__main__':
    R = random.Random(7)
    pools = {'vocal': list(fsd_vocals()),
             'cymbal': [c for n in ('hiphop', 'fsd50k', 'percussion') for c in clips(n) if {'crash cymbal', 'ride cymbal'} & set(c['labels'])],
             'impact': [c for c in clips('epidemic') if 'impact' in c['labels']],
             'loop': [c for c in clips('waivops') if {'drum loop', 'top loop'} & set(c['labels'])],
             'slakh': list(clips('slakh'))}
    print({k: len(v) for k, v in pools.items()})
    jobs = []
    for tag, (fn, need) in JOBS.items():
        os.makedirs(f"{OUT}/{tag.replace(' ', '-')}", exist_ok=True)
        if need: R.shuffle(pools[need[0]])
        for i in range(PER):
            srcs = [pools[need[0]][i % len(pools[need[0]])]] + [R.choice(pools[p]) for p in need[1:]] if need else []
            jobs.append((tag, i, srcs, R.randrange(2**31)))
    with Pool(os.cpu_count()) as p: rows = [r for r in p.imap_unordered(make, jobs, chunksize=4) if r]
    rows.sort(key=lambda r: r['id'])
    json.dump({'kind': 'processed-v1', 'clips': rows}, open(f'{FP}/extras/processed.json', 'w'), indent=0)
    from collections import Counter
    print(f'{len(rows)} clips', Counter(r['labels'][0] for r in rows))
