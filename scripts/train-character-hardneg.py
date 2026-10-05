"""Compares three ways to pick "not this effect" examples for the distorted and reverberant heads.

  baseline  the current setup: every cleaned Freesound sound-type clip is a negative
  cleaned   drops negatives whose uploader tags or name say they have the effect (distorted 808s, cave pads)
  hard      cleaned + near-miss negatives: Surge synth presets without the effect in their name
            (buzzy leads and basses for distorted) and the IDMT/EGFx dry and modulation-effect takes
  paired    hard + the IDMT/EGFx takes WITH the effect as positives, so the same guitar and bass notes
            appear both with and without it (scored too on held-out effect takes: effect recall)
  rendered  cleaned + electronic sounds rendered dry and with each effect (build-effect-renders.py), so the
            same synth or drum-machine part appears with and without it (scored too on held-out renders)
  rendered+hard  both of the above

All three are scored on the same test: Freesound uploaders held out on BOTH sides (the old test
held out only positive uploaders, so distorted had 0 test negatives), plus held-out Surge presets and
effect-set recordings counted as false alarms. Test negatives are always the cleaned ones.
Usage: train-character-hardneg.py <out.json>"""
import json, sys, glob, hashlib, os, re, datetime
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold

B = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints'
INDEX = '/Users/chrisjohnson/Documents/Media/dj-training-sounds/index.json'
CHARACTER = ['distorted', 'reverberant', 'echoing', 'filtered']
HEADS = os.environ.get('HEADS', 'distorted,reverberant').split(',')
# Words in Freesound tags/names, or Surge preset names, that mean the clip has the effect.
HAS = {'distorted': re.compile(r'distort|overdriv|drive|fuzz|crush|saturat|grit|dirt|scream|growl|filth|nasty|harsh|rasp'),
       'reverberant': re.compile(r'reverb|hall|cathedral|cave|church|room|space|echo|delay|ambien'),
       'echoing': re.compile(r'echo|delay|reverb|dub'),
       'filtered': re.compile(r'filter|lowpass|low-pass|highpass|high-pass|sweep|muffl|telephone|radio|lo-fi|lofi')}
# Renders whose effect overlaps the head's are neither positive nor negative for it.
OVERLAP = {'reverberant': {'echoing'}, 'echoing': {'reverberant'}}
# Surge preset types that make useful near misses: buzzy and bright for distorted, long and sustained for reverberant.
SURGE_TYPES = {'distorted': {'synth lead', 'synth bass', 'synth pluck', 'brass synth', 'synth sequence'},
               'reverberant': {'synth lead', 'synth bass', 'synth pluck', 'organ synth', 'brass synth'},
               'echoing': {'synth lead', 'synth bass', 'synth pluck', 'synth sequence'},
               'filtered': {'synth lead', 'synth bass', 'synth pluck', 'synth sequence', 'brass synth'}}
MODULATION = ['dry', 'chorus', 'flanger', 'phaser', 'tremolo', 'vibrato']
CAP = 1500
BAR = 0.60   # user ruling 2026-10-05: precision AND recall >= 0.60
rng = np.random.default_rng(int(os.environ.get('SEED', '417')))

def embeddings(folder, want):
    got = {}
    for f in sorted(glob.glob(f'{folder}/emb-*.jsonl')):
        for line in open(f):
            r = json.loads(line)
            if r['id'] in want and r['id'] not in got: got[r['id']] = r['embedding']
    return got
def matrix(ids, emb):
    X = np.asarray([emb[i] for i in ids], dtype=np.float64); return X / np.linalg.norm(X, axis=1, keepdims=True)

clean = {c['id'] for c in json.load(open(f'{B}/extras/freesound-clean.json'))['clips']}
fs = []
for it in json.load(open(INDEX))['items']:
    i = f"fs:{os.path.basename(os.path.dirname(it['file']))}:{it['id']}"
    if it['label'] in CHARACTER or i in clean: fs.append((i, it['label'], it['username'], ' '.join(it['tags']).lower() + ' ' + it['name'].lower()))
emb = embeddings(f'{B}/freesound-clap', {x[0] for x in fs}); fs = [x for x in fs if x[0] in emb]
FX = matrix([x[0] for x in fs], emb); FL = np.array([x[1] for x in fs]); FG = np.array([x[2] for x in fs]); FT = [x[3] for x in fs]

surge = json.load(open(f'{B}/extras/surge.json'))['clips']
semb = embeddings(f'{B}/surge-clap', {c['id'] for c in surge}); surge = [c for c in surge if c['id'] in semb]
SX = matrix([c['id'] for c in surge], semb); SG = np.array(['surge:' + c['group'] for c in surge])
SN = [c['group'].lower() for c in surge]; ST = [set(c.get('labels') or []) for c in surge]

