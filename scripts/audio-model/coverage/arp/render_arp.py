"""Synth arpeggio training clips, version 2 (Oct 31 2026, thread "Make fake arp training audio").

  python3 render_arp.py <out-dir> [--pos 1200] [--neg 1200] [--workers 4] [--seed 2310]

Round 22's 150 arp renders (datasets-v1/dsp-cowbell-arp) used 3 timbres x 4 arp orders, solo, no look-alikes: one clip
short. This set aims at variety and at the sounds people confuse with an arp:

Positives (tags: synth arpeggio, synthesizer, plus drums when a drum loop plays under it):
  12 oscillator families (saw, square, pulse, triangle, sine, supersaw stack, 2-op FM, Karplus-Strong pluck, additive
  bell, wavefold, hard-sync, organ drawbar), resonant low/band/high-pass filter with its own envelope and an optional
  cutoff sweep across the clip, 9 arp orders (up, down, up-down, down-up, random, converge, pinky, as-played, thumb),
  1 to 3 octaves, rates 1/8 to 1/32 including triplets, 80 to 175 BPM, swing, accents, rests, ratchets, 1 to 4 chord
  progressions, gate length; delay, reverb, chorus, drive, bitcrush, sidechain pump, lo-fi band limit; played solo or
  with a pad, a bass line, a drum loop or all three.
Look-alike negatives (synth arpeggio is a SURE absence, written to absent.json): mono bass lines (root / octave / fifth
  riffs, no chord-tone cycling), repeated chord stabs, rolled (strummed) chords, held pads, legato lead melodies,
  sparse single plucks, drum loops alone. Each keeps its own true tags so prepare-run9.py keeps the row.

Everything is code-generated (no source audio, no test clips). 48 kHz mono 16-bit FLAC, 3 to 10 s, the
datasets-v1 manifest layout of dsp-cowbell-arp (ids dsparp:NNNN, route=generated, split=train,
group dsp-arp-v2:<kind>:<recipe>:<i % 20>:t<k>, with k picked so the group is never a validation group), so r13-set.py
stages it unchanged and the tagger's cutoff is still fit on real clips only.
"""
import argparse, csv, hashlib, io, json, math, os, random, tarfile
from multiprocessing import Pool
import numpy as np
import soundfile as sf
from scipy.signal import lfilter, fftconvolve, butter, sosfilt

SR = 48000
NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
SCALES = {'minor': [0, 2, 3, 5, 7, 8, 10], 'major': [0, 2, 4, 5, 7, 9, 11], 'dorian': [0, 2, 3, 5, 7, 9, 10],
          'phryg': [0, 1, 3, 5, 7, 8, 10], 'harm': [0, 2, 3, 5, 7, 8, 11]}
CHORDS = [[0, 3, 7], [0, 4, 7], [0, 3, 7, 10], [0, 4, 7, 11], [0, 5, 7], [0, 3, 7, 14], [0, 4, 7, 14], [0, 7, 12],
          [0, 3, 10, 15], [0, 4, 7, 9], [0, 2, 7], [0, 3, 6]]
PROGS = [[0], [0, 5], [0, 8, 3, 10], [0, 5, 8, 7], [0, 10, 8, 7], [0, 3, 8, 10], [0, 7], [0, 5, 3, 10], [0, 9, 5, 7], [0, 0, 8, 10]]
OSCS = ['saw', 'square', 'pulse', 'tri', 'sine', 'supersaw', 'fm', 'pluck', 'bell', 'fold', 'sync', 'organ']
ORDERS = ['up', 'down', 'updown', 'downup', 'random', 'converge', 'pinky', 'played', 'thumb']
RATES = [(0.5, '1/8'), (1 / 3, '1/8T'), (0.25, '1/16'), (0.25, '1/16'), (0.25, '1/16'), (1 / 6, '1/16T'), (0.125, '1/32')]
NEG_KINDS = ['bassline', 'stabs', 'rolled', 'pad', 'lead', 'plucks', 'drums']


def h(*p): return int(hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()[:12], 16)


