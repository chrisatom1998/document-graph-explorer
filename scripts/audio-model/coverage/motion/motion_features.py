"""Motion features: how a sound moves over time (envelope, onsets, beat regularity, amplitude and colour modulation,
pitch or brightness trend), from plain DSP. Prototype for rule-based tags next to the timbre rules in
src/audio/timbre.ts / timbreDescriptions.ts, so every step here is cheap and portable to TypeScript:

  * the same 32 kHz mono input and excerpt plan as the app's timbre summary (whole clip up to 12 s, else three 4 s
    excerpts at 20/50/80%), each excerpt measured on its own and the numbers averaged;
  * a 16 ms level envelope (512 samples, the timbre code's LEVEL_FRAME);
  * a 16 ms spectral-flux onset curve (1024-point Hann FFT centred on each level frame, 200 Hz and up);
  * per 64 ms frame (2048-point FFT, 50% overlap, as timbre.ts): spectral centroid and an autocorrelation pitch
    (inverse FFT of the power spectrum).

Usage as a library: motion_features(x32k) -> dict of numbers. No audio is stored by this module.
"""
import numpy as np

SR = 32000
LEVEL = 512                 # 16 ms
FFT, HOP = 2048, 1024       # 64 ms frames, 50% overlap (timbre.ts)
FPS = SR / LEVEL            # 62.5 envelope frames per second
CPS = SR / HOP              # 31.25 centroid frames per second
WHOLE_SECONDS, EXCERPT_SECONDS = 12, 4

_hann1024 = np.hanning(2 * LEVEL + 2)[1:-1]
_hamm = 0.54 - 0.46 * np.cos(2 * np.pi * np.arange(FFT) / FFT)


def excerpts(n):
    d = n / SR
    if d <= WHOLE_SECONDS: return [(0, n)]
    out = []
    for at in (.2, .5, .8):
        s = max(0.0, min(d - EXCERPT_SECONDS, d * at - EXCERPT_SECONDS / 2))
        out.append((int(s * SR), int(s * SR) + EXCERPT_SECONDS * SR))
    return out


def _acf(v):
    """Normalised autocorrelation (biased) of a mean-removed series; acf[0] = 1."""
    v = v - v.mean()
    n = len(v)
    if n < 4 or not np.any(v): return np.zeros(max(n, 1))
    f = np.fft.rfft(v, 2 * n)
    a = np.fft.irfft(f * np.conj(f))[:n]
    return a / a[0]


def _peak(acf, lo, hi):
    """Largest local maximum of acf in lag range [lo, hi] (frames); (value, lag)."""
    hi = min(hi, len(acf) - 2)
    best, lag = 0.0, 0
    for k in range(max(lo, 1), hi + 1):
        if acf[k] > acf[k - 1] and acf[k] >= acf[k + 1] and acf[k] > best: best, lag = acf[k], k
    return best, lag


def _onsets(flux, thr_rel=1.5, min_gap=3):
    """Peak-pick the flux curve: local max above (median of a 0.5 s window) + thr_rel * MAD and >= 5% of the max."""
    n = len(flux)
    if n < 3 or flux.max() <= 0: return []
    out, last = [], -10
    w = 16
    for k in range(1, n - 1):
        if flux[k] < flux[k - 1] or flux[k] < flux[k + 1]: continue
        seg = flux[max(0, k - w): k + w + 1]
        med = np.median(seg); mad = np.median(np.abs(seg - med)) + 1e-12
        if flux[k] > med + thr_rel * mad * 4 and flux[k] >= .05 * flux.max() and k - last >= min_gap:
            out.append(k); last = k
    return out


