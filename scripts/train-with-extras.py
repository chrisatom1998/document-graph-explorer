"""One round of "add a dataset, keep it only if it helps".

The yardstick never changes: for each sound, a fixed set of sample-pack brands from the
user's library is held out (same choice every round) and the head is scored only on them.
Extra datasets are added to TRAINING ONLY, so any gain is a gain on unseen brands.
Sounds the library cannot test (too few held-out examples) are scored on held-out groups
of the extra data instead, and reported separately as new coverage.

MIXTEST=manifest.json@dir also scores each sound on held-out layered mixtures (build-mixtures.py), split by
target level; EXCLUDE=manifest.json drops that manifest's `excludeIds` (the mixture-test targets) from every
extra dataset, so no test sound is heard in training. Use both in every round being compared.
Usage: train-with-extras.py <out.json> [name=manifest.json@fingerprint_dir ...]
Every manifest clip needs: id, labels (app label names), group (independence unit); `testOnly: true` rows are scored, never trained.
Fair-fit options (docs/evaluations/rwc-woodwind-heads-2026-10-30): DEDUP=1 drops a test clip's cross-source Freesound twin from
training; HALF_TEST=<group prefix> holds out half of that source's groups (sha256) as a second judge; SAVE_DIR=dir writes the
weights fit on training rows only (the ones that were scored); SHIPPED=learned.json also scores the shipped head on the same rows."""
import functools; print = functools.partial(print, flush=True)
import json, sys, glob, hashlib, os, datetime, re
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from joblib import Parallel, delayed
import importlib.util
_spec = importlib.util.spec_from_file_location('labeler', 'scripts/label-sample-library.py')
labeler = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(labeler)

FP = os.environ.get('FP', '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints')
OUT = sys.argv[1]; EXTRAS = [a.split('=', 1) for a in sys.argv[2:]]
BAR, MIN_TEST = float(os.environ.get("BAR", 0.65)), int(os.environ.get("MIN_TEST", 15))
catalog = {c['label']: c for c in json.load(open('src/audio/djCatalog.json'))['categories']}
FAMILY = {'drum-hit': 'drum hit', 'drum-pattern': 'drum loop', 'vocal': 'vocal', 'editing': 'vocal', 'breath': 'vocal',
          'transition': 'fx', 'bass': 'bass', 'synth': 'synth', 'texture': 'texture'}

EXCLUDED = set(json.load(open(os.environ['EXCLUDE']))['excludeIds']) if os.environ.get('EXCLUDE') else set()
# EXCL_TRAIN=ids.json: ids that may be scored but never trained on (held-out / judge lists).
EXCL_TRAIN = set(json.load(open(os.environ['EXCL_TRAIN']))['excludeIds']) if os.environ.get('EXCL_TRAIN') else set()
# Frozen test sets: their recordings and whole families (uploaders, NSynth instruments) never reach training.
RES_IDS, RES_FAMILIES = set(), set()
for _f in ('docs/evaluations/short-clips-2026-10-04/reserved-test-families.json', 'docs/evaluations/synth-clips-2026-10-05/reserved-test-families.json'):
    if os.path.exists(_f):
        _d = json.load(open(_f)); RES_IDS |= set(map(str, _d.get('freesoundIds', [])))
        for _k in ('freesoundUploaders', 'fsdUploaders', 'nsynthInstruments', 'nsynthTestInstruments', 'avpParticipants'):
            RES_FAMILIES |= {str(u).split(':', 1)[-1] for u in _d.get(_k, [])}
def reserved(c):
    if c['id'].startswith(('vault:', 'proc:', 'surge', 'slakh', 'mix')): return False
    tail = c['id'].rsplit(':', 1)[-1]
    family = str(c.get('group') or c.get('vendor') or '').split(':', 1)[-1]
    return tail in RES_IDS or family in RES_FAMILIES