def train_group(base):
    """A group name prepare-run9.py never puts in validation (it holds out groups with h('dge-run9-val', group) % 5 == 0;
    train.py's is_val is not used for run 9 items). Fake clips then never move the tagger's cutoff, which calibrate.py fits on
    validation clips: the cutoff stays a real-clip choice."""
    k = 0
    while int(hashlib.sha256(f'dge-run9-val|{base}:t{k}'.encode()).hexdigest()[:8], 16) % 5 == 0: k += 1
    return f'{base}:t{k}'
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)


# ---------------- oscillators: (frequency, n samples, rng, patch) -> signal ----------------
def phase(f, n, ph0=0.0):
    return (ph0 + f * np.arange(n) / SR) % 1.0


def blsaw(f, n, ph0=0.0):   # additive band-limited saw (cheap enough for short notes)
    t = np.arange(n) / SR; k = max(1, min(60, int(0.45 * SR / max(f, 1))))
    out = np.zeros(n)
    for j in range(1, k + 1): out += np.sin(2 * np.pi * j * (f * t + ph0)) / j
    return out * 0.55


def osc(kind, f, n, r, p):
    t = np.arange(n) / SR
    if kind == 'saw': return blsaw(f, n, r.random())
    if kind == 'square': return np.sign(np.sin(2 * np.pi * f * t + r.random() * 6.28)) * 0.5
    if kind == 'pulse':
        ph = phase(f, n, r.random()); w = p['pw'] + 0.15 * np.sin(2 * np.pi * p['pwm'] * t)
        return np.where(ph < w, 0.5, -0.5)
    if kind == 'tri': return (2 * np.abs(2 * phase(f, n, r.random()) - 1) - 1) * 0.7
    if kind == 'sine': return np.sin(2 * np.pi * f * t) * 0.8 + 0.15 * np.sin(4 * np.pi * f * t)
    if kind == 'supersaw':
        out = np.zeros(n); v = p['voices']
        for i in range(v):
            d = (i - (v - 1) / 2) / max(1, (v - 1) / 2) * p['detune']
            out += blsaw(f * 2 ** (d / 12), n, r.random())
        return out / math.sqrt(v)
    if kind == 'fm':
        env = np.exp(-t / p['fm_decay']); mod = np.sin(2 * np.pi * f * p['ratio'] * t) * p['index'] * (0.25 + env)
        return np.sin(2 * np.pi * f * t + mod) * 0.7
    if kind == 'pluck':   # Karplus-Strong
        L = max(2, int(SR / f)); x0 = np.zeros(n); x0[:min(L, n)] = np.random.default_rng(r.randrange(1 << 30)).uniform(-1, 1, min(L, n)); a = np.zeros(L + 2); a[0] = 1
        a[L] = a[L + 1] = -p['damp'] * 0.5; out = lfilter([1.0], a, x0)
        return out * 0.7
    if kind == 'bell':
        out = np.zeros(n)
        for ratio, amp, dec in ((1, 1, 1.2), (2.76, 0.5, 0.5), (5.4, 0.3, 0.25), (8.93, 0.15, 0.12)):
            out += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / dec)
        return out * 0.45
    if kind == 'fold':
        x = np.sin(2 * np.pi * f * t) * p['fold']
        return np.sin(x) * 0.7
    if kind == 'sync':
        ph = phase(f, n); return (2 * ((ph * p['sync']) % 1.0) - 1) * 0.5
    if kind == 'organ':
        out = np.zeros(n)
        for ratio, amp in zip((0.5, 1, 2, 3, 4), p['bars']): out += amp * np.sin(2 * np.pi * f * ratio * t)
        return out * 0.35
    raise ValueError(kind)


def biquad(kind, fc, q):
    fc = min(max(fc, 30.0), SR * 0.45); w = 2 * np.pi * fc / SR; a = np.sin(w) / (2 * q); c = np.cos(w)
    if kind == 'lp': b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
    elif kind == 'hp': b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    else: b = [a, 0, -a]
    A = [1 + a, -2 * c, 1 - a]
    return np.array(b) / A[0], np.array(A) / A[0]


def tv_filter(x, kind, cut, q, block=240):   # time-varying biquad, cutoff per block (5 ms)
    out = np.empty_like(x); zi = np.zeros(2)
    for s in range(0, len(x), block):
        b, a = biquad(kind, float(cut[min(s, len(cut) - 1)]), q)
        out[s:s + block], zi = lfilter(b, a, x[s:s + block], zi=zi)
    return out


