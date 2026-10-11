"""Effect chains for the effect pairs v2 (glitch effect, chops, vocal chops, vocoder vocal, pulsing, wobbling, rising, falling), 16 kHz mono.

Same idea as effects.py (v1): real train audio in, the same audio with one effect out, randomised settings, loudness
matched. apply(tag, x, rng, carrier=None, bpm=None) returns (dry, wet, settings) at one shared length, or
(None, None, reason). `carrier` is a second real train clip (a synth chord or pad) that vocoder vocal may use as its
carrier instead of a code-made one.
"""
import numpy as np
import pedalboard as pb
from scipy.signal import stft, istft
from effects import RATE, MAX_N, rms, fit, fade, mix, run


def onsets(x, min_gap=.08):
    """Sample positions of note/hit starts (spectral flux peaks), always starting at 0."""
    hop = 256; _, _, Z = stft(x, RATE, nperseg=1024, noverlap=1024 - hop); m = np.log1p(np.abs(Z) * 50)
    flux = np.maximum(0, np.diff(m, axis=1)).sum(0); flux = np.r_[0, flux]
    if flux.max() <= 0: return [0]
    thr = np.median(flux) + .5 * np.std(flux); out, last = [0], -1e9
    for i in range(1, len(flux) - 1):
        if flux[i] > thr and flux[i] >= flux[i - 1] and flux[i] >= flux[i + 1] and (i * hop - last) > min_gap * RATE:
            out.append(i * hop); last = i * hop
    return sorted(set(out))


def bpm_or_guess(bpm, r):
    return bpm or r.uniform(85, 150)


def shift(seg, semis):
    """Resample pitch shift (changes length, like a sampler)."""
    if not semis: return seg
    ratio = 2 ** (semis / 12); pos = np.arange(0, len(seg) - 1, ratio)
    return np.interp(pos, np.arange(len(seg)), seg)


def glide_shift(x, semis_curve, win_s=.05):
    """Time-preserving pitch shift that can change over time: the classic two-tap delay-line shifter.
    semis_curve: one value per sample (semitones). Returns as many samples as x."""
    n = len(x); W = win_s * RATE; ratio = 2 ** (semis_curve / 12)
    ph = np.cumsum((1 - ratio) / W) % 1.0   # delay sweeps through the window at the rate the pitch change needs
    out = np.zeros(n); t = np.arange(n)
    for off in (0, .5):
        p = (ph + off) % 1.0; d = p * W; idx = t - d; i0 = np.floor(idx).astype(int); f = idx - i0
        ok = (i0 >= 0) & (i0 + 1 < n); i0c = np.clip(i0, 0, n - 2)
        v = np.where(ok, x[i0c] * (1 - f) + x[i0c + 1] * f, 0)
        out += v * np.sin(np.pi * p) ** 2   # the two taps' windows sum to one
    return out


# ---------------------------------------------------------------- glitch effect
def glitch(x, r, bpm=None):
    """Irregular digital micro-edits: grain repeats, dropouts, reversed grains, sample-and-hold crush, buffer scrambles,
    tape-skip pitch jumps. Not beat-synced and not one long repeat (that is stutter effect)."""
    n = len(x); y = x.copy(); events, covered = [], 0
    a = np.abs(x); act = np.flatnonzero(a > .05 * a.max())
    if len(act) < RATE * .3: return None, 'too little sound to glitch', n
    need = max(.4 * RATE, .2 * n); tries = 0
    while (covered < need or len(events) < 3) and tries < 40:
        tries += 1; kind = r.choice(['grain-repeat', 'grain-repeat', 'dropout', 'reverse-grain', 'crush', 'scramble', 'skip', 'click'])
        st = int(act[r.randrange(len(act))]); L = 0
        if kind == 'grain-repeat':
            g = int(r.uniform(.004, .06) * RATE); k = r.randint(3, 14); L = g * k
            if st + L >= n: continue
            y[st:st + L] = np.tile(x[st:st + g], k)
        elif kind == 'dropout':
            L = int(r.uniform(.01, .15) * RATE)
            if st + L >= n: continue
            y[st:st + L] = 0
        elif kind == 'reverse-grain':
            L = int(r.uniform(.02, .2) * RATE)
            if st + L >= n: continue
            y[st:st + L] = x[st:st + L][::-1]
        elif kind == 'crush':
            L = int(r.uniform(.05, .4) * RATE)
            if st + L >= n: continue
            hold = r.randint(4, 24); bits = r.randint(3, 6); seg = x[st:st + L]
            seg = np.repeat(seg[::hold], hold)[:L]; q = 2 ** (bits - 1); y[st:st + L] = np.round(seg * q) / q
        elif kind == 'scramble':
            g = int(r.uniform(.01, .04) * RATE); k = r.randint(4, 12); L = g * k
            if st + L >= n: continue
            idx = list(range(k)); r.shuffle(idx); y[st:st + L] = np.concatenate([x[st + i * g:st + (i + 1) * g] for i in idx])
        elif kind == 'skip':
            L = int(r.uniform(.05, .3) * RATE); ratio = r.choice([.5, .5, 2, 1.5, .75])
            if st + max(L, int(L * ratio) + 2) >= n: continue
            src = x[st:st + int(L * ratio) + 2]; y[st:st + L] = np.interp(np.arange(L) * ratio, np.arange(len(src)), src)
        else:   # clicks: a few single-sample spikes and DC steps, the sound of a broken buffer
            L = int(r.uniform(.02, .12) * RATE)
            if st + L >= n: continue
            for _ in range(r.randint(2, 6)):
                p = st + r.randrange(L); w = r.randint(1, 40); y[p:p + w] = r.choice([-1, 1]) * r.uniform(.3, .9) * a.max()
        events.append(dict(kind=kind, at_s=round(st / RATE, 3), len_ms=round(L / RATE * 1000))); covered += L
    if covered < need: return None, 'glitch too short', n
    return y, dict(events=events), n


