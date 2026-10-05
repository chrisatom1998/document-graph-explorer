"""Measured character labels for real recordings, then CLAP heads that predict them.

Uploader tags for words like "bright" or "sustained" are unreliable, so these labels are defined by
measurement on the first 10 s of each real clip (tag-mined Freesound previews). Clips between the
cut-offs are left unknown (neither positive nor negative):
  bright / dark   energy-weighted median spectral centroid: top 20% / bottom 20% (negatives: below 50% / above 50%)
  sustained / percussive   share of 20 ms frames within 10 dB of the loudest frame: top 25% / bottom 25%
  pulsing         amplitude-envelope autocorrelation peak at 2-12 Hz >= 0.5 (negative < 0.2)
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
    return {'centroid': centroid, 'sustain': sustain, 'pulse': pulse, 'rhythm': rhythm}

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
G = np.array([c['group'] for c in rows]); F = {k: np.array([feat[c['id']][k] for c in rows]) for k in ('centroid', 'sustain', 'pulse', 'rhythm')}
q = lambda k, p: np.percentile(F[k], p)
DEF = {  # label: (positive mask, negative mask)
    'bright': (F['centroid'] >= q('centroid', 80), F['centroid'] < q('centroid', 70)),
    'dark': (F['centroid'] <= q('centroid', 20), F['centroid'] > q('centroid', 30)),
    'sustained': (F['sustain'] >= q('sustain', 75), F['sustain'] < q('sustain', 65)),
    'percussive': (F['sustain'] <= q('sustain', 25), F['sustain'] > q('sustain', 35)),
    'pulsing': (F['pulse'] >= .5, F['pulse'] < .4),
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