def adsr(n, a, d, s, rel, gate_n):
    env = np.zeros(n); A = max(1, int(a * SR)); D = max(1, int(d * SR)); R = max(1, int(rel * SR)); g = min(gate_n, n)
    seg = np.concatenate([np.linspace(0, 1, A, endpoint=False), 1 - (1 - s) * (1 - np.exp(-5 * np.arange(D) / D))])
    if len(seg) < g: seg = np.concatenate([seg, np.full(g - len(seg), seg[-1])])
    seg = seg[:g]; env[:g] = seg
    lvl = seg[-1] if g else 0
    tail = min(R, n - g)
    if tail > 0: env[g:g + tail] = lvl * np.exp(-5 * np.arange(tail) / R)
    return env


def patch(r, kind=None):
    p = {'osc': kind or r.choice(OSCS), 'pw': r.uniform(0.1, 0.4), 'pwm': r.uniform(0.1, 3), 'voices': r.choice([3, 5, 7]),
         'detune': r.uniform(0.08, 0.35), 'ratio': r.choice([0.5, 1, 2, 3, 3.5, 4, 7]), 'index': r.uniform(0.5, 6),
         'fm_decay': r.uniform(0.05, 0.6), 'damp': r.uniform(0.985, 0.999), 'fold': r.uniform(1.5, 5), 'sync': r.uniform(1.3, 4),
         'bars': [r.uniform(0, 1) for _ in range(5)],
         'a': r.choice([0.001, 0.003, 0.008, 0.02, 0.05]), 'd': r.uniform(0.05, 0.5), 's': r.choice([0, 0, 0.2, 0.5, 0.8]),
         'rel': r.uniform(0.02, 0.35), 'ftype': r.choices(['lp', 'bp', 'hp'], [0.8, 0.12, 0.08])[0],
         'cut': 2 ** r.uniform(np.log2(400), np.log2(9000)), 'q': r.choice([0.7, 1, 2, 4, 8]), 'fenv': r.uniform(0, 4),
         'fdec': r.uniform(0.03, 0.4), 'sweep': r.random() < 0.3, 'sweep_oct': r.uniform(-3, 3)}
    return p


def note(m, dur_n, gate_n, vel, r, p, clip_pos=0.0, clip_len=1.0):
    n = dur_n
    x = osc(p['osc'], hz(m), n, r, p)
    if p['osc'] not in ('pluck', 'bell'):
        x = x * adsr(n, p['a'], p['d'], p['s'], p['rel'], gate_n)
    else:
        x = x * adsr(n, 0.001, p['d'] * 2, p['s'] * 0.5, p['rel'], gate_n)
    base = p['cut'] * (2 ** (p['sweep_oct'] * clip_pos / max(clip_len, 1e-6)) if p['sweep'] else 1) * (0.6 + 0.6 * vel)
    t = np.arange(n) / SR
    cut = base * 2 ** (p['fenv'] * np.exp(-t / p['fdec']))
    return tv_filter(x, p['ftype'], cut, p['q']) * vel


# ---------------- effects ----------------
def delay(x, r, beat):
    d = int(beat * r.choice([0.75, 0.5, 1.0, 1.5]) * SR); fb = r.uniform(0.2, 0.6); mix = r.uniform(0.15, 0.45)
    out = x.copy(); g = mix
    for k in range(1, 8):
        if d * k >= len(x): break
        out[d * k:] += x[:-d * k] * g; g *= fb
    return out


def reverb(x, r):
    L = int(r.uniform(0.4, 3.0) * SR); t = np.arange(L) / SR
    ir = np.random.default_rng(r.randrange(1 << 30)).standard_normal(L) * np.exp(-6.9 * t / (L / SR))
    ir = sosfilt(butter(2, r.uniform(2500, 9000), 'low', fs=SR, output='sos'), ir); ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
    wet = fftconvolve(x, ir)[:len(x)]; mix = r.uniform(0.1, 0.45)
    return x * (1 - mix) + wet * mix


