"""Measured character labels for real recordings, then CLAP heads that predict them.

Uploader tags for words like "bright" or "sustained" are unreliable, so these labels are defined by
measurement on the first 10 s of each real clip (tag-mined Freesound previews). Clips between the
cut-offs are left unknown (neither positive nor negative):
  bright / dark   energy-weighted median spectral centroid: top 20% / bottom 20% (negatives: below 50% / above 50%)
  sustained / percussive   share of 20 ms frames within 10 dB of the loudest frame: top 25% / bottom 25%
  pulsing         prominence of the amplitude-envelope autocorrelation peak at 2-12 Hz: top 15% (negative below 70%)
  swelling        loudness trend across the clip >= +10 dB (negative < +4 dB)
  rising          spectral-centroid trend >= +0.7 octave (negative < +0.25)
  wobbling        brightness (log centroid) swings periodically at 1-8 Hz: top 15% of peak prominence x swing depth
  airy            share of energy above 5 kHz x its spectral flatness: top 15% (noisy air, not just treble)
  smooth          mean positive spectral change between frames: bottom 20%
  rolling         >= 6 onsets/s with even spacing (inter-onset CV < 0.35)
  syncopated      among rhythmic clips, onset strength half a beat off the fitted grid: top 15%
  warm            150-800 Hz energy share minus 4-8 kHz share: top 15%
  nasal           800-2500 Hz energy vs the bands either side: top 15%
  staccato        >= 3 onsets/s and sustain share at or below median (negative < 1.5 onsets/s or sustain above 65th pct)
  rhythmic        onset-strength autocorrelation peak at 0.25-1.5 s lags >= 0.45 (negative < 0.2)
Gap clips are left out of training; precision/recall reported are the WORSE of the gap-free score and a strict
score that counts in-between clips in the held-out groups as negatives.
Heads: logistic regression on the app's CLAP fingerprint, 5-fold by uploader for the threshold, scored on
held-out uploaders (about 25% of positives). Output uses the train-with-extras round format, so
add-maybe-heads.py can ship passing heads. These numbers measure agreement with the definitions above,
not with listeners.
Usage: dsp-character-labels.py <fsm manifest.json> <fingerprint dir> <features.json> <round-out.json>"""
import json, sys, os, glob, subprocess, hashlib
import numpy as np
from joblib import Parallel, delayed
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold

MAN, EMB, FEAT, OUT = sys.argv[1:5]
RATE = 16000; BAR = float(os.environ.get('BAR', 0.45)); LIMIT = int(os.environ.get('LIMIT', 16000))