def load(manifest, folder, source):
    meta = {c['id']: c for c in json.load(open(manifest))['clips'] if source == 'vault' or (c['id'] not in EXCLUDED and not reserved(c))}; got = {}
    for f in sorted(glob.glob(f'{folder}/emb-*.jsonl')):
        for line in open(f):
            r = json.loads(line)
            if r['id'] in meta and r['id'] not in got: got[r['id']] = r['embedding']
    rows = [meta[i] for i in got]
    EXCL_TRAIN.update(r['id'] for r in rows if r.get('testOnly'))   # cleaned manifests: held-out/judge rows may be scored, never trained
    X = np.asarray([got[r['id']] for r in rows], dtype=np.float32); X /= np.linalg.norm(X, axis=1, keepdims=True)
    labels = [set(r['labels'] if 'labels' in r else [r['label']]) for r in rows]
    if source == 'vault':   # re-check library labels so song titles no longer count as sounds
        labels = [l & set(labeler.match(r['id'][len('vault:'):])) for l, r in zip(labels, rows)]
    groups = np.array([f"{source}:{r.get('vendor') or r.get('group')}" for r in rows])
    return X, labels, groups, [r['id'] for r in rows], rows

VX, VL, VG, VI, _ = load(f'{FP}/vault-clap/manifest.json', f'{FP}/vault-clap', 'vault')
parts = [(VX, VL, VG, np.ones(len(VL), bool), VI)]
for name, spec in EXTRAS:
    man, folder = spec.split('@'); X, L, G, I, _ = load(man, folder, name)
    parts.append((X, L, G, np.zeros(len(L), bool), I)); print(f'+ {name}: {len(L)} clips')
SRC = np.concatenate([np.full(len(p[1]), i) for i, p in enumerate(parts)])   # 0 = library, 1.. = extras in order
X = np.vstack([p[0] for p in parts]); LAB = sum((p[1] for p in parts), []); IDS = sum((p[4] for p in parts), []); G = np.concatenate([p[2] for p in parts])
IS_VAULT = np.concatenate([p[3] for p in parts])
# Real recordings with human labels: the only fair test for instruments (rendered stems are not).
REAL = tuple(n for n in ('fsd50k:', 'fsl10k:', 'fsm:') if any(i.startswith(n) for i in IDS))
# Real (not rendered or edited) audio from other extras; usable for label tests, not for instrument tests.
REAL_LABEL = REAL + tuple(n for n in ('fs:', 'ep:', 'hh:', 'fsperc:') if any(i.startswith(n) for i in IDS))
FAM = np.array([(lambda f: f.pop() if len(f) == 1 else None)({FAMILY.get(catalog.get(l, {}).get('family')) for l in s} - {None}) for s in LAB], dtype=object)
FSTAIL = np.array([i.rsplit(':', 1)[-1] if i.startswith(('fsd50k:', 'fsm:', 'fsl10k:', 'fsperc:', 'fs:', 'fslbb:')) else '' for i in IDS])
EXMASK = np.array([i in EXCL_TRAIN for i in IDS]); print(f'train-excluded ids present: {int(EXMASK.sum())}')
print(f'total {len(LAB)} clips ({IS_VAULT.sum()} library, {(~IS_VAULT).sum()} extra)')
if os.environ.get('MIXTEST'):
    MX, ML, _, _, MROWS = load(*os.environ['MIXTEST'].split('@'), 'mixtest'); MLEVEL = np.array([r['levelDb'] for r in MROWS])
    print(f'mixture test: {len(ML)} held-out mixes')