def chorus(x, r):
    n = len(x); t = np.arange(n); dly = (0.012 + 0.004 * np.sin(2 * np.pi * r.uniform(0.2, 1.5) * t / SR)) * SR
    idx = np.clip(t - dly, 0, n - 1); return 0.7 * x + 0.5 * np.interp(idx, t, x)


def fx(x, r, beat, allow_pump=True):
    if r.random() < 0.2: x = np.tanh(x * r.uniform(1.5, 6)) / 1.2
    if r.random() < 0.08:
        bits = r.choice([4, 6, 8]); step = r.choice([1, 2, 4, 6]); q = 2 ** (bits - 1)
        x = np.repeat(np.round(x[::step] * q) / q, step)[:len(x)]
    if r.random() < 0.2: x = chorus(x, r)
    if r.random() < 0.5: x = delay(x, r, beat)
    if r.random() < 0.6: x = reverb(x, r)
    if allow_pump and r.random() < 0.2:
        n = len(x); t = (np.arange(n) / SR) % beat; x = x * (1 - 0.8 * np.exp(-t / (beat * 0.25)))
    if r.random() < 0.1: x = sosfilt(butter(2, [r.uniform(200, 500), r.uniform(2500, 5000)], 'band', fs=SR, output='sos'), x)
    return x


# ---------------- material ----------------
def chord_seq(r, root, n_ch):
    sc = SCALES[r.choice(list(SCALES))]; prog = r.choice([p for p in PROGS if len(p) >= min(n_ch, 1)])
    out = []
    for i in range(n_ch):
        deg = prog[i % len(prog)]; base = root + deg
        out.append([base + iv for iv in r.choice(CHORDS)])
    return out, sc


def arp_order(r, notes, order, octs):
    pool = sorted(set(n + 12 * o for o in range(octs) for n in notes))
    if order == 'up': return pool
    if order == 'down': return pool[::-1]
    if order == 'updown': return pool + pool[-2:0:-1]
    if order == 'downup': return pool[::-1] + pool[1:-1]
    if order == 'random': return [r.choice(pool) for _ in range(len(pool) * 2)]
    if order == 'converge':
        out, lo, hi = [], 0, len(pool) - 1
        while lo <= hi:
            out.append(pool[lo]);
            if hi != lo: out.append(pool[hi])
            lo += 1; hi -= 1
        return out
    if order == 'pinky': top = pool[-1]; return [x for n in pool[:-1] for x in (n, top)]
    if order == 'thumb': low = pool[0]; return [x for n in pool[1:] for x in (low, n)]
    return [n + 12 * o for o in range(octs) for n in notes]   # as played


def render_events(events, total_n, r, p, clip_len):
    out = np.zeros(total_n + SR)
    for (t0, dur, gate, m, vel) in events:
        s = int(t0 * SR)
        if s >= total_n: break
        tail = int((dur + p['rel'] + (1.2 if p['osc'] in ('pluck', 'bell') else 0.1)) * SR)
        y = note(m, tail, int(gate * SR), vel, r, p, t0, clip_len)
        out[s:s + len(y)] += y[:len(out) - s]
    return out[:total_n]


