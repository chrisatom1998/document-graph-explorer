"""Fit the genre head (on Discogs style scores) and the energy head (on the EffnetDiscogs embedding), then judge both.

Usage: python3 -I scripts/genre-energy/fit.py <features dir> <model.json out> <report.json out> [--judge]

Fitting reads only beatport-tune (genre) and jamendo-fit (energy). Thresholds come from cross-validation on those same
tuning sets. With --judge, the frozen heads are scored once on beatport-judge (rounds 1 and 2) and jamendo-judge.
Feature files: <set>.json.gz (or <set>.json), rows from scripts/genre-energy/features.mjs.
"""
import base64, gzip, hashlib, json, os, sys
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, GroupKFold

feat_dir, model_out, report_out = sys.argv[1:4]
JUDGE = '--judge' in sys.argv
BAR = 0.70
STYLES = json.load(open('public/jamendo-model/discogs-effnet-bsdynamic-1.json'))['classes']
# Beatport genres with enough tuning tracks to fit; the rest are never shown.
MIN_TUNE = 20

def load(name):
    for ext in ('.json.gz', '.json'):
        p = os.path.join(feat_dir, name + ext)
        if os.path.exists(p): return [r for r in json.load(gzip.open(p, 'rt') if ext.endswith('gz') else open(p)) if 'styles' in r]
    raise SystemExit(f'missing {name}')
bf16 = lambda s: (np.frombuffer(base64.b64decode(s), dtype=np.uint16).astype(np.uint32) << 16).view(np.float32)
def style_matrix(rows, key): return np.log(np.clip(np.array([r[key] for r in rows], dtype=np.float64), 1e-4, 1))
def prf(pred, truth):
    tp = int(np.sum(pred & truth)); fp = int(np.sum(pred & ~truth)); fn = int(np.sum(~pred & truth))
    return {'precision': round(tp / (tp + fp), 3) if tp + fp else None, 'recall': round(tp / (tp + fn), 3) if tp + fn else None, 'tp': tp, 'fp': fp, 'fn': fn}
passes = lambda m: m['precision'] is not None and m['recall'] is not None and m['precision'] >= BAR and m['recall'] >= BAR

report = {'bar': BAR}
# ---------- genre ----------
tune = load('beatport-tune')
counts = {}
for r in tune: counts[r['genre']] = counts.get(r['genre'], 0) + 1
classes = sorted(g for g, c in counts.items() if c >= MIN_TUNE)
tune = [r for r in tune if r['genre'] in classes]
y = np.array([classes.index(r['genre']) for r in tune])
X = style_matrix(tune, 'styles')
C = 0.01
stable = lambda v: int(hashlib.sha256(str(v).encode()).hexdigest()[:8], 16)
groups = np.array([stable(r.get('artist') or r['name']) for r in tune])
oof = np.zeros((len(tune), len(classes)))
for tr, te in GroupKFold(5).split(X, y, groups):
    m = LogisticRegression(C=C, max_iter=5000).fit(X[tr], y[tr]); oof[te] = m.predict_proba(X[te])
# Display rule: the most probable genre when its probability clears that genre's threshold, else the most probable
# family (summed member probabilities) when it clears the family's threshold, else nothing. Each threshold is the
# lowest whose cross-validated precision reaches the bar, or, when none does, the one with the best F1 (shown as maybe).
FAMILIES = {'house': ['house', 'deep-house', 'tech-house', 'progressive-house', 'electro-house'], 'techno': ['techno', 'minimal'],
            'trance': ['trance', 'psy-trance'], 'downtempo': ['chill-out', 'electronica']}
FAMILIES = {f: [m for m in ms if m in classes] for f, ms in FAMILIES.items()}
FAMILIES = {f: ms for f, ms in FAMILIES.items() if len(ms) > 1}
family_of = {m: f for f, ms in FAMILIES.items() for m in ms}
fam_names = sorted(FAMILIES)
def family_probs(P): return np.stack([P[:, [classes.index(m) for m in FAMILIES[f]]].sum(1) for f in fam_names], 1) if fam_names else np.zeros((len(P), 0))
def decide(P, th, fth):
    win = P.argmax(1); conf = P.max(1); F = family_probs(P)
    out = []
    for i in range(len(P)):
        g = classes[win[i]]
        if conf[i] >= th[g]: out.append(g); continue
        if fam_names:
            j = int(F[i].argmax()); f = fam_names[j]
            if F[i, j] >= fth[f]: out.append(f); continue
        out.append(None)
    return out