OVERLAP = [{'chops', 'vocal chops'}, {'riser', 'noise sweep', 'whoosh'}, {'impact', 'sub drop', 'downlifter'},
           {'808 bass', 'sub bass'}, {'reese bass', 'wobble bass', 'bass growl', 'synth bass'}, {'synth chord', 'atmospheric pad', 'synth stab'},
           {'synth lead', 'synth arpeggio', 'synth pluck', 'synth chord', 'synth stab'},
           {'texture', 'atmospheric pad', 'static noise', 'rain ambience', 'noise sweep'}, {'static noise', 'noise sweep'},
           {'glitch effect', 'stutter effect', 'reverse effect'}, {'crash cymbal', 'ride cymbal', 'closed hi-hat', 'open hi-hat'},
           # character words people use loosely for the same sound: never negatives for each other
           {'saturated', 'distorted', 'gritty', 'bitcrushed', 'warm'}, {'chorused', 'flanged', 'wobbling'}, {'rising', 'swelling', 'gliding'},
           {'falling', 'gliding'}, {'dark', 'filtered', 'warm', 'smooth', 'hollow'}, {'bright', 'airy', 'glassy', 'metallic'},
           {'pulsing', 'rhythmic', 'syncopated', 'rolling', 'wobbling'}, {'percussive', 'staccato', 'plucked'}, {'echoing', 'reverberant'},
           {'sustained', 'swelling', 'smooth'}, {'vocal breath', 'breath'}, {'vocal phrase', 'spoken phrase', 'vocal chops', 'chops'},
           {'vocal pad', 'vocal harmony', 'atmospheric pad'}, {'acid bass', 'acid synth', 'synth bass'}, {'bass pluck', 'synth pluck', 'synth bass'},
           {'reese bass', 'supersaw'}, {'riser', 'swelling', 'rising'}, {'downlifter', 'falling'}]
def compatible(a, b):
    if a == b: return True
    fa, fb = catalog.get(a, {}).get('family'), catalog.get(b, {}).get('family')
    if {fa, fb} <= {'drum-hit', 'drum-pattern'} and 'drum-pattern' in {fa, fb}: return True
    if 'percussion hit' in {a, b} and {fa, fb} == {'drum-hit'}: return True
    if {fa, fb} <= {'vocal', 'editing'} and 'vocal' in {fa, fb}: return True
    return any(a in s and b in s for s in OVERLAP)

def held_out(name, groups, pos):
    """Same deterministic choice every round: about a quarter of positives, by whole group."""
    counts = {}
    for g in groups[pos]: counts[g] = counts.get(g, 0) + 1
    order = sorted(counts, key=lambda g: hashlib.sha256(f'{name}|{g}'.encode()).hexdigest())
    chosen, n, total = set(), 0, sum(counts.values())
    for g in order:
        if len(chosen) >= len(order) - 3 or n >= 0.25 * total: break
        if n + counts[g] > 0.5 * total: continue
        chosen.add(g); n += counts[g]
    return chosen

# EXPORT=0.5 also refits and saves weights for results at or above that bar; ONLY=kind:name,... limits the run.
EXPORT = float(os.environ['EXPORT']) if os.environ.get('EXPORT') else None
ONLY = set(filter(None, os.environ.get('ONLY', '').split(',')))
fit = lambda A, y, C=1.0: LogisticRegression(C=C, class_weight='balanced', max_iter=600, tol=1e-3).fit(A, y)
def threshold(t, p):
    best = None
    for th in np.unique(np.round(p, 3)):
        if th < 0.5: continue
        pr = p >= th; tp = (pr & t).sum()
        if not tp: continue
        s = min(tp / pr.sum(), tp / t.sum())
        if best is None or s > best[0]: best = (s, float(th))
    return best[1] if best else None

