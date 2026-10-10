"""Effect chains for the dry/wet effect pairs (coverage idea #4), at 16 kHz mono.

Unlike scripts/audio-model/render.py (one fixed recipe per tag, which the model learned as "this source sound"), each tag
here draws from several real-style processing chains with randomised settings and dry/wet mixes, including subtle ones,
and reverb uses measured room impulse responses instead of synthetic noise tails. apply(tag, x, rng, irs) returns
(wet, settings) or (None, reason). Pedalboard (Spotify, GPL-3) supplies the standard plugin models.
"""
import numpy as np
import pedalboard as pb
from scipy.signal import fftconvolve, butter, sosfilt

RATE = 16000
MAX_N = 10 * RATE
rms = lambda x: float(np.sqrt(np.mean(x ** 2)) + 1e-9)


def run(board, x, reset=True):
    return board(x.astype(np.float32)[None, :], RATE, reset=reset)[0].astype(np.float64)


def fit(y, n):
    return pad(y[:min(n, MAX_N)], min(n, MAX_N))


def tail_len(x, extra_s):
    return min(MAX_N, len(x) + int(extra_s * RATE))


def pad(x, n):
    return np.concatenate([x, np.zeros(max(0, n - len(x)))])[:n]


def fade(n, ms=3):
    k = max(1, int(ms * RATE / 1000)); w = np.ones(n); w[:k] = np.linspace(0, 1, k); w[-k:] = np.minimum(w[-k:], np.linspace(1, 0, k)); return w


def trim_lead(y, thr=.01):
    a = np.abs(y); lead = int(np.argmax(a > thr * (a.max() + 1e-9))); return y[lead:]


def mix(dry, wet, m):
    wet = wet * rms(dry) / rms(wet); return (1 - m) * dry + m * wet


# ---------------------------------------------------------------- time edits
def reverse(x, r, irs, vocal=False):
    s = {}; long = len(x) > 1.5 * RATE
    modes = ['whole', 'whole', 'reversed-reverb'] + (['segment'] if long else []) + ([] if vocal else ['reverse-reverb-swell'])
    mode = r.choice(modes); s['mode'] = mode; n = len(x)
    if mode == 'whole': y = trim_lead(x[::-1].copy())
    elif mode == 'reversed-reverb':   # reverb the sound, then play the whole thing backwards (tail first)
        ir, ii = pick_ir(irs, r); s['ir'] = ii['name']; w = fftconvolve(x, ir)
        y = trim_lead(w[::-1].copy(), .005); n = min(MAX_N, len(y))
    elif mode == 'reverse-reverb-swell':   # classic production trick: a reversed reverb tail swells up into the forward sound
        ir, ii = pick_ir(irs, r); s['ir'] = ii['name']; w = fftconvolve(x[::-1], ir)[::-1]
        m = r.uniform(.5, .9); s['swell_mix'] = round(m, 2)
        y = (1 - m) * np.concatenate([np.zeros(len(ir) - 1), x]) + m * w * rms(x) / rms(w)
        y = trim_lead(y, .005); n = min(MAX_N, len(y))
    else:   # reverse one beat-ish segment inside a longer phrase
        seg = int(r.uniform(max(.3, .2 * len(x) / RATE), max(.35, min(3.0, len(x) / RATE / 2))) * RATE); st = r.randint(0, len(x) - seg)
        y = x.copy(); y[st:st + seg] = x[st:st + seg][::-1] * fade(seg); s.update(seg_s=round(seg / RATE, 2), at_s=round(st / RATE, 2))
    return y, s, n