# ---------------------------------------------------------------- chops
def chop_slices(x, r, step):
    """Cut x into slices at its hits (or on a grid when it has few), each at most one step long."""
    on = onsets(x)
    if len(on) < 4: on = list(range(0, len(x) - step, step))
    sl = []
    for i, s in enumerate(on):
        e = on[i + 1] if i + 1 < len(on) else len(x); e = min(e, s + step)
        if e - s >= .04 * RATE: sl.append((s, e))
    return sl


def place(x, slices, order, step, n, gaps=(), semis=None, decay=False):
    out = np.zeros(n); t = 0
    for j, k in enumerate(order):
        if t >= n: break
        if j in gaps: t += step; continue
        s, e = slices[k]; seg = x[s:e]
        if semis is not None: seg = shift(seg, semis[j])
        seg = seg[:step]
        if decay: seg = seg * np.linspace(1, .25, len(seg)) ** .7
        seg = seg * fade(len(seg), 3); m = min(len(seg), n - t); out[t:t + m] += seg[:m]; t += step
    return out


def chops(x, r, bpm=None):
    """Re-sequence the clip's own hits/slices on a tempo grid, with repeats: an MPC-style chop."""
    bpm = bpm_or_guess(bpm, r); div = r.choice([1, 2, 2, 4]); step = int(60 / bpm * RATE / div)
    sl = chop_slices(x, r, step)
    if len(sl) < 4: return None, 'too few slices', len(x)
    n = len(x); steps = n // step; order = []
    while len(order) < steps:   # short motifs that repeat, like a programmed chop pattern
        motif = [r.randrange(len(sl)) for _ in range(r.choice([2, 3, 4, 4, 8]))]; order += motif * r.randint(1, 2)
    order = order[:steps]
    if order == sorted(order) or len(set(order)) < 3: return None, 'chop kept the original order', n
    y = place(x, sl, order, step, n)
    return y, dict(bpm=round(bpm, 1), div=div, slices=len(sl), distinct=len(set(order))), n