def features(path):
    try:
        raw = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-t', '10', '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'], capture_output=True, timeout=60).stdout
        x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    except Exception: return None
    if len(x) < RATE or np.sqrt(np.mean(x ** 2)) < 1e-3: return None
    hop, win = 320, 1024                                     # 20 ms hop
    frames = np.lib.stride_tricks.sliding_window_view(np.pad(x, (0, win)), win)[::hop][:len(x) // hop]
    spec = np.abs(np.fft.rfft(frames * np.hanning(win), axis=1)); freqs = np.fft.rfftfreq(win, 1 / RATE)
    energy = (spec ** 2).sum(1) + 1e-12
    cent = (spec * freqs).sum(1) / (spec.sum(1) + 1e-12)
    order = np.argsort(cent); cum = np.cumsum(energy[order]); centroid = float(cent[order][np.searchsorted(cum, cum[-1] / 2)])
    db = 10 * np.log10(energy); sustain = float(np.mean(db >= db.max() - 10))
    env = np.sqrt(energy); env = env - env.mean()
    ac = np.correlate(env, env, 'full')[len(env) - 1:]; ac = ac / (ac[0] + 1e-12)
    fps = RATE / hop; lags = lambda lo, hi: ac[int(fps / hi):int(fps / lo) + 1]
    pulse = float(lags(2, 12).max()) if len(ac) > fps / 2 else 0.0
    flux = np.maximum(np.diff(np.log(spec + 1e-6), axis=0), 0).sum(1); flux = flux - flux.mean()
    fa = np.correlate(flux, flux, 'full')[len(flux) - 1:]; fa = fa / (fa[0] + 1e-12)
    rhythm = float(fa[int(.25 * fps):int(1.5 * fps) + 1].max()) if len(fa) > 1.5 * fps else 0.0
    t = np.linspace(0, 1, len(db)); loud = db > db.max() - 40
    rms_slope = float(np.polyfit(t[loud], db[loud], 1)[0]) if loud.sum() > 10 else 0.0           # dB across the clip
    lc = np.log2(np.maximum(cent, 20))
    cent_slope = float(np.polyfit(t[loud], lc[loud], 1)[0]) if loud.sum() > 10 else 0.0         # octaves across the clip
    band = ac[int(fps / 12):int(fps / 2) + 1]
    prom = float(max((band[i] - band[:i + 1].min() for i in range(1, len(band))), default=0.0)) if len(band) > 2 else 0.0
    peaks = (flux[1:-1] > flux[:-2]) & (flux[1:-1] > flux[2:]) & (flux[1:-1] > flux.std() * 1.5)
    onset_rate = float(peaks.sum() / (len(x) / RATE))
    cl = lc[loud] - lc[loud].mean() if loud.sum() > 20 else np.zeros(3)
    ca = np.correlate(cl, cl, 'full')[len(cl) - 1:]; ca = ca / (ca[0] + 1e-12)
    cband = ca[int(fps / 8):int(fps / 1) + 1]
    wob = float(max((cband[i] - cband[:i + 1].min() for i in range(1, len(cband))), default=0.0)) if len(cband) > 2 else 0.0
    wob *= float(np.std(cl))                                   # a deep swing, not a tiny periodic wiggle
    hf = freqs >= 5000; hspec = spec[:, hf] + 1e-9
    hf_ratio = float((spec[:, hf] ** 2).sum() / (spec ** 2).sum())
    flat = float(np.median(np.exp(np.log(hspec).mean(1)) / hspec.mean(1)))
    flux_mean = float(np.mean(np.maximum(np.diff(np.log(spec + 1e-6), axis=0), 0).mean(1)[db[1:] > db.max() - 30])) if (db[1:] > db.max() - 30).any() else 0.0
    return {'centroid': centroid, 'sustain': sustain, 'pulse': pulse, 'rhythm': rhythm, 'rmsSlope': rms_slope, 'centSlope': cent_slope,
            'pulseProminence': prom, 'onsetRate': onset_rate, 'wobble': wob, 'air': hf_ratio * flat, 'flux': flux_mean,
            **extra(x, spec, freqs, energy, flux, fa, fps, peaks)}

def extra(x, spec, freqs, energy, flux, fa, fps, peaks):
    on = np.where(peaks)[0] + 1
    ioi = np.diff(on) / fps if len(on) > 3 else np.array([])
    even = float(np.std(ioi) / np.mean(ioi)) if len(ioi) > 3 else 9.0
    # Beat period = strongest onset-autocorrelation lag at 0.25-1.5 s; offbeat share = onset strength half a beat
    # away from the beat grid that best fits the strongest onsets.
    syn = 0.0
    lo, hi = int(.25 * fps), int(1.5 * fps) + 1
    if len(fa) > hi and len(on) > 4:
        period = lo + int(np.argmax(fa[lo:hi])); w = np.maximum(flux, 0)
        phase = int(np.argmax([w[k::period].sum() for k in range(period)]))
        on_beat = sum(w[max(0, i - 1):i + 2].sum() for i in range(phase, len(w), period))
        off = sum(w[max(0, i - 1):i + 2].sum() for i in range(phase + period // 2, len(w), period))
        syn = float(off / (on_beat + off + 1e-9))
    band = lambda a, b: float(energy_band[(freqs >= a) & (freqs < b)].sum())
    energy_band = (spec ** 2).sum(0); tot = energy_band.sum() + 1e-12
    warm = (band(150, 800) - band(4000, 8000)) / tot
    nasal = band(800, 2500) / (band(300, 800) + band(2500, 5000) + 1e-9)
    return {'evenness': even, 'syncopation': syn, 'warmth': warm, 'nasality': float(nasal)}

clips = json.load(open(MAN))['clips']
clips = sorted(clips, key=lambda c: hashlib.sha256(c['id'].encode()).hexdigest())[:LIMIT]
feat = json.load(open(FEAT)) if os.path.exists(FEAT) else {}
todo = [c for c in clips if c['id'] not in feat]
if todo:
    got = Parallel(n_jobs=int(os.environ.get('JOBS', 8)), batch_size=16)(delayed(features)(c['path']) for c in todo)
    for c, f in zip(todo, got): feat[c['id']] = f
    json.dump(feat, open(FEAT, 'w'))
emb = {}
for f in glob.glob(f'{EMB}/emb-*.jsonl'):
    for line in open(f):
        r = json.loads(line)
        if r['id'] in feat and feat[r['id']] and r['id'] not in emb: emb[r['id']] = r['embedding']
rows = [c for c in clips if c['id'] in emb]
X = np.asarray([emb[c['id']] for c in rows], dtype=np.float32); X /= np.linalg.norm(X, axis=1, keepdims=True)
G = np.array([c['group'] for c in rows]); F = {k: np.array([feat[c['id']][k] for c in rows]) for k in ('centroid', 'sustain', 'pulse', 'rhythm', 'rmsSlope', 'centSlope', 'pulseProminence', 'onsetRate', 'wobble', 'air', 'flux', 'evenness', 'syncopation', 'warmth', 'nasality')}
q = lambda k, p: np.percentile(F[k], p)
DEF = {  # label: (positive mask, negative mask)
    'bright': (F['centroid'] >= q('centroid', 80), F['centroid'] < q('centroid', 70)),
    'dark': (F['centroid'] <= q('centroid', 20), F['centroid'] > q('centroid', 30)),
    'sustained': (F['sustain'] >= q('sustain', 75), F['sustain'] < q('sustain', 65)),
    'percussive': (F['sustain'] <= q('sustain', 25), F['sustain'] > q('sustain', 35)),
    'pulsing': (F['pulseProminence'] >= q('pulseProminence', 85), F['pulseProminence'] < q('pulseProminence', 70)),
    'swelling': (F['rmsSlope'] >= 10, F['rmsSlope'] < 4),
    'wobbling': (F['wobble'] >= q('wobble', 85), F['wobble'] < q('wobble', 70)),
    'airy': (F['air'] >= q('air', 85), F['air'] < q('air', 70)),
    'smooth': (F['flux'] <= q('flux', 20), F['flux'] > q('flux', 35)),
    'rolling': ((F['onsetRate'] >= 6) & (F['evenness'] < .35), (F['onsetRate'] < 3) | (F['evenness'] > .6)),
    'syncopated': ((F['rhythm'] >= .35) & (F['syncopation'] >= q('syncopation', 85)), (F['rhythm'] >= .35) & (F['syncopation'] < q('syncopation', 60))),
    'warm': (F['warmth'] >= q('warmth', 85), F['warmth'] < q('warmth', 70)),
    'nasal': (F['nasality'] >= q('nasality', 85), F['nasality'] < q('nasality', 70)),
    'rising': (F['centSlope'] >= .7, F['centSlope'] < .25),
    'staccato': ((F['onsetRate'] >= 3) & (F['sustain'] <= np.median(F['sustain'])), (F['onsetRate'] < 1.5) | (F['sustain'] > q('sustain', 65))),
    'rhythmic': (F['rhythm'] >= .45, F['rhythm'] < .35),
}
fit = lambda A, y: LogisticRegression(C=1.0, class_weight='balanced', max_iter=800, tol=1e-3).fit(A, y)
def threshold(t, p):
    best = None
    for th in np.unique(np.round(p, 3)):
        if th < .5: continue
        pr = p >= th; tp = (pr & t).sum()
        if tp: s = min(tp / pr.sum(), tp / t.sum()); best = max(best or (s, th), (s, float(th)))
    return best[1] if best else None
results = []
for name, (P, N) in DEF.items():
    use = P | N; pos = P
    groups = sorted(set(G[use & pos]), key=lambda g: hashlib.sha256(f'dsp|{name}|{g}'.encode()).hexdigest())
    held, n = set(), 0
    for g in groups:
        if n >= .25 * pos[use].sum(): break
        held.add(g); n += int((G[use & pos] == g).sum())
    test = use & np.isin(G, sorted(held)); train = use & ~test
    a = np.where(train)[0]; oof = np.full(len(a), np.nan)
    for x, y in GroupKFold(5).split(X[a], pos[a], G[a]): oof[y] = fit(X[a][x], pos[a][x]).predict_proba(X[a][y])[:, 1]
    th = threshold(pos[a], oof); m = fit(X[a], pos[a]); b = np.where(test)[0]
    pr = m.predict_proba(X[b])[:, 1] >= (th or 1.1); t = pos[b]
    tp, fp, fn = int((pr & t).sum()), int((pr & ~t).sum()), int((~pr & t).sum())
    Pp = tp / (tp + fp) if tp + fp else 0.0; R = tp / (tp + fn) if tp + fn else 0.0
    # Strict: every clip in the held-out groups counts, the in-between ones as negatives (what the app meets).
    s_ = np.isin(G, sorted(held)); ps = m.predict_proba(X[s_])[:, 1] >= (th or 1.1); ts = pos[s_]
    stp = int((ps & ts).sum()); sP = stp / ps.sum() if ps.sum() else 0.0; sR = stp / ts.sum() if ts.sum() else 0.0
    Pp, R = min(Pp, sP), min(R, sR)
    r = {'kind': 'label', 'name': name, 'testedOn': 'real recordings', 'definition': 'measured (see script)', 'trainPositive': int(pos[train].sum()),
         'testPositive': int(t.sum()), 'strict': {'precision': sP, 'recall': sR, 'clips': int(s_.sum())}, 'threshold': th, 'tp': tp, 'fp': fp, 'fn': fn, 'precision': Pp, 'recall': R,
         'passes': bool(Pp >= BAR and R >= BAR), 'verdict': 'PASS' if Pp >= BAR and R >= BAR else 'fails'}
    if r['passes'] and th:
        full = fit(X[np.where(use)[0]], pos[np.where(use)[0]])
        r['head'] = {'weights': [round(float(w), 6) for w in full.coef_[0]], 'bias': round(float(full.intercept_[0]), 6)}
    results.append(r); print(f"{name:<11} P{Pp:.2f} R{R:.2f} test+{int(t.sum())} train+{int(pos[train].sum())} th{th} {r['verdict']}")
json.dump({'kind': 'dsp-character-v1', 'bar': BAR, 'clips': len(rows), 'results': results}, open(OUT, 'w'), indent=1)