def record_stop(x, r, irs):
    n = len(x); at = int(r.uniform(.25, .75) * n); dur = r.uniform(.3, 2.0); curve = r.uniform(.6, 2.2)
    kind = r.choice(['stop', 'stop', 'stop', 'start-stop'])
    m = int(dur * RATE); slow = np.clip(1 - np.arange(m) / m, 0, 1) ** curve
    speed = np.concatenate([np.ones(at), slow])
    if kind == 'start-stop':   # tape start at the beginning too
        k = int(r.uniform(.15, .6) * RATE); speed[:k] = np.linspace(0, 1, k) ** r.uniform(.8, 1.8)
    pos = np.cumsum(speed); pos = pos[pos < n - 1]; i0 = pos.astype(int); f = pos - i0
    y = x[i0] * (1 - f) + x[i0 + 1] * f
    if r.random() < .5:   # pitch dropping also loses top end on a real deck / tape
        lp = pb.Pedalboard([pb.LowpassFilter(cutoff_frequency_hz=r.uniform(1500, 4000))]); tail = y[at:]
        if len(tail) > 64: y[at:] = (1 - np.linspace(0, 1, len(tail))) * tail + np.linspace(0, 1, len(tail)) * run(lp, tail)
    if len(y) > 320: y[-320:] *= np.linspace(1, 0, 320)
    n = min(MAX_N, len(y))   # slowing down stretches the audio: keep the whole stop, pad the dry copy
    return y, dict(kind=kind, at_s=round(at / RATE, 2), stop_s=round(dur, 2), curve=round(curve, 2)), n