def run(kind, name):
    if kind == 'family':
        use = FAM != None; pos = FAM == name                                      # noqa: E711
    elif kind == 'instrument':
        # Only sources that name every clip's instrument can say a clip is NOT this instrument.
        pos = np.array([name in s for s in INST]); use = INST_KNOWN & (pos | ~np.array([any(compatible_inst(name, o) for o in s) for s in INST]))
    else:
        pos = np.array([name in s for s in LAB]); use = pos | np.array([not any(compatible(name, o) for o in s) for s in LAB])
    # Prefer the fixed library yardstick; fall back to held-out extra groups for new coverage.
    library_test = held_out(f'{kind}:{name}', G[IS_VAULT & use], pos[IS_VAULT & use])
    test = use & IS_VAULT & np.isin(G, sorted(library_test)); where = 'library brands'
    if pos[test].sum() < MIN_TEST:
        # Instruments fall back to real recordings (FSD50K) when present, never to rendered stems.
        real = np.isin([i.split(':')[0] + ':' for i in IDS], REAL)
        pool = ~IS_VAULT & (real if kind == 'instrument' and REAL.__len__() else True)
        extra_test = held_out(f'{kind}:{name}:extra', G[pool & use], pos[pool & use])
        test = use & pool & np.isin(G, sorted(extra_test)); where = 'real recordings' if kind == 'instrument' and REAL else 'extra sources'
        if kind == 'label' and REAL_LABEL:
            real = np.isin([i.split(':')[0] + ':' for i in IDS], REAL_LABEL)
            # Renders and edited clips are easy to tell apart from their dry versions; prefer a test on
            # real recordings (FSD50K, FSL10K, tag-mined Freesound) whenever it has enough positives.
            real_pool = ~IS_VAULT & real
            real_test = held_out(f'{kind}:{name}:real', G[real_pool & use], pos[real_pool & use])
            t2 = use & real_pool & np.isin(G, sorted(real_test))
            if pos[t2].sum() >= MIN_TEST: test, where = t2, 'real recordings'
    if os.environ.get('PREFER_LARGER_TEST') == '1' and kind == 'label' and where == 'library brands' and REAL_LABEL:
        # Use the larger of the two honest yardsticks (library brands vs held-out real recordings).
        real = np.isin([i.split(':')[0] + ':' for i in IDS], REAL_LABEL); real_pool = ~IS_VAULT & real
        t2 = use & real_pool & np.isin(G, sorted(held_out(f'{kind}:{name}:real', G[real_pool & use], pos[real_pool & use])))
        if pos[t2].sum() > pos[test].sum() and pos[t2].sum() >= MIN_TEST: test, where = t2, 'real recordings'
    train = use & ~test & (IS_VAULT | (pos | ~IS_VAULT))
    if EXCL_TRAIN: train &= ~EXMASK
    # Cross-source duplicates: the same Freesound recording under two sources (fsm:X and fsd50k:X) has two
    # different group names, so a by-group test does not keep its twin out of training.
    _tt = set(FSTAIL[test]) - {''}; _dup = train & np.isin(FSTAIL, sorted(_tt)) if _tt else np.zeros(len(train), bool)
    dup_n = int((_dup & pos).sum()), int(_dup.sum())
    if os.environ.get('DEDUP') == '1': train &= ~_dup
    half = np.zeros(len(train), bool)
    if os.environ.get('HALF_TEST'):   # new held-out half of a dataset, by whole group (player)
        _pre = os.environ['HALF_TEST']
        half = use & np.array([g is not None and str(g).startswith(_pre) and int(hashlib.sha256(('half|'+str(g)).encode()).hexdigest()[:8],16) % 2 == 0 for g in G])
        train &= ~half
    r = {'testTwinsInTrain': {'positive': dup_n[0], 'all': dup_n[1]}, 'kind': kind, 'name': name, 'testedOn': where, 'trainPositive': int(pos[train].sum()), 'testPositive': int(pos[test].sum())}
    if pos[test].sum() < MIN_TEST or pos[train].sum() < 30 or len(set(G[train & pos])) < 3: return {**r, 'verdict': 'not enough data'}
    def oof_for(rows, C=1.0):
        oof = np.full(len(rows), np.nan)
        for x, y in GroupKFold(n_splits=5).split(X[rows], pos[rows], G[rows]):
            if pos[rows][x].any() and (~pos[rows][x]).any(): oof[y] = fit(X[rows][x], pos[rows][x], C).predict_proba(X[rows][y])[:, 1]
        return oof
    # Each sound picks the extra datasets that help IT, judged only on its training-side library
    # brands (5-fold, by brand). The held-out test brands play no part in the choice.
    chosen = [i for i in range(1, len(parts)) if pos[train & (SRC == i)].any()]
    if os.environ.get('SELECT') == '1' and where == 'library brands' and chosen:
        lib = np.where(train & IS_VAULT)[0]
        def score(subset):
            ext = np.where(train & np.isin(SRC, subset))[0]
            rows = np.concatenate([lib, ext]); oof = oof_for(rows)[:len(lib)]; ok = ~np.isnan(oof)
            th = threshold(pos[lib][ok], oof[ok]);
            if th is None: return -1.0
            pr = oof[ok] >= th; t = pos[lib][ok]; tp = (pr & t).sum()
            return 2 * tp / (pr.sum() + t.sum()) if tp else 0.0
        cur, best = [], score([])
        for i in chosen:                                 # greedy: keep a dataset only if it helps this sound
            v = score(cur + [i])
            if v > best + 0.005: cur, best = cur + [i], v
        chosen = cur
    a = np.where(train & (IS_VAULT | np.isin(SRC, chosen)))[0]
    C = 1.0; oof = oof_for(a); ok = ~np.isnan(oof)
    if os.environ.get('C_GRID'):
        # Model strength per label, chosen ONLY on training-side out-of-fold rows that look like the test
        # (library or real recordings); the held-out test plays no part.
        like = IS_VAULT[a] | np.isin([i.split(':')[0] + ':' for i in np.array(IDS, dtype=object)[a]], REAL_LABEL or ('',))
        def oof_score(o):
            k = ~np.isnan(o) & like
            if (pos[a] & k).sum() < 10: k = ~np.isnan(o)
            t_ = threshold(pos[a][k], o[k])
            if t_ is None: return -1.0
            pr_ = o[k] >= t_; tp_ = (pr_ & pos[a][k]).sum()
            return min(tp_ / max(pr_.sum(), 1), tp_ / pos[a][k].sum())
        best = (oof_score(oof), 1.0, oof)
        for c in map(float, os.environ['C_GRID'].split(',')):
            if c == 1.0: continue
            o = oof_for(a, c); v = oof_score(o)
            if v > best[0] + 0.01: best = (v, c, o)
        _, C, oof = best; ok = ~np.isnan(oof); r['C'] = C
    th = threshold(pos[a][ok], oof[ok])
    if th is None: return {**r, 'verdict': 'no usable threshold'}
    model = fit(X[a], pos[a], C)
    b = np.where(test)[0]; pr = model.predict_proba(X[b])[:, 1] >= th; t = pos[b]
    if os.environ.get('SAVE_DIR'):   # weights fit on training rows only (no test, test-only, judge or held-out rows); never the app
        json.dump({'kind': kind, 'label': name, 'weights': [round(float(w), 6) for w in model.coef_[0]], 'bias': round(float(model.intercept_[0]), 6),
                   'threshold': th, 'C': C, 'trainRows': int(len(a)), 'trainPositive': int(pos[a].sum()), 'uses': [EXTRAS[i - 1][0] for i in chosen],
                   'fitOn': 'training rows only; test rows, their cross-source twins, testOnly rows and HALF_TEST rows excluded',
                   'note': 'candidate; the app only changes when a PR copies it into learned.json'},
                  open(os.path.join(os.environ['SAVE_DIR'], name.replace(' ', '-').replace('/', '-') + '.json'), 'w'))
    if os.environ.get('SHIPPED'):   # the shipped head's own weights and threshold, on this exact test set
        _sh = {h['label']: h for h in json.load(open(os.environ['SHIPPED']))['heads']}.get(name)
        if _sh:
            _p = 1 / (1 + np.exp(-(X[b] @ np.asarray(_sh['weights'], np.float32) + _sh['bias']))) >= _sh['threshold']
            _tp, _fp = int((_p & t).sum()), int((_p & ~t).sum())
            r['shipped'] = {'precision': _tp / (_tp + _fp) if _tp + _fp else 0.0, 'recall': _tp / t.sum(), 'tp': _tp, 'fp': _fp}
            if half.any():
                _q = 1 / (1 + np.exp(-(X[half] @ np.asarray(_sh['weights'], np.float32) + _sh['bias']))) >= _sh['threshold']; _t = pos[half]
                _tp, _fp, _fn = int((_q & _t).sum()), int((_q & ~_t).sum()), int((~_q & _t).sum())
                r['shipped']['halfTest'] = {'tp': _tp, 'fp': _fp, 'fn': _fn, 'precision': _tp / (_tp + _fp) if _tp + _fp else 0.0, 'recall': _tp / (_tp + _fn) if _tp + _fn else 0.0}
    tp, fp, fn = int((pr & t).sum()), int((pr & ~t).sum()), int((~pr & t).sum())
    P = tp / (tp + fp) if tp + fp else 0.0; R = tp / (tp + fn)
    if half.any():
        hb = np.where(half)[0]; hp = model.predict_proba(X[hb])[:, 1] >= th; ht = pos[hb]
        htp, hfp, hfn = int((hp & ht).sum()), int((hp & ~ht).sum()), int((~hp & ht).sum())
        r['halfTest'] = {'prefix': _pre, 'testPositive': int(ht.sum()), 'negatives': int((~ht).sum()), 'tp': htp, 'fp': hfp, 'fn': hfn,
                         'precision': htp / (htp + hfp) if htp + hfp else 0.0, 'recall': htp / (htp + hfn) if htp + hfn else 0.0}
    if EXPORT is not None and min(P, R) >= EXPORT:      # refit on every row it may use, same threshold
        m = fit(X[np.where(use & (IS_VAULT | np.isin(SRC, chosen)))[0]], pos[np.where(use & (IS_VAULT | np.isin(SRC, chosen)))[0]], C)
        r['head'] = {'weights': [round(float(w), 6) for w in m.coef_[0]], 'bias': round(float(m.intercept_[0]), 6)}
    if kind == 'label' and os.environ.get('MIXTEST'):
        # Same head and threshold, scored on sounds layered under held-out drum kits.
        mpos = np.array([name in s for s in ML]); muse = mpos | np.array([not any(compatible(name, o) for o in s) for s in ML])
        if mpos[muse].sum() >= MIN_TEST:
            mp = model.predict_proba(MX)[:, 1] >= th
            def score(rows):
                t_, p_ = mpos[rows], mp[rows]; tp_ = int((p_ & t_).sum()); fp_ = int((p_ & ~t_).sum())
                return {'positive': int(t_.sum()), 'tp': tp_, 'fp': fp_, 'precision': tp_ / (tp_ + fp_) if tp_ + fp_ else 0.0, 'recall': tp_ / t_.sum() if t_.sum() else 0.0}
            r['mixture'] = {**score(muse), 'buried': score(muse & (MLEVEL < -3)), 'onTop': score(muse & (MLEVEL >= -3))}
    return {**r, 'uses': [EXTRAS[i - 1][0] for i in chosen], 'threshold': th, 'tp': tp, 'fp': fp, 'fn': fn, 'precision': P, 'recall': R,
            'f1': 2*P*R/(P+R) if P+R else 0.0, 'passes': bool(P >= BAR and R >= BAR), 'verdict': 'PASS' if P >= BAR and R >= BAR else 'fails'}