def label_stats(shown, truth, label):
    """Precision of a shown label; recall over the tracks it covers (a family also counts its members shown)."""
    members = FAMILIES.get(label, [label])
    covered = {label, *members} if label in FAMILIES else {label}
    t = np.array([g in members for g in truth]); s = np.array([x == label for x in shown]); c = np.array([x in covered for x in shown])
    tp_p = int((s & t).sum()); tp_r = int((c & t).sum())
    return {'precision': round(tp_p / s.sum(), 3) if s.sum() else None, 'recall': round(tp_r / t.sum(), 3) if t.sum() else None, 'shown': int(s.sum()), 'tracks': int(t.sum())}
f1 = lambda m: 2 * (m['precision'] or 0) * (m['recall'] or 0) / max(1e-9, (m['precision'] or 0) + (m['recall'] or 0))
grid = [round(float(t), 2) for t in np.arange(0.2, 0.92, 0.02)]
truth_tune = [r['genre'] for r in tune]
NEVER = 2.0
MIN_RECALL = 0.3
thresholds = {g: NEVER for g in classes}; fam_thresholds = {f: NEVER for f in fam_names}
for g in classes:
    stats = []
    for t in grid:
        th = {**thresholds, g: t}; stats.append((t, label_stats(decide(oof, th, fam_thresholds), truth_tune, g)))
    ok = [(t, m) for t, m in stats if (m['precision'] or 0) >= BAR]
    # A family member is named on its own only when that reaches the bar with useful recall; otherwise its tracks
    # fall through to the family label instead of a rarely shown, noisy subgenre.
    if g in family_of: thresholds[g] = ok[0][0] if ok and (ok[0][1]['recall'] or 0) >= MIN_RECALL else NEVER
    else: thresholds[g] = ok[0][0] if ok else max(stats, key=lambda tm: f1(tm[1]))[0]
for f in fam_names:
    stats = []
    for t in grid:
        fth = {**fam_thresholds, f: t}; stats.append((t, label_stats(decide(oof, thresholds, fth), truth_tune, f)))
    ok = [t for t, m in stats if (m['precision'] or 0) >= BAR]
    fam_thresholds[f] = ok[0] if ok else max(stats, key=lambda tm: f1(tm[1]))[0]
shown_cv = decide(oof, thresholds, fam_thresholds)
cv = {l: label_stats(shown_cv, truth_tune, l) for l in classes + fam_names}
report['genre_cv'] = {'classes': classes, 'families': FAMILIES, 'C': C, 'per_label': cv, 'accuracy_top1': round(float(np.mean(oof.argmax(1) == y)), 3),
                      'thresholds': thresholds, 'family_thresholds': fam_thresholds}
genre = LogisticRegression(C=C, max_iter=5000).fit(X, y)

# ---------- energy ----------
fit = load('jamendo-fit')
E = np.array([bf16(r['embedding']) for r in fit], dtype=np.float64)
ye = np.array([r['energy'] == 'high' for r in fit])
mu, sd = E.mean(0), E.std(0) + 1e-6
Z = (E - mu) / sd
CE = 0.01
eoof = np.zeros(len(fit))
egroups = np.array([stable(r['artist']) for r in fit])
for tr, te in GroupKFold(5).split(Z, ye, egroups):
    eoof[te] = LogisticRegression(C=CE, max_iter=5000).fit(Z[tr], ye[tr]).predict_proba(Z[te])[:, 1]
def pick(scores, truth, high):
    best = None
    for t in np.arange(0.05, 0.96, 0.01):
        m = prf(scores >= t, truth) if high else prf(scores <= t, truth)
        p, rc = m['precision'] or 0, m['recall'] or 0
        f1 = 2 * p * rc / max(1e-9, p + rc)
        # Among thresholds that pass the bar with recall to spare (>= 0.75), take the most precise one, so unsure
        # tracks fall in the medium band instead of being forced to high or low; otherwise the best F1.
        ok = min(p, rc) >= BAR and rc >= 0.75
        key = (ok, p if ok else f1)
        if best is None or key > best[0]: best = (key, round(float(t), 2), m)
    return best[1], best[2]
hi_t, hi_m = pick(eoof, ye, True); lo_t, lo_m = pick(eoof, ~ye, False)
if lo_t >= hi_t: lo_t = hi_t - 0.01
report['energy_cv'] = {'C': CE, 'high': {'threshold': hi_t, **hi_m}, 'low': {'threshold': lo_t, **lo_m}}
energy = LogisticRegression(C=CE, max_iter=5000).fit(Z, ye)
w = energy.coef_[0] / sd; b = float(energy.intercept_[0] - np.sum(energy.coef_[0] * mu / sd))