def vocal_chops(x, r, bpm=None):
    """Chop a vocal into syllable slices, re-sequence them on a rhythm with gaps, often re-pitched: a vocal chop loop."""
    bpm = bpm_or_guess(bpm, r); div = r.choice([2, 2, 4]); step = int(60 / bpm * RATE / div)
    sl = chop_slices(x, r, step * 2)
    if len(sl) < 3: return None, 'too few vocal slices', len(x)
    n = len(x); steps = n // step; fill = r.uniform(.5, .85)
    pitched = r.random() < .5; scale = [0, 0, 3, 5, 7, 7, 12, -5]
    order = [r.randrange(len(sl)) for _ in range(min(steps, 16))]; order = (order * (steps // len(order) + 1))[:steps]
    gaps = {j for j in range(steps) if r.random() > fill}
    semis = [r.choice(scale) for _ in range(min(steps, 16))] if pitched else None
    if semis: semis = (semis * (steps // len(semis) + 1))[:steps]
    y = place(x, sl, order, step, n, gaps=gaps, semis=semis, decay=r.random() < .5)
    if rms(y) < 1e-4: return None, 'chop is silent', n
    return y, dict(bpm=round(bpm, 1), div=div, slices=len(sl), fill=round(fill, 2), pitched=pitched), n


# ---------------------------------------------------------------- vocoder vocal
def code_carrier(n, r):
    kind = r.choice(['saw-chord', 'saw-chord', 'pulse-mono', 'saw-noise'])
    root = 2 ** ((r.randrange(36, 58) - 69) / 12) * 440; t = np.arange(n) / RATE
    saw = lambda f: 2 * ((t * f) % 1) - 1
    if kind == 'saw-chord':
        chord = r.choice([[0, 4, 7], [0, 3, 7], [0, 7, 12], [0, 3, 7, 10], [0, 4, 7, 11]])
        c = sum(saw(root * 2 ** (s / 12) * (1 + r.uniform(-.004, .004))) for s in chord)
    elif kind == 'pulse-mono':
        c = np.sign(np.sin(2 * np.pi * root * t)) * 1.0
    else:
        c = saw(root) + .3 * np.random.default_rng(r.randrange(1 << 30)).standard_normal(n)
    return c, dict(carrier=kind, root_hz=round(root, 1))


def vocoder(x, r, carrier=None):
    n = len(x)
    if carrier is not None and len(carrier) >= n * .5 and rms(carrier) > 1e-3:
        c = np.resize(carrier, n); s = dict(carrier='real synth clip')
    else: c, s = code_carrier(n, r)
    bands = r.choice([12, 16, 24, 32]); nper = 512
    _, _, M = stft(x, RATE, nperseg=nper); _, _, C = stft(c, RATE, nperseg=nper)
    f = np.linspace(0, RATE / 2, M.shape[0]); edges = np.geomspace(80, 7000, bands + 1)
    k = int(r.uniform(2, 5)); kern = np.ones(k) / k; Y = np.zeros_like(C)
    for lo, hi in zip(edges[:-1], edges[1:]):
        b = (f >= lo) & (f < hi)
        if not b.any(): continue
        env = np.sqrt(np.mean(np.abs(M[b]) ** 2, axis=0)); env = np.convolve(env, kern, 'same')   # the voice's band level
        cen = np.sqrt(np.mean(np.abs(C[b]) ** 2, axis=0)) + 1e-9
        Y[b] = C[b] / cen * env   # the carrier, whitened per band, takes the voice's level
    _, y = istft(Y, RATE, nperseg=nper); y = fit(y, n)
    m = r.uniform(.85, 1.0); s.update(bands=bands, smooth_frames=k, mix=round(m, 2))
    return mix(x, y, m), s, n


# ---------------------------------------------------------------- pulsing / wobbling
def lfo_shape(t, rate, shape, r):
    p = (t * rate + r.uniform(0, 1)) % 1.0
    if shape == 'sine': return (1 + np.cos(2 * np.pi * p)) / 2
    if shape == 'square': return 1 / (1 + np.exp(-40 * (.5 - p)))   # soft-edged gate
    if shape == 'pump': return 1 - (1 - np.minimum(1, p / .6)) ** 2  # sidechain-style duck and swell
    return 1 - p   # saw down


def pulsing(x, r, bpm=None):
    n = len(x); t = np.arange(n) / RATE; shape = r.choice(['sine', 'square', 'square', 'pump', 'saw', 'gate-pattern'])
    if r.random() < .7: bpm = bpm_or_guess(bpm, r); rate = bpm / 60 * r.choice([1, 2, 2, 4, 4]); synced = True
    else: rate = r.uniform(2.5, 12); synced = False
    depth = r.uniform(.7, 1.0)
    if shape == 'gate-pattern':   # trance gate: 16 steps on or off
        pat = [1 if r.random() < .7 else 0 for _ in range(16)]
        if sum(pat) < 5 or sum(pat) == 16: pat = [1, 0] * 8
        step = (t * rate).astype(int) % 16; on = np.array(pat)[step].astype(float)
        frac = (t * rate) % 1; g = on * (1 / (1 + np.exp(-40 * (.6 - frac))))
    else: g = lfo_shape(t, rate, shape, r)
    env = 1 - depth * (1 - g); y = x * env
    return y, dict(shape=shape, rate_hz=round(rate, 2), synced=synced, depth=round(depth, 2)), n


def wobbling(x, r, bpm=None):
    n = len(x); kind = r.choice(['lfo-lowpass', 'lfo-lowpass', 'vibrato', 'wah'])
    rate = r.uniform(1.0, 7.0) if kind != 'vibrato' else r.uniform(3.0, 8.0); t = np.arange(n) / RATE; ph = r.uniform(0, 6.28)
    s = dict(kind=kind, rate_hz=round(rate, 2))
    if kind == 'vibrato':
        cents = r.uniform(40, 150); curve = cents / 100 * np.sin(2 * np.pi * rate * t + ph)
        y = glide_shift(x, curve, win_s=.03); s['depth_cents'] = round(cents)
    else:
        lo, hi = (r.uniform(200, 600), r.uniform(2000, 6000)) if kind == 'lfo-lowpass' else (r.uniform(400, 800), r.uniform(1500, 3000))
        mode = pb.LadderFilter.Mode.LPF24 if kind == 'lfo-lowpass' else pb.LadderFilter.Mode.BPF12
        res = r.uniform(.2, .7); lad = pb.LadderFilter(mode=mode, cutoff_hz=hi, resonance=res, drive=1.0); b = pb.Pedalboard([lad])
        y = np.zeros(n); B = 128
        for s0 in range(0, n, B):
            a = (1 + np.sin(2 * np.pi * rate * s0 / RATE + ph)) / 2; lad.cutoff_hz = float(lo * (hi / lo) ** a)
            y[s0:s0 + B] = run(b, x[s0:s0 + B], reset=(s0 == 0))
        if rms(y) < .04 * rms(x): return None, 'filtered to silence', n
        if kind == 'wah': y = mix(x, y, r.uniform(.7, .95))
        s.update(lo_hz=round(lo), hi_hz=round(hi), resonance=round(res, 2))
    return y, s, n


# ---------------------------------------------------------------- rising / falling
def pitch_ramp(x, r, up):
    """Pitch moves steadily up (rising) or down (falling) by 3 to 24 semitones, either by speeding up / slowing down the
    playback (tape) or with a time-preserving shifter (pitch)."""
    n = len(x); kind = r.choice(['tape', 'pitch', 'pitch']); semis = r.uniform(3, 24) * (1 if up else -1)
    st = int(r.uniform(0, .5) * n) if r.random() < .5 else 0; L = n - st
    a = np.linspace(0, 1, L) ** r.uniform(.6, 2.0); curve = np.r_[np.zeros(st), semis * a]
    s = dict(kind=kind, semitones=round(semis, 1), start_s=round(st / RATE, 2))
    if kind == 'tape':
        speed = 2 ** (curve / 12); pos = np.cumsum(speed) - speed[0]; pos = pos[pos < n - 1]
        i0 = pos.astype(int); f = pos - i0; y = x[i0] * (1 - f) + x[i0 + 1] * f
        if len(y) > 320: y[-320:] *= np.linspace(1, 0, 320)
        n = min(MAX_N, len(y))   # slower playback runs longer, faster runs out sooner: both copies take the wet length
        if n < .5 * RATE: return None, 'too short after the ramp', n
    else: y = glide_shift(x, curve)
    return y, s, n


FX = {'glitch effect': glitch, 'chops': chops, 'vocal chops': vocal_chops, 'pulsing': pulsing, 'wobbling': wobbling}


def apply(tag, x, r, carrier=None, bpm=None):
    """x: float64 mono at 16 kHz, <= 10 s. Returns (dry, wet, settings) at one shared length, loudness matched, or (None, None, reason)."""
    if tag == 'vocoder vocal': y, s, n = vocoder(x, r, carrier)
    elif tag in ('rising', 'falling'): y, s, n = pitch_ramp(x, r, tag == 'rising')
    else: y, s, n = FX[tag](x, r, bpm)
    if y is None: return None, None, s
    n = min(n, MAX_N); y = fit(y, n); d = fit(x.copy(), n)
    if not np.isfinite(y).all() or rms(y) < 1e-4: return None, None, 'bad output'
    y = y * rms(d) / rms(y)
    g = .95 / max(np.abs(y).max(), np.abs(d).max(), 1e-9)
    g = min(g, .3 / rms(d))
    return d * g, y * g, s