man = json.load(open(f'{B}/effects-clap/manifest.json'))['clips']
eemb = embeddings(f'{B}/effects-clap', {c['id'] for c in man}); man = [c for c in man if c['id'] in eemb]
EX = matrix([c['id'] for c in man], eemb); EL = np.array([c['label'] for c in man]); EG = np.array(['fx:' + c['group'] for c in man])
rman = json.load(open(f'{B}/effect-renders/manifest.json'))['clips']
remb = embeddings(f'{B}/effect-renders', {c['id'] for c in rman}); rman = [c for c in rman if c['id'] in remb]
RX = matrix([c['id'] for c in rman], remb); RL = np.array([c['label'] for c in rman]); RG = np.array(['fxr:' + c['group'] for c in rman])
print(f'freesound {len(fs)}, surge {len(surge)}, effect sets {len(man)}, electronic renders {len(rman)}')

def held(name, groups, share=0.25):
    """Hash-ordered whole groups until about `share` of the rows are held out."""
    counts = {}
    for g in groups: counts[g] = counts.get(g, 0) + 1
    chosen, n, total = set(), 0, len(groups)
    for g in sorted(counts, key=lambda g: hashlib.sha256(f'{name}|{g}'.encode()).hexdigest()):
        if n >= share * total: break
        if n + counts[g] > 0.5 * total: continue
        chosen.add(g); n += counts[g]
    return chosen
fit = lambda X, y: LogisticRegression(C=1.0, class_weight='balanced', max_iter=800, tol=1e-3).fit(X, y)
def threshold(t, p):
    best = None
    for th in np.unique(np.round(p, 3)):
        if th < 0.5: continue
        pr = p >= th; tp = (pr & t).sum()
        if not tp: continue
        s = min(tp / pr.sum(), tp / t.sum())
        if best is None or s > best[0]: best = (s, float(th))
    return best