# Loudness-only baseline for comparison (not shipped).
L = np.array([[r['rmsDb'], r['rmsDbSpread']] for r in fit])
loof = np.zeros(len(fit))
for tr, te in GroupKFold(5).split(L, ye, egroups): loof[te] = LogisticRegression().fit(L[tr], ye[tr]).predict_proba(L[te])[:, 1]
report['energy_cv_loudness_only'] = {'high': pick(loof, ye, True)[1], 'low': pick(loof, ~ye, False)[1]}
if 'mtg_jamendo_moodtheme' in fit[0]:
    mood = json.load(open(os.environ.get('MOOD_JSON', '/tmp/claude-0/heads/mtg_jamendo_moodtheme-discogs-effnet-1.json')))['classes']
    hi = [mood.index(t) for t in ('energetic', 'powerful', 'fast', 'upbeat', 'party', 'sport', 'action', 'heavy')]
    lo = [mood.index(t) for t in ('calm', 'relaxing', 'meditative', 'soft', 'slow')]
    M = np.array([r['mtg_jamendo_moodtheme'] for r in fit])
    d = M[:, hi].sum(1) - M[:, lo].sum(1)
    s = (d - d.min()) / (d.max() - d.min())
    report['energy_cv_official_mood_head'] = {'high': pick(s, ye, True)[1], 'low': pick(s, ~ye, False)[1], 'note': 'in-sample thresholds; the head was trained on split-0 train'}

model = {
    'version': 'genre-energy-v1',
    'genre': {'feature': 'log-clip-1e-4', 'styles': STYLES, 'classes': classes, 'bias': [round(float(v), 5) for v in genre.intercept_],
              'weights': [[round(float(v), 5) for v in row] for row in genre.coef_], 'thresholds': [thresholds[g] for g in classes],
              'tested': [False] * len(classes), 'families': [{'label': f, 'members': FAMILIES[f], 'threshold': fam_thresholds[f], 'tested': False} for f in fam_names],
              'keptStyles': 8},
    'energy': {'weights': [round(float(v), 6) for v in w], 'bias': round(b, 6), 'low': lo_t, 'high': hi_t, 'tested': {'low': False, 'high': False}},
}

# ---------- judge ----------
if JUDGE:
    out = {}
    judge = load('beatport-judge')
    truth = [r['genre'] for r in judge]
    for key, label in (('styles', 'full'), ('stylesFast', 'fast')):
        shown = decide(genre.predict_proba(style_matrix(judge, key)), thresholds, fam_thresholds)
        per = {l: label_stats(shown, truth, l) for l in classes + fam_names}
        exact = sum(1 for s_, t in zip(shown, truth) if s_ == t); right_family = sum(1 for s_, t in zip(shown, truth) if s_ and s_ in FAMILIES and t in FAMILIES[s_])
        out[f'genre_{label}'] = {'tracks': len(judge), 'shown': sum(1 for s_ in shown if s_), 'shown_exact': exact, 'shown_family_correct': right_family,
                                 'per_label': per, 'unknown_genre_tracks': int(sum(t not in classes for t in truth))}
    jj = load('jamendo-judge')
    for key, label in (('embedding', 'full'), ('embeddingFast', 'fast')):
        s = 1 / (1 + np.exp(-(np.array([bf16(r[key]) for r in jj], dtype=np.float64) @ w + b)))
        t = np.array([r['energy'] == 'high' for r in jj])
        out[f'energy_{label}'] = {'tracks': len(jj), 'high': prf(s >= hi_t, t), 'low': prf(s <= lo_t, ~t), 'medium': int(np.sum((s > lo_t) & (s < hi_t)))}
    # Energy on Beatport, by genre (no labels; sanity check only).
    s = 1 / (1 + np.exp(-(np.array([bf16(r['embedding']) for r in judge], dtype=np.float64) @ w + b)))
    by = {}
    for r, v in zip(judge, s): by.setdefault(r['genre'], []).append(v)
    out['energy_beatport_by_genre'] = {g: {'n': len(v), 'mean': round(float(np.mean(v)), 3), 'high': round(float(np.mean(np.array(v) >= hi_t)), 3), 'low': round(float(np.mean(np.array(v) <= lo_t)), 3)} for g, v in sorted(by.items()) if len(v) >= 8}
    report['judge'] = out
    g = out['genre_full']['per_label']
    model['genre']['tested'] = [passes(g[c]) for c in classes]
    for f in model['genre']['families']: f['tested'] = passes(g[f['label']])
    model['energy']['tested'] = {'high': passes(out['energy_full']['high']), 'low': passes(out['energy_full']['low'])}
json.dump(model, open(model_out, 'w'), separators=(',', ':'))
json.dump(report, open(report_out, 'w'), indent=1)
print(json.dumps({k: v for k, v in report.items()}, indent=1)[:6000])