def drums(total_n, beat, r):
    out = np.zeros(total_n + SR); steps = int(total_n / SR / (beat / 4)) + 1; style = r.choice(['four', 'break', 'trap', 'half'])
    def kick():
        t = np.arange(int(0.35 * SR)) / SR; f = 45 + 120 * np.exp(-t / 0.03)
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / r.uniform(0.12, 0.3))
    def hat(open_=False):
        n = int((0.25 if open_ else 0.05) * SR); x = np.random.default_rng(r.randrange(1 << 30)).standard_normal(n)
        x = sosfilt(butter(2, 7000, 'high', fs=SR, output='sos'), x); return x * np.exp(-np.arange(n) / SR / (0.08 if open_ else 0.015)) * 0.3
    def snare():
        n = int(0.2 * SR); t = np.arange(n) / SR; x = np.random.default_rng(r.randrange(1 << 30)).standard_normal(n)
        x = sosfilt(butter(2, [1200, 8000], 'band', fs=SR, output='sos'), x)
        return (x * 0.5 + 0.4 * np.sin(2 * np.pi * 190 * t)) * np.exp(-t / 0.06)
    K, H, O, S = kick(), hat(), hat(True), snare()
    for i in range(steps):
        s = int(i * beat / 4 * SR); pos = i % 16; hits = []
        if style == 'four': hits += [K] if pos % 4 == 0 else []; hits += [O] if pos % 4 == 2 else [H] if r.random() < 0.5 else []; hits += [S] if pos in (4, 12) else []
        elif style == 'break': hits += [K] if pos in (0, 10) else []; hits += [S] if pos in (4, 12) else []; hits += [H] if pos % 2 == 0 else []
        elif style == 'trap': hits += [K] if pos in (0, 7, 11) else []; hits += [S] if pos == 8 else []; hits += [H] if r.random() < 0.85 else []
        else: hits += [K] if pos == 0 else []; hits += [S] if pos == 8 else []; hits += [H] if pos % 4 == 0 else []
        for x in hits: out[s:s + len(x)] += x[:len(out) - s] * r.uniform(0.6, 1.0)
    return out[:total_n]


def pad_layer(chords, bar, total_n, r):
    p = patch(r, r.choice(['supersaw', 'saw', 'organ', 'tri'])); p.update(a=0.3, d=0.5, s=0.8, rel=0.6, cut=r.uniform(600, 2500), fenv=0, sweep=False, q=0.7, ftype='lp')
    ev = [(i * bar, bar, bar * 0.98, m, 0.35) for i, ch in enumerate(chords * 8) for m in ch if i * bar * SR < total_n]
    return render_events(ev, total_n, r, p, total_n / SR)


def bass_layer(chords, beat, bar, total_n, r, sixteenth=False):
    p = patch(r, r.choice(['saw', 'square', 'sine', 'fm', 'pulse'])); p.update(cut=r.uniform(200, 1200), sweep=False, ftype='lp', rel=0.05)
    step = beat / 4 if sixteenth else beat / 2; ev = []; i = 0; t = 0.0
    pat = r.choice([[0, 0, 12, 0], [0, 0, 0, 7], [0, 12, 0, 12], [0, 0, 0, 0], [0, -12, 0, 0], [0, 0, 7, 12]])
    while t * SR < total_n:
        ch = chords[int(t / bar) % len(chords)]; root = ch[0] - 24
        while root > 50: root -= 12
        while root < 28: root += 12
        if r.random() > 0.08: ev.append((t, step, step * r.uniform(0.4, 0.95), root + pat[i % len(pat)], r.uniform(0.6, 1.0)))
        t += step; i += 1
    return render_events(ev, total_n, r, p, total_n / SR)


def norm(x, r):
    x = x - np.mean(x); pk = np.max(np.abs(x)) + 1e-9; return x / pk * 10 ** (r.uniform(-14, -1) / 20)