prod = sorted({l for s in LAB for l in s if catalog.get(l, {}).get('group') in ('production', 'character')})
# Instrument labels for every clip whose instrument is known. Instrument datasets name it outright;
# elsewhere drums and synth families imply drums and synthesizer, vocal/FX/texture clips contain no
# instrument, a library file name can name one ("Rhodes Chords"), and anything else stays unknown.
INST_WORDS = {'piano': r'piano', 'electric piano': r'rhodes|wurli\w*|electric piano|e piano|epiano', 'organ': r'organ',
              'acoustic guitar': r'acoustic guitar|nylon guitar', 'electric guitar': r'electric guitar|elec guitar',
              'bass guitar': r'bass guitar|electric bass|slap bass|finger bass', 'strings': r'strings|violin|cello|viola',
              'flute': r'flute', 'saxophone': r'sax|saxophone', 'trumpet': r'trumpet', 'trombone': r'trombone', 'clarinet': r'clarinet',
              'mallet instrument': r'marimba|xylophone|vibraphone|glockenspiel|mallets?'}
INST_RE = {k: re.compile(r'(?<![a-z])(' + v + r')(?![a-z])') for k, v in INST_WORDS.items()}
def instruments(i):
    named = {l for l in LAB[i] if catalog.get(l, {}).get('group') == 'source'}
    if named or IDS[i].startswith('fsd50k:'): return named, True     # FSD50K lists every class heard
    if IS_VAULT[i]:
        text = labeler.label_text(IDS[i][len('vault:'):]); said = {k for k, r in INST_RE.items() if r.search(text)}
        if said: return said, True
        if re.search(r'(?<![a-z])(guitar|gtr|keys|brass|horns?|woodwinds?)(?![a-z])', text): return set(), False
    fam = FAM[i]
    if fam in ('drum hit', 'drum loop'): return {'drums'}, True
    if fam == 'synth': return {'synthesizer'}, True
    if fam in ('vocal', 'fx', 'texture'): return set(), True
    return set(), False