def _excerpt(x):
    n = len(x) // LEVEL
    if n < 8: return None
    fr = x[: n * LEVEL].reshape(n, LEVEL)
    rms = np.sqrt((fr ** 2).mean(1))
    peak = rms.max()
    if peak < 1e-4: return None
    db = 20 * np.log10(rms / peak + 1e-6)                  # 0 dB = loudest frame
    act = db > -30                                         # active frames
    a_idx = np.flatnonzero(act)
    first, lastf = a_idx[0], a_idx[-1]
    span = lastf - first + 1                               # active span in frames
    # Spectral flux (log magnitude, positive differences), 512-pt Hann FFT per 16 ms frame.
    # 1024-point Hann windows centred on each 16 ms frame (so a low note's waveform period does not ripple the curve),
    # bins from 200 Hz up.
    xp = np.pad(x[: n * LEVEL], (LEVEL // 2, LEVEL // 2 + LEVEL))
    win = np.lib.stride_tricks.sliding_window_view(xp, 2 * LEVEL)[::LEVEL][:n]
    mag = np.abs(np.fft.rfft(win * _hann1024, axis=1))[:, int(200 / (SR / (2 * LEVEL))):]
    lm = np.log1p(1000 * mag / (mag.max() + 1e-12))
    flux = np.r_[0, np.maximum(lm[1:] - lm[:-1], 0).sum(1)]
    flux[~act] = 0
    ons = _onsets(flux)
    # 64 ms frames: centroid and autocorrelation pitch.
    cents, f0s, confs, cdb = [], [], [], []
    for s in range(0, max(1, len(x) - FFT + 1), HOP):
        w = x[s: s + FFT]
        if len(w) < FFT: w = np.pad(w, (0, FFT - len(w)))
        ms = (w ** 2).mean()
        if ms < 1e-8: cents.append(np.nan); f0s.append(np.nan); confs.append(0); cdb.append(-120); continue
        sp = np.fft.rfft(w * _hamm); p = sp.real ** 2 + sp.imag ** 2
        hz = np.arange(len(p)) * SR / FFT
        band = (hz >= 20) & (hz <= 16000)
        cents.append((hz[band] * p[band]).sum() / (p[band].sum() + 1e-20))
        ac = np.fft.irfft(p)[: FFT // 2]
        lo, hi = int(SR / 1000), int(SR / 50)              # 50 Hz .. 1 kHz
        # Normalise for the window overlap at lag k so long lags are not penalised.
        norm = ac[lo:hi] / (ac[0] * (1 - np.arange(lo, hi) / FFT) + 1e-20)
        # Shortest lag within 10% of the best peak, so a sub-harmonic lag (an octave low) does not win.
        top = norm.max(); cand = np.flatnonzero((norm >= .9 * top) & (np.r_[True, norm[1:] >= norm[:-1]]) & (np.r_[norm[:-1] >= norm[1:], True]))
        k = int(cand[0]) if len(cand) else int(np.argmax(norm)); c = float(norm[k])
        f0s.append(SR / (lo + k)); confs.append(c); cdb.append(10 * np.log10(ms + 1e-20))
    cents, f0s, confs, cdb = map(np.asarray, (cents, f0s, confs, cdb))
    cdb = cdb - cdb.max()
    cact = cdb > -25
    f = {}
    f['seconds'] = len(x) / SR
    f['active_s'] = span / FPS
    f['sustain'] = float(np.median(rms) / peak)
    f['active_frac'] = act.mean()
    # Envelope shape
    pk = int(np.argmax(rms))
    f['peak_pos'] = (pk - first) / max(span - 1, 1)        # 0 = peak at start of active part, 1 = at its end
    pre = db[first: pk + 1]
    above = np.flatnonzero(pre > -20)
    f['attack_s'] = (pk - (first + above[0])) / FPS if len(above) else 0.0
    post = db[pk:]
    d20 = np.flatnonzero(post < -20)
    f['decay20_s'] = (d20[0] / FPS) if len(d20) else (len(post) / FPS + 10)   # +10: never decays 20 dB in the clip
    q = max(1, span // 4)
    f['rise_db'] = float(db[pk] - np.mean(db[first: first + q]))
    f['fall_db'] = float(db[pk] - np.mean(db[lastf - q + 1: lastf + 1]))
    seg = db[first: lastf + 1]
    t = np.arange(len(seg)) / FPS
    f['level_slope'] = float(np.polyfit(t, seg, 1)[0]) if len(seg) > 3 else 0.0   # dB per second over the active part
    f['level_std'] = float(np.std(np.clip(seg, -40, 0)))
    f['level_p90_p10'] = float(np.percentile(seg, 90) - np.percentile(seg, 10))
    # Swell: how steadily the 0.25 s-smoothed level climbs from the start of the sound to its loudest point.
    sm = np.convolve(db, np.ones(16) / 16, mode='same')
    spk = first + int(np.argmax(sm[first: lastf + 1]))
    rise = sm[first: spk + 1]
    f['swell_len_s'] = (spk - first) / FPS
    f['swell_r'] = float(np.corrcoef(np.arange(len(rise)), rise)[0, 1]) if len(rise) >= 8 and np.std(rise) > 0 else 0.0
    f['swell_db'] = float(sm[spk] - sm[first: first + 8].mean()) if len(rise) >= 8 else 0.0
    f['swell_pos'] = (spk - first) / max(span - 1, 1)
    # Inter-onset intervals: median and spread (a roll is fast and even).
    ioi = np.diff(ons) / FPS if len(ons) >= 3 else np.array([])
    f['ioi_med'] = float(np.median(ioi)) if len(ioi) else 0.0
    f['ioi_cv'] = float(np.std(ioi) / np.mean(ioi)) if len(ioi) else 9.0
    # Onsets and rhythm
    f['onsets'] = len(ons)
    f['onset_rate'] = len(ons) / max(span / FPS, .25)
    fl = flux[first: lastf + 1]
    fa = _acf(fl)
    f['beat_acf'], lag = _peak(fa, int(FPS * .25), int(FPS * 1.5))     # 40..240 BPM
    f['beat_lag_s'] = lag / FPS
    f['beat_acf2'] = float(fa[2 * lag]) if lag and 2 * lag < len(fa) else 0.0       # the pattern repeats a beat later too
    f['fast_acf'], flag = _peak(fa, 2, int(FPS / 8))                    # 8..31 Hz repetition (rolls)
    f['fast_lag_s'] = flag / FPS
    # Amplitude modulation: periodicity and depth of the level envelope.
    lin = rms[first: lastf + 1] / peak
    la = _acf(lin)
    f['am_acf'], alag = _peak(la, int(FPS / 16), int(FPS * 1.0))        # 1..16 Hz
    f['am_hz'] = FPS / alag if alag else 0.0
    # Syncopation: put the onset curve on the beat grid found above; share of flux on off-beat 16ths/8ths that is
    # not followed by a stronger on-beat (a simple accent-displacement measure).
    f['sync'] = _syncopation(fl, lag) if lag and len(ons) >= 4 else 0.0
    # Centroid motion
    good = cact & np.isfinite(cents)
    lc = np.log2(np.maximum(cents[good], 20))
    tc = np.flatnonzero(good) / CPS
    f['cent_hz'] = float(2 ** np.average(lc, weights=10 ** (cdb[good] / 10))) if good.any() else 0.0
    if good.sum() >= 6:
        b = np.polyfit(tc, lc, 1)
        f['cent_trend_oct'] = float(b[0] * (tc[-1] - tc[0]))
        f['cent_r'] = float(np.corrcoef(tc, lc)[0, 1]) if np.std(lc) > 0 else 0.0
        resid = lc - np.polyval(b, tc)
        f['cent_wob_std'] = float(np.std(resid))
        ca = _acf(np.interp(np.arange(int(tc[0] * CPS), int(tc[-1] * CPS) + 1) / CPS, tc, resid))
        f['cent_acf'], clag = _peak(ca, 3, int(CPS * 1.0))               # 1..10 Hz
        f['cent_wob_hz'] = CPS / clag if clag else 0.0
    else:
        f.update(cent_trend_oct=0.0, cent_r=0.0, cent_wob_std=0.0, cent_acf=0.0, cent_wob_hz=0.0)
    # Pitch motion (voiced frames only)
    v = cact & (confs >= .6)
    f['voiced'] = float(v.sum() / max(cact.sum(), 1))
    if v.sum() >= 6:
        lp = np.log2(f0s[v]); tp = np.flatnonzero(v) / CPS
        # unwrap octave jumps: median filter 3
        lp = np.array([np.median(lp[max(0, i - 1): i + 2]) for i in range(len(lp))])
        b = np.polyfit(tp, lp, 1)
        f['pitch_trend_oct'] = float(b[0] * (tp[-1] - tp[0]))
        f['pitch_r'] = float(np.corrcoef(tp, lp)[0, 1]) if np.std(lp) > 0 else 0.0
        f['pitch_drop_oct'] = float(np.median(lp[: max(2, len(lp) // 4)]) - np.median(lp[-max(2, len(lp) // 4):]))
        r = lp - np.polyval(b, tp)
        f['pitch_wob_std'] = float(np.std(r))
    else:
        f.update(pitch_trend_oct=0.0, pitch_r=0.0, pitch_drop_oct=0.0, pitch_wob_std=0.0)
    return f


def _syncopation(fl, lag):
    """Fraction of onset energy that lands on off-beat positions (8th and 16th offsets) relative to all grid energy,
    with the beat phase chosen to maximise on-beat energy."""
    n = len(fl)
    best, phase = -1, 0
    for ph in range(lag):
        e = fl[ph::lag].sum()
        if e > best: best, phase = e, ph
    def at(pos):
        k = int(round(pos))
        return fl[max(0, k - 1): k + 2].max() if 0 <= k < n else 0.0
    on, off = 0.0, 0.0
    b = phase
    while b < n:
        on += at(b)
        off += max(at(b + lag / 4), at(b + 3 * lag / 4)) + .5 * at(b + lag / 2)
        b += lag
    return float(off / (on + off + 1e-12))


def motion_features(x):
    """x: float32 mono at 32 kHz. Mean of per-excerpt features (None when silent)."""
    x = np.asarray(x, np.float64)
    fs = [f for s, e in excerpts(len(x)) for f in [_excerpt(x[s:e])] if f]
    if not fs: return None
    return {k: float(np.mean([f[k] for f in fs])) for k in fs[0]}