def positive(i, seed):
    r = random.Random(h(seed, 'pos', i))
    bpm = r.uniform(80, 175); beat = 60 / bpm; bar = 4 * beat; L = r.uniform(3, 10); N = int(L * SR)
    root = r.randint(45, 64); octs = r.choice([1, 1, 2, 2, 2, 3]); rate, rate_name = r.choice(RATES)
    if rate == 0.125 and bpm > 140: rate, rate_name = 0.25, '1/16'
    step = beat * {'1/8': 0.5, '1/8T': 1 / 3, '1/16': 0.25, '1/16T': 1 / 6, '1/32': 0.125}[rate_name]
    chords_per = r.choice([0.5, 1, 1, 2]); n_ch = r.choice([1, 2, 4, 4])
    chords, _ = chord_seq(r, root, n_ch); order = r.choice(ORDERS); p = patch(r)
    swing = r.choice([0, 0, 0, 0.1, 0.2]); gate = r.uniform(0.25, 1.0); rest_p = r.choice([0, 0, 0.05, 0.15])
    accent = r.choice([[1, 0.7, 0.8, 0.7], [1, 0.6, 0.6, 0.6, 0.9, 0.6], [1], [1, 0.8]]); ratchet = r.random() < 0.1
    ev = []; t = 0.0; k = 0
    while t < L:
        ch = chords[int(t / (bar * chords_per)) % len(chords)]
        seq = arp_order(r, ch, order, octs) if order != 'random' else [r.choice(sorted(set(n + 12 * o for o in range(octs) for n in ch)))]
        m = seq[k % len(seq)] if order != 'random' else seq[0]
        sw = swing * step if k % 2 else 0
        if r.random() >= rest_p:
            v = accent[k % len(accent)] * r.uniform(0.85, 1.0)
            if ratchet and r.random() < 0.08:
                for j in range(2): ev.append((t + sw + j * step / 2, step / 2, step / 2 * gate, m, v))
            else: ev.append((t + sw, step, step * gate, m, v))
        t += step; k += 1
    x = render_events(ev, N, r, p, L)
    ctx = r.choices(['solo', 'pad', 'bass', 'drums', 'full'], [0.45, 0.15, 0.12, 0.15, 0.13])[0]
    x = fx(x / (np.max(np.abs(x)) + 1e-9), r, beat)
    tags = ['synth arpeggio', 'synthesizer']
    if ctx in ('pad', 'full'): x = x + pad_layer(chords, bar * chords_per, N, r) * r.uniform(0.15, 0.4) / (1 + 0)
    if ctx in ('bass', 'full'): b = bass_layer(chords, beat, bar * chords_per, N, r); x = x + b / (np.max(np.abs(b)) + 1e-9) * r.uniform(0.3, 0.6)
    if ctx in ('drums', 'full'): d = drums(N, beat, r); x = x + d / (np.max(np.abs(d)) + 1e-9) * r.uniform(0.3, 0.7); tags.append('drums')
    desc = f'{p["osc"]} {order} x{octs}oct {rate_name} {bpm:.0f}bpm {ctx}'
    return norm(x, r), tags, f'pos:{p["osc"]}:{ctx}', desc