INST, INST_KNOWN = zip(*[instruments(i) for i in range(len(LAB))]); INST_KNOWN = np.array(INST_KNOWN)
PARENT = {'electric piano': 'piano', 'acoustic guitar': 'electric guitar'}   # close enough that neither is evidence against the other
compatible_inst = lambda a, b: a == b or PARENT.get(a) == b or PARENT.get(b) == a
inst = sorted({l for s in INST for l in s if sum(l in t for t in INST) >= 30})
jobs = [('family', f) for f in sorted(set(FAMILY.values()))] + [('label', l) for l in prod] + [('instrument', l) for l in inst]
if ONLY: jobs = [j for j in jobs if f'{j[0]}:{j[1]}' in ONLY]
if os.environ.get('LIBRARY_CHECK') == '1':
    # Real-sample check for instruments: train on half the library brands plus every extra
    # source, score the other half, then swap. Only clips whose instrument is known are scored.
    half = np.array([int(hashlib.sha256(g.encode()).hexdigest(), 16) % 2 for g in G])
    for name in inst:
        pos = np.array([name in s for s in INST]); use = INST_KNOWN & (pos | ~np.array([any(compatible_inst(name, o) for o in s) for s in INST]))
        tp = fp = fn = 0
        for h in (0, 1):
            tr = use & ~(IS_VAULT & (half == h)); te = use & IS_VAULT & (half == h)
            if not pos[tr].any() or not pos[te].any(): continue
            a = np.where(tr)[0]; oof = np.full(len(a), np.nan)
            for x, y in GroupKFold(n_splits=5).split(X[a], pos[a], G[a]):
                if pos[a][x].any(): oof[y] = fit(X[a][x], pos[a][x]).predict_proba(X[a][y])[:, 1]
            ok = ~np.isnan(oof); th = threshold(pos[a][ok], oof[ok])
            if th is None: continue
            pr = fit(X[a], pos[a]).predict_proba(X[te])[:, 1] >= th; t = pos[te]
            tp += int((pr & t).sum()); fp += int((pr & ~t).sum()); fn += int((~pr & t).sum())
        P = tp / (tp + fp) if tp + fp else 0; R = tp / (tp + fn) if tp + fn else 0
        print(f"  {name:<18} real samples: {tp + fn:>5} positive   right-when-yes {P:>4.0%}   finds {R:>4.0%}   {'PASS' if P >= BAR and R >= BAR else 'fails'}")
    sys.exit()
res = Parallel(n_jobs=int(os.environ.get('JOBS', '12')))(delayed(run)(k, n) for k, n in jobs)
json.dump({'kind': 'extras-round-v1', 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'bar': BAR,
           'extras': [n for n, _ in EXTRAS], 'results': res}, open(OUT, 'w'), indent=1)
ok = [r for r in res if 'precision' in r]
print(f"passing {BAR:.0%}: {sum(r['passes'] for r in ok)} of {len(ok)} testable   (families {sum(r['passes'] for r in ok if r['kind']=='family')}, sounds {sum(r['passes'] for r in ok if r['kind']=='label')})   mean F1 {np.mean([r['f1'] for r in ok]):.3f}")