def stutter(x, r, irs, bpm=None):
    n = len(x); bpm = bpm or r.uniform(85, 175); beat = 60 / bpm * RATE
    a = np.abs(x); act = np.flatnonzero(a > .05 * a.max()); y = x.copy(); events = []
    want, done, tries = r.choice([1, 1, 2, 3]), 0, 0
    need = max(.5 * RATE, .15 * n)   # enough of the clip must stutter that the label is true of the clip, not of a blip
    while (len(events) < want or done < need) and tries < 8:
        tries += 1
        div = r.choice([4, 8, 8, 16, 16, 32]); sl = int(beat * 4 / div)   # 1/4 note .. 1/32 note slices
        if sl < 160 or len(act) == 0: continue
        st = int(r.choice(list(act[::max(1, len(act) // 64)]))); st = min(st, n - sl - 1)
        if st < 0: continue
        reps = r.randint(3, 16); piece = x[st:st + sl] * fade(sl, 2)
        style = r.choice(['repeat', 'repeat', 'roll', 'gate'])
        if style == 'roll':   # slices get shorter (a stutter roll)
            out, k = [], sl
            while sum(map(len, out)) < reps * sl and k >= 120: out.append(x[st:st + k] * fade(k, 2)); k = int(k * r.uniform(.75, .9)) if r.random() < .5 else k
            seq = np.concatenate(out)
        elif style == 'gate':
            g = np.ones(sl); g[int(sl * r.uniform(.4, .7)):] = 0; seq = np.tile(piece * g, reps)
        else: seq = np.tile(piece, reps)
        seq = seq[:n - st]; y[st:st + len(seq)] = seq; done += len(seq); events.append(dict(div=div, reps=reps, style=style, at_s=round(st / RATE, 2)))
    if not events or done < need: return None, 'stutter too short', n
    return y, dict(bpm=round(bpm, 1), events=events), n


# ---------------------------------------------------------------- space
def pick_ir(irs, r):
    ii = irs[r.randrange(len(irs))]; return ii['ir'], ii


def reverberant(x, r, irs):
    if r.random() < .7:   # measured room impulse response
        ir, ii = pick_ir(irs, r); pre = int(r.uniform(0, .03) * RATE); ir = np.concatenate([np.zeros(pre), ir])
        if r.random() < .3: ir = sosfilt(butter(2, r.uniform(2500, 6000), 'low', fs=RATE, output='sos'), ir)   # darker room
        m = r.choice([r.uniform(.3, .45), r.uniform(.45, .8), r.uniform(.8, 1.0)])
        w = fftconvolve(x, ir); n = tail_len(x, min(ii['rt60'], 3.0))
        y = mix(pad(x, len(w)), w, m)
        return y, dict(chain='convolution', ir=ii['name'], ir_db=ii['db'], ir_rt60_s=ii['rt60'], predelay_ms=round(pre / RATE * 1000), wet=round(m, 2)), n
    room, damp, wet = r.uniform(.5, 1.0), r.uniform(.1, .8), r.uniform(.2, .6)
    b = pb.Pedalboard([pb.Reverb(room_size=room, damping=damp, wet_level=wet, dry_level=1 - wet * .6, width=1.0)])
    n = tail_len(x, 1 + 2.5 * room); y = run(b, pad(x, n))
    return y, dict(chain='algorithmic (pedalboard Reverb / Freeverb)', room=round(room, 2), damping=round(damp, 2), wet=round(wet, 2)), n


def echoing(x, r, irs):
    t = r.uniform(.12, .65); fb = r.uniform(.25, .7); m = r.uniform(.3, .7); style = r.choice(['digital', 'tape', 'tape', 'multitap'])
    n = tail_len(x, t * r.randint(3, 8)); xp = pad(x, n); s = dict(style=style, delay_s=round(t, 3), feedback=round(fb, 2), mix=round(m, 2))
    if style == 'digital':
        y = run(pb.Pedalboard([pb.Delay(delay_seconds=t, feedback=fb, mix=m)]), xp)
    else:   # echoes, each a little darker (tape) or at uneven taps
        d = int(t * RATE); wet = np.zeros(n); rep = xp.copy(); cut = r.uniform(1800, 5000)
        sos = butter(1, cut, 'low', fs=RATE, output='sos'); taps = [1, r.uniform(1.3, 1.8), r.uniform(2.2, 3.1)] if style == 'multitap' else None
        for k in range(1, 9):
            off = int(d * (taps[k - 1] if taps and k <= 3 else k))
            if off >= n: break
            if style == 'tape': rep = sosfilt(sos, rep)
            wet[off:] += fb ** k * rep[:n - off] if style == 'tape' else fb ** (k - 1) * .8 * xp[:n - off]
            if taps and k >= 3: break
        y = (1 - m) * xp + m * wet * 1.5; s['tone_hz'] = round(cut)
    if r.random() < .25:   # echoes into a little room
        ir, ii = pick_ir(irs, r); y = mix(y, fftconvolve(y, ir)[:n], .2); s['plus_room'] = ii['name']
    return y, s, n


# ---------------------------------------------------------------- tone
def distorted(x, r, irs):
    pk = np.abs(x).max() + 1e-9; xn = x / pk; s = {}
    kind = r.choice(['pedal', 'tube', 'fuzz', 'hardclip', 'amp']); s['kind'] = kind
    subtle = r.random() < .25; s['subtle'] = subtle
    drive = r.uniform(8, 14) if subtle else r.uniform(14, 40); s['drive_db'] = round(drive, 1); g = 10 ** (drive / 20)
    if kind == 'pedal': y = run(pb.Pedalboard([pb.Distortion(drive_db=drive)]), xn)
    elif kind == 'tube':
        b = r.uniform(.1, .4); y = np.tanh(g * xn + b) - np.tanh(b); s['bias'] = round(b, 2)
    elif kind == 'fuzz': y = np.sign(xn) * (1 - np.exp(-np.abs(g * xn)))
    elif kind == 'hardclip': y = np.clip(g * xn, -1, 1)
    else:   # amp-style chain: tighten lows, drive, cab-like low-pass
        y = run(pb.Pedalboard([pb.HighpassFilter(cutoff_frequency_hz=r.uniform(80, 250)), pb.PeakFilter(cutoff_frequency_hz=r.uniform(700, 1500), gain_db=r.uniform(3, 9), q=.8),
                               pb.Distortion(drive_db=drive), pb.LowpassFilter(cutoff_frequency_hz=r.uniform(3000, 6000))]), xn)
    if kind != 'amp' and r.random() < .5:
        lp = r.uniform(3500, 7000); y = run(pb.Pedalboard([pb.LowpassFilter(cutoff_frequency_hz=lp)]), y); s['post_lp_hz'] = round(lp)
    m = r.uniform(.5, .8) if subtle else r.uniform(.8, 1.0); s['mix'] = round(m, 2)
    return mix(x, y * pk, m), s, len(x)


def bitcrushed(x, r, irs):
    bits = r.choice([3, 4, 5, 6, 6, 7, 8]); hold_sr = r.choice([2000, 3000, 4000, 5500, 8000, 11025, 16000])
    if bits >= 7 and hold_sr >= 11025: hold_sr = r.choice([3000, 4000, 5500])   # make sure something audible happens
    y = run(pb.Pedalboard([pb.Bitcrush(bit_depth=bits)]), x / (np.abs(x).max() + 1e-9)) * (np.abs(x).max() + 1e-9)
    if hold_sr < RATE:   # sample-and-hold rate reduction with no anti-alias filter (the aliasing is the sound)
        step = RATE / hold_sr; idx = (np.floor(np.arange(len(y)) / step) * step).astype(int); y = y[np.clip(idx, 0, len(y) - 1)]
    m = r.uniform(.6, 1.0); return mix(x, y, m), dict(bits=bits, rate_hz=hold_sr, mix=round(m, 2)), len(x)


def chorused(x, r, irs):
    if r.random() < .6:
        rate, depth, cd, fb, m = r.uniform(.2, 2.5), r.uniform(.15, .7), r.uniform(6, 20), r.uniform(0, .25), r.uniform(.35, .65)
        y = run(pb.Pedalboard([pb.Chorus(rate_hz=rate, depth=depth, centre_delay_ms=cd, feedback=fb, mix=m)]), x)
        return y, dict(chain='pedalboard Chorus', rate_hz=round(rate, 2), depth=round(depth, 2), centre_ms=round(cd, 1), feedback=round(fb, 2), mix=round(m, 2)), len(x)
    t = np.arange(len(x)) / RATE; y = x.copy(); voices = r.randint(2, 4); m = r.uniform(.4, .7)
    for _ in range(voices):   # ensemble: several modulated delay lines
        base, dep, lfo = r.uniform(.010, .028) * RATE, r.uniform(.001, .004) * RATE, r.uniform(.2, 1.8)
        y = y + m * frac_delay(x, base + dep * np.sin(2 * np.pi * lfo * t + r.uniform(0, 6.28)))
    return y, dict(chain='multi-voice ensemble', voices=voices, mix=round(m, 2)), len(x)


def frac_delay(x, d):
    idx = np.arange(len(x)) - d; i0 = np.floor(idx).astype(int); f = idx - i0
    a = np.where((i0 >= 0) & (i0 < len(x)), x[np.clip(i0, 0, len(x) - 1)], 0); b = np.where((i0 + 1 >= 0) & (i0 + 1 < len(x)), x[np.clip(i0 + 1, 0, len(x) - 1)], 0)
    return a * (1 - f) + b * f


def flanged(x, r, irs):
    t = np.arange(len(x)) / RATE; lo, sweep, lfo = r.uniform(.0005, .002), r.uniform(.002, .006), r.uniform(.08, .8)
    fb = r.uniform(.4, .85) * r.choice([1, 1, -1]); m = r.uniform(.75, 1.0)   # y already holds dry + delayed copy
    d = (lo + sweep * (1 + np.sin(2 * np.pi * lfo * t + r.uniform(0, 6.28))) / 2) * RATE
    y = x.copy()
    for _ in range(4): y = x + fb * frac_delay(y, d)   # feedback approximated by a few passes
    return mix(x, y, m), dict(min_ms=round(lo * 1000, 2), sweep_ms=round(sweep * 1000, 2), lfo_hz=round(lfo, 2), feedback=round(fb, 2), mix=round(m, 2)), len(x)


def filtered(x, r, irs):
    kind = r.choice(['lowpass', 'lowpass', 'highpass', 'bandpass', 'telephone', 'ladder-lp', 'ladder-hp'])
    if kind == 'lowpass':
        f = r.uniform(250, 2200); b = pb.Pedalboard([pb.LowpassFilter(cutoff_frequency_hz=f), pb.LowpassFilter(cutoff_frequency_hz=f)])
    elif kind == 'highpass':
        f = r.uniform(500, 3000); b = pb.Pedalboard([pb.HighpassFilter(cutoff_frequency_hz=f), pb.HighpassFilter(cutoff_frequency_hz=f)])
    elif kind == 'bandpass':
        f = r.uniform(400, 2500); b = pb.Pedalboard([pb.LadderFilter(mode=pb.LadderFilter.Mode.BPF24, cutoff_hz=f, resonance=r.uniform(0, .5))])
    elif kind == 'telephone':
        f = 300; b = pb.Pedalboard([pb.HighpassFilter(cutoff_frequency_hz=r.uniform(250, 500)), pb.HighpassFilter(cutoff_frequency_hz=400),
                                    pb.LowpassFilter(cutoff_frequency_hz=r.uniform(2800, 3600)), pb.LowpassFilter(cutoff_frequency_hz=3400)])
    else:
        f = r.uniform(300, 2500) if kind == 'ladder-lp' else r.uniform(600, 3000)
        b = pb.Pedalboard([pb.LadderFilter(mode=pb.LadderFilter.Mode.LPF24 if kind == 'ladder-lp' else pb.LadderFilter.Mode.HPF24, cutoff_hz=f, resonance=r.uniform(0, .6))])
    y = run(b, x)
    if rms(y) < .04 * rms(x): return None, 'filtered to silence', len(x)
    return y, dict(kind=kind, cutoff_hz=round(f)), len(x)


def filter_sweep(x, r, irs):
    n = len(x); mode = r.choice(['LPF24', 'LPF24', 'LPF12', 'HPF24', 'BPF12']); res = r.uniform(0, .75)
    lo, hi = r.uniform(150, 500), r.uniform(4000, 7500)
    shape = r.choice(['up', 'down', 'up', 'down', 'updown', 'lfo'])
    dur = min(n / RATE, r.uniform(1.0, 8.0)); st = r.uniform(0, max(0, n / RATE - dur)); lfo = r.uniform(.15, 1.5)
    lad = pb.LadderFilter(mode=getattr(pb.LadderFilter.Mode, mode), cutoff_hz=hi, resonance=res, drive=1.0); b = pb.Pedalboard([lad]); y = np.zeros(n); B = 128
    for s in range(0, n, B):
        tt = s / RATE
        if shape == 'lfo': a = (1 - np.cos(2 * np.pi * lfo * tt)) / 2
        else:
            a = np.clip((tt - st) / dur, 0, 1)
            if shape == 'down': a = 1 - a
            elif shape == 'updown': a = 1 - abs(2 * a - 1)
        lad.cutoff_hz = float(lo * (hi / lo) ** a); y[s:s + B] = run(b, x[s:s + B], reset=(s == 0))
    if rms(y) < .04 * rms(x): return None, 'swept to silence', n
    return y, dict(mode=mode, resonance=round(res, 2), lo_hz=round(lo), hi_hz=round(hi), shape=shape, start_s=round(st, 2), dur_s=round(dur, 2),
                   **({'lfo_hz': round(lfo, 2)} if shape == 'lfo' else {})), n


FX = {'reverse effect': reverse, 'reversed vocal': reverse, 'record stop': record_stop, 'stutter effect': stutter, 'reverberant': reverberant,
      'echoing': echoing, 'distorted': distorted, 'chorused': chorused, 'flanged': flanged, 'bitcrushed': bitcrushed, 'filtered': filtered,
      'filter sweep': filter_sweep}


def apply(tag, x, r, irs, bpm=None):
    """x: float64 mono at 16 kHz, <= 10 s. Returns (dry, wet, settings) at one shared length, loudness matched, or (None, None, reason)."""
    f = FX[tag]
    if tag == 'stutter effect': y, s, n = f(x, r, irs, bpm)
    elif tag in ('reverse effect', 'reversed vocal'): y, s, n = f(x, r, irs, vocal=(tag == 'reversed vocal'))
    else: y, s, n = f(x, r, irs)
    if y is None: return None, None, s
    n = min(n, MAX_N); y = fit(y, n); d = fit(x.copy(), n)
    if not np.isfinite(y).all() or rms(y) < 1e-4: return None, None, 'bad output'
    y = y * rms(d) / rms(y)   # same loudness as the dry copy, so level is no clue
    g = .95 / max(np.abs(y).max(), np.abs(d).max(), 1e-9)
    g = min(g, .3 / rms(d))   # common gain (about -10 dBFS RMS at most) keeps the pair at one level
    return d * g, y * g, s