def negative(i, seed):
    r = random.Random(h(seed, 'neg', i)); kind = NEG_KINDS[i % len(NEG_KINDS)]
    bpm = r.uniform(80, 175); beat = 60 / bpm; bar = 4 * beat; L = r.uniform(3, 10); N = int(L * SR)
    root = r.randint(45, 64); chords, sc = chord_seq(r, root, r.choice([1, 2, 4])); per = r.choice([1, 2])
    if kind == 'bassline':
        x = bass_layer(chords, beat, bar * per, N, r, sixteenth=r.random() < 0.5); tags = ['synth bass', 'synthesizer']
    elif kind == 'stabs':
        p = patch(r); p.update(s=0, d=r.uniform(0.05, 0.25)); ev = []; t = 0.0; pat = r.choice([[1, 0, 0, 1, 0, 0, 1, 0], [1, 0, 1, 0], [0, 0, 1, 0], [1, 0, 0, 0, 0, 0, 1, 0]])
        k = 0
        while t < L:
            if pat[k % len(pat)]:
                for m in chords[int(t / (bar * per)) % len(chords)]: ev.append((t, beat / 2, beat / 4, m, 0.8))
            t += beat / 2; k += 1
        x = render_events(ev, N, r, p, L); tags = ['synth chord', 'synthesizer']
    elif kind == 'rolled':
        p = patch(r); p.update(s=r.uniform(0.4, 0.9)); ev = []
        for c, ch in enumerate(chords * 4):
            t0 = c * bar * per
            if t0 >= L: break
            for j, m in enumerate(ch + [ch[0] + 12]): ev.append((t0 + j * r.uniform(0.015, 0.06), bar * per, bar * per * 0.9, m, 0.7))
        x = render_events(ev, N, r, p, L); tags = ['synth chord', 'synthesizer']
    elif kind == 'pad':
        x = pad_layer(chords, bar * per, N, r); tags = ['atmospheric pad', 'synthesizer']
    elif kind == 'lead':
        p = patch(r, r.choice(['saw', 'square', 'supersaw', 'pulse', 'sine', 'fm', 'sync'])); p.update(s=0.8, a=0.01, rel=0.15)
        ev = []; t = 0.0; deg = 0; base = root + 12
        while t < L:
            d = beat * r.choice([0.5, 1, 1, 1.5, 2, 3]); deg = max(-3, min(9, deg + r.choice([-2, -1, -1, 0, 1, 1, 2])))
            m = base + sc[deg % 7] + 12 * (deg // 7); ev.append((t, d, d * 0.97, m, r.uniform(0.6, 1))); t += d
        x = render_events(ev, N, r, p, L)
        if r.random() < 0.5: x = x * (1 + 0.15 * np.sin(2 * np.pi * 5.5 * np.arange(N) / SR))
        tags = ['synth lead', 'synthesizer']
    elif kind == 'plucks':
        p = patch(r, r.choice(['pluck', 'bell', 'fm', 'saw', 'square'])); p.update(s=0)
        ev = [(r.uniform(0, max(0.1, L - 1.5)), 1.5, 0.2, r.choice(chords[0]) + 12 * r.randint(0, 1), 0.9) for _ in range(r.randint(1, 3))]
        x = render_events(sorted(ev), N, r, p, L); tags = ['synth pluck', 'synthesizer']
    else:
        x = drums(N, beat, r); tags = ['drums']
    x = fx(x / (np.max(np.abs(x)) + 1e-9), r, beat, allow_pump=kind != 'drums')
    return norm(x, r), tags, f'neg:{kind}', kind


def work(job):
    side, i, seed = job
    x, tags, recipe, desc = (positive if side == 'pos' else negative)(i, seed)
    buf = io.BytesIO(); sf.write(buf, np.clip(x, -1, 1).astype(np.float32), SR, format='FLAC', subtype='PCM_16')
    return side, i, buf.getvalue(), x, tags, recipe, desc


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--pos', type=int, default=1200); ap.add_argument('--neg', type=int, default=1200)
    ap.add_argument('--workers', type=int, default=4); ap.add_argument('--seed', default='2310')
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    jobs = [('pos', i, a.seed) for i in range(a.pos)] + [('neg', i, a.seed) for i in range(a.neg)]
    rows, absent, recipes, tagc = [], {}, {}, {}
    tar = tarfile.open(os.path.join(a.out, 'audio-000.tar'), 'w')
    with Pool(a.workers) as pool:
        for k, (side, i, data, x, tags, recipe, desc) in enumerate(pool.imap(work, jobs, chunksize=4)):
            n = len(rows); cid = f'dsparp:{n:04d}'; fn = f'dsparp_{n:04d}.flac'
            ti = tarfile.TarInfo(fn); ti.size = len(data); tar.addfile(ti, io.BytesIO(data))
            pcm = hashlib.sha256((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes()).hexdigest()
            rows.append({'id': cid, 'url': '', 'creator': 'DGE arp thread (procedural DSP render)', 'licence': 'generated, no source audio',
                         'licence_class': 'open', 'encoded_sha256': hashlib.sha256(data).hexdigest(), 'pcm_sha256': pcm,
                         'seconds': f'{len(x) / SR:.3f}', 'split': 'train', 'group': train_group(f'dsp-arp-v2:{recipe}:{i % 20}'), 'tags': '|'.join(tags),
                         'label_evidence': f'procedural DSP render, {desc}; target sound by construction; not listened', 'route': 'generated',
                         'score': '', 'source': 'dsp-arp-v2', 'part': 'dsp-arp-v2', 'file': f'audio-000.tar/{fn}', 'keep': '1',
                         'drop_reason': '', 'freesound_id': '', 'uploader': '', 'needs': ''})
            if side == 'neg': absent[cid] = ['synth arpeggio']
            recipes[recipe] = recipes.get(recipe, 0) + 1
            for t in tags: tagc[t] = tagc.get(t, 0) + 1
            if k % 200 == 0: print(f'{k}/{len(jobs)}', flush=True)
    tar.close()
    with open(os.path.join(a.out, 'manifest.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    json.dump({'absent': absent}, open(os.path.join(a.out, 'absent.json'), 'w'))
    json.dump({'clips': len(rows), 'minutes': round(sum(float(r['seconds']) for r in rows) / 60, 1), 'tags': tagc, 'recipes': recipes,
               'note': 'procedural DSP render, no source audio; train only; negatives are sure synth arpeggio absences (absent.json)'},
              open(os.path.join(a.out, 'summary.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