results = []
for L in HEADS:
    tagged = np.array([bool(HAS[L].search(t)) for t in FT])
    pos = FL == L; other = ~np.isin(FL, CHARACTER)
    # Positive and negative uploaders are held out separately so both sides of the test are unseen people.
    test_users = held(f'{L}:pos', list(FG[pos])) | held(f'{L}:neg', list(FG[other]))
    fs_test = np.isin(FG, sorted(test_users))
    # Near-miss pools: Surge presets of the right type without the effect in their name; effect-set modulation takes.
    s_ok = np.array([bool(ST[k] & SURGE_TYPES[L]) and not HAS[L].search(SN[k]) for k in range(len(surge))])
    e_ok = np.isin(EL, MODULATION) if L == 'distorted' else np.isin(EL, [m for m in MODULATION if m != 'tremolo'])
    s_test = np.isin(SG, sorted(held(f'{L}:surge', list(SG[s_ok])))); e_test = np.isin(EG, sorted(held(f'{L}:fx', list(EG[e_ok]))))
    s_tr = np.where(s_ok & ~s_test)[0]; e_tr = np.where(e_ok & ~e_test)[0]
    s_tr = rng.choice(s_tr, min(len(s_tr), CAP), replace=False); e_tr = rng.choice(e_tr, min(len(e_tr), CAP), replace=False)
    s_te = np.where(s_ok & s_test)[0]; e_te = np.where(e_ok & e_test)[0]
    e_te = rng.choice(e_te, min(len(e_te), 1000), replace=False)
    ep = EL == L; ep_test = np.isin(EG, sorted(held(f'{L}:fxpos', list(EG[ep]))))
    ep_tr = np.where(ep & ~ep_test)[0]; ep_tr = rng.choice(ep_tr, min(len(ep_tr), CAP), replace=False)
    ep_te = np.where(ep & ep_test)[0]; ep_te = rng.choice(ep_te, min(len(ep_te), 1000), replace=False)

    # Rendered pairs: held out by source group, so a test render's dry twin never trains.
    r_ok = (RL == L) | ~np.isin(RL, sorted(OVERLAP.get(L, set())))
    r_test = np.isin(RG, sorted(held(f'{L}:render', list(RG[r_ok]))))
    r_tr = np.where(r_ok & ~r_test)[0]; r_te = np.where(r_ok & r_test)[0]

    test_mask = fs_test & (pos | (other & ~tagged))
    Xte, yte = FX[test_mask], pos[test_mask]
    setups = {'baseline': pos | other, 'cleaned': pos | (other & ~tagged), 'hard': pos | (other & ~tagged), 'paired': pos | (other & ~tagged),
              'rendered': pos | (other & ~tagged), 'rendered+hard': pos | (other & ~tagged)}
    row = {'label': L, 'testPositive': int(yte.sum()), 'testNegative': int((~yte).sum()),
           'heldOutUploaders': len(set(FG[test_mask])), 'surgeTest': int(len(s_te)), 'effectTest': int(len(e_te)), 'setups': {}}
    for name, use in setups.items():
        tr = use & ~fs_test
        X, y, g = FX[tr], pos[tr], FG[tr]
        extra = np.vstack([SX[s_tr], EX[e_tr]]) if name in ('hard', 'paired', 'rendered+hard') else np.zeros((0, FX.shape[1]))
        ey = np.zeros(len(extra), bool)
        if name == 'paired': extra = np.vstack([extra, EX[ep_tr]]); ey = np.concatenate([ey, np.ones(len(ep_tr), bool)])
        if name.startswith('rendered'): extra = np.vstack([extra, RX[r_tr]]); ey = np.concatenate([ey, RL[r_tr] == L])
        # Threshold from out-of-fold scores on the training uploaders only; near misses join every training fold.
        p = np.full(len(y), np.nan)
        for a, b in GroupKFold(n_splits=5).split(X, y, g):
            p[b] = fit(np.vstack([X[a], extra]), np.concatenate([y[a], ey])).predict_proba(X[b])[:, 1]
        best = threshold(y, p)
        if not best: row['setups'][name] = {'verdict': 'no usable threshold'}; continue
        th = best[1]
        m = fit(np.vstack([X, extra]), np.concatenate([y, ey]))
        pr = m.predict_proba(Xte)[:, 1] >= th
        tp, fp, fn = int((pr & yte).sum()), int((pr & ~yte).sum()), int((~pr & yte).sum())
        P = tp / (tp + fp) if tp + fp else 0.0; R = tp / (tp + fn) if tp + fn else 0.0
        sfa = float((m.predict_proba(SX[s_te])[:, 1] >= th).mean()) if len(s_te) else None
        efa = float((m.predict_proba(EX[e_te])[:, 1] >= th).mean()) if len(e_te) else None
        erec = float((m.predict_proba(EX[ep_te])[:, 1] >= th).mean()) if len(ep_te) else None
        rp = m.predict_proba(RX[r_te])[:, 1] >= th; rt = RL[r_te] == L
        rrec, rfa = float(rp[rt].mean()) if rt.any() else None, float(rp[~rt].mean()) if (~rt).any() else None
        row['setups'][name] = {'threshold': th, 'trainNegative': int((~y).sum() + len(extra)), 'tp': tp, 'fp': fp, 'fn': fn,
                               'precision': P, 'recall': R, 'surgeFalseAlarm': sfa, 'effectFalseAlarm': efa, 'effectRecall': erec, 'renderRecall': rrec, 'renderFalseAlarm': rfa,
                               'passes': bool(P >= BAR and R >= BAR),
                               'falseAlarmIds': [fs[i][0] for i in np.where(test_mask)[0][pr & ~yte]]}
        # The shippable head refits on every uploader and both near-miss splits, keeping the tested threshold.
        full_extra, full_y = extra, ey
        if name in ('hard', 'paired', 'rendered+hard'):
            full_extra = np.vstack([SX[np.concatenate([s_tr, s_te])], EX[np.concatenate([e_tr, e_te])]]); full_y = np.zeros(len(full_extra), bool)
        elif name == 'rendered': full_extra, full_y = np.zeros((0, FX.shape[1])), np.zeros(0, bool)
        if name.startswith('rendered'):
            ri = np.concatenate([r_tr, r_te]); full_extra = np.vstack([full_extra, RX[ri]]); full_y = np.concatenate([full_y, RL[ri] == L])
        if name == 'paired':
            full_extra = np.vstack([full_extra, EX[np.concatenate([ep_tr, ep_te])]]); full_y = np.concatenate([full_y, np.ones(len(ep_tr) + len(ep_te), bool)])
        mf = fit(np.vstack([FX[use], full_extra]), np.concatenate([pos[use], full_y]))
        row['setups'][name]['head'] = {'weights': [round(float(w), 6) for w in mf.coef_[0]], 'bias': round(float(mf.intercept_[0]), 6)}
        print(f"{L:<12} {name:<9} test +{row['testPositive']}/-{row['testNegative']}  precision {P:.0%}  recall {R:.0%}  "
              f"near-miss false alarms: synth {sfa:.0%}  effect takes {efa:.0%}  renders: finds {rrec:.0%}, false {rfa:.0%}  {'PASS' if P >= BAR and R >= BAR else 'fails'}")
    results.append(row)
json.dump({'kind': 'character-hardneg-v1', 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'bar': BAR, 'results': results},
          open(sys.argv[1], 'w'), indent=1)
