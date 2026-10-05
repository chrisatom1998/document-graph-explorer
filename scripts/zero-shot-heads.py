"""Zero-shot CLAP detectors for labels that trained heads could not learn: score = cosine between a clip's
CLAP fingerprint and the mean of the label's own text-prompt vectors (public/sound-model/prompts.json).
One number per label (the cut-off) is chosen on calibration groups; the result is scored on held-out groups
(~25% of positives, by uploader/brand) of two yardsticks: real recordings and the user's library brands.
A label ships (as a maybe tag) only if real recordings pass the bar AND the library is at least "near"
(one number >= bar, the other >= 0.10) whenever the library has >= 15 held-out positives.
It ships in the existing head format: weights = k * text vector, bias = -k * cutoff, threshold 0.5, so the app
needs no new code (score >= 0.5 exactly when cosine >= cutoff).
Usage: zero-shot-heads.py <out round.json> name=manifest@dir ...   env: LABELS=a,b (default: all unshipped), SKIP=..."""
import json, sys, os, glob, hashlib
import numpy as np

OUT = sys.argv[1]; SPECS = [a.split('=', 1) for a in sys.argv[2:]]
BAR = float(os.environ.get('BAR', .45)); K = 60.0
FP = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints'
cat = {c['label']: c for c in json.load(open('src/audio/djCatalog.json'))['categories']}
shipped = {h['label'] for f in ('learned.json', 'short-clip.json') for h in json.load(open(f'public/sound-model/{f}'))['heads']}
SKIP = set(filter(None, os.environ.get('SKIP', '').split(',')))
LABELS = [l for l in (os.environ['LABELS'].split(',') if os.environ.get('LABELS') else cat) if l in cat and l not in shipped and l not in SKIP]
vec = {}
for p in json.load(open('public/sound-model/prompts.json')):
    if p['label'] in cat: vec.setdefault(p['label'], []).append(np.asarray(p['vector'], dtype=np.float64))
unit = lambda v: v / np.linalg.norm(v)
T = {l: unit(np.mean([unit(v) for v in vs], axis=0)) for l, vs in vec.items()}
# EXTRA_VECTORS=file.json {label: [{prompt, vector}]}: candidate prompts; a subset is picked per label on calibration groups.
EXTRA = json.load(open(os.environ['EXTRA_VECTORS'])) if os.environ.get('EXTRA_VECTORS') else {}
CANDS = {l: [('shipped prompt', unit(v)) for v in vec.get(l, [])] + [(e['prompt'], unit(np.asarray(e['vector']))) for e in EXTRA.get(l, [])] for l in cat}

RES = set()
for _f in ('docs/evaluations/short-clips-2026-10-04/reserved-test-families.json', 'docs/evaluations/synth-clips-2026-10-05/reserved-test-families.json'):
    d = json.load(open(_f)); RES |= {str(u).split(':', 1)[-1] for k in ('freesoundUploaders', 'fsdUploaders') for u in d.get(k, [])} | set(map(str, d.get('freesoundIds', [])))
ids, X, L, G, POOL = [], [], [], [], []
for name, spec in [('vault', f'{FP}/vault-clap/manifest.json@{FP}/vault-clap')] + SPECS:
    man, folder = spec.split('@'); meta = {c['id']: c for c in json.load(open(man))['clips']}; seen = set()
    for f in sorted(glob.glob(f'{folder}/emb-*.jsonl')):
        for line in open(f):
            r = json.loads(line); c = meta.get(r['id'])
            if not c or r['id'] in seen: continue
            fam = str(c.get('group') or c.get('vendor') or '').split(':', 1)[-1]
            if name != 'vault' and (fam in RES or r['id'].rsplit(':', 1)[-1] in RES): continue
            labs = set(c['labels'] if 'labels' in c else [c.get('label')]) - {None}
            if not labs: continue                      # unlabelled clips cannot be negatives
            seen.add(r['id']); ids.append(r['id']); X.append(r['embedding']); L.append(labs); G.append(f"{name}:{c.get('vendor') or c.get('group')}"); POOL.append('library' if name == 'vault' else 'real')
X = np.asarray(X, dtype=np.float32); X /= np.linalg.norm(X, axis=1, keepdims=True); G = np.array(G); POOL = np.array(POOL)
print(len(ids), 'labelled clips')
FAMILY_OF = lambda l: cat.get(l, {}).get('family')

def score(t, p):
    tp = int((p & t).sum()); P = tp / p.sum() if p.sum() else 0.0; R = tp / t.sum() if t.sum() else 0.0
    return P, R, tp
results = []
def split(label, pos, use, pool):
    m = use & (POOL == pool)
    groups = sorted(set(G[m & pos]), key=lambda g: hashlib.sha256(f'zs|{label}|{g}'.encode()).hexdigest())
    held, n = set(), 0
    for g in groups:
        if n >= .25 * pos[m].sum(): break
        held.add(g); n += int((G[m & pos] == g).sum())
    test = m & np.isin(G, sorted(held)); return test, m & ~test
def cal_score(sv, pos, cal):
    if pos[cal].sum() < 15: return None
    best = 0.0
    for cut in np.quantile(sv[cal & pos], np.linspace(.02, .98, 49)):
        P, R, _ = score(pos[cal], sv[cal] >= cut); best = max(best, min(P, R))
    return best
for label in LABELS:
    pos = np.array([label in l for l in L])
    # Same-family labels are not evidence of absence (a "synth lead" clip may also be a "supersaw").
    use = pos | np.array([FAMILY_OF(label) not in {FAMILY_OF(o) for o in l} for l in L])
    row = {'kind': 'label', 'name': label, 'method': 'zero-shot CLAP text'}
    cals = [split(label, pos, use, p)[1] for p in ('real', 'library')]
    vector = T[label]
    if EXTRA.get(label):
        # Greedy prompt subset, judged only on calibration groups (worse of the two yardsticks that have data).
        C = [(name, v, X @ v.astype(np.float32)) for name, v in CANDS[label]]
        def judge(idx):
            sv = np.mean([C[i][2] for i in idx], axis=0); vals = [cal_score(sv, pos, c) for c in cals]; vals = [v for v in vals if v is not None]
            return min(vals) if vals else -1.0
        chosen, best = [], -1.0
        while True:
            options = [(judge(chosen + [i]), i) for i in range(len(C)) if i not in chosen]
            if not options: break
            v, i = max(options)
            if v <= best + .005: break
            chosen, best = chosen + [i], v
        if chosen:
            vector = unit(np.mean([C[i][1] for i in chosen], axis=0)); row['prompts'] = [C[i][0] for i in chosen]
    s = X @ vector.astype(np.float32)
    for pool in ('real', 'library'):
        test, cal = split(label, pos, use, pool)
        row[pool] = {'testPositive': int(pos[test].sum()), 'calPositive': int(pos[cal].sum())}
        if pos[cal].sum() < 15 or pos[test].sum() < 15: continue
        best = None
        for cut in np.quantile(s[cal & pos], np.linspace(.02, .98, 49)):
            P, R, _ = score(pos[cal], s[cal] >= cut); v = min(P, R)
            if best is None or v > best[0]: best = (v, float(cut))
        P, R, tp = score(pos[test], s[test] >= best[1])
        row[pool].update({'cutoff': best[1], 'precision': P, 'recall': R, 'tp': tp})
    real, lib = row.get('real', {}), row.get('library', {})
    ok_real = 'precision' in real and min(real['precision'], real['recall']) >= BAR
    ok_lib = lib.get('testPositive', 0) < 15 or ('precision' in lib and max(lib['precision'], lib['recall']) >= BAR and min(lib['precision'], lib['recall']) >= .10)
    row.update({'testedOn': 'real recordings', 'precision': real.get('precision', 0.0), 'recall': real.get('recall', 0.0),
                'testPositive': real.get('testPositive', 0), 'passes': bool(ok_real and ok_lib),
                'verdict': 'PASS' if ok_real and ok_lib else ('fails on library' if ok_real else 'fails')})
    if row['passes']:
        row['threshold'] = 0.5
        row['head'] = {'weights': [round(float(w), 6) for w in K * vector], 'bias': round(-K * real['cutoff'], 6)}
    results.append(row)
    print(f"{label:<20} real {real.get('precision', 0):.2f}/{real.get('recall', 0):.2f} n{real.get('testPositive', 0):<5} library {lib.get('precision', 0):.2f}/{lib.get('recall', 0):.2f} n{lib.get('testPositive', 0):<5} {row['verdict']}")
json.dump({'kind': 'zero-shot-heads-v1', 'bar': BAR, 'results': results}, open(OUT, 'w'), indent=1)
print('passing', sum(r['passes'] for r in results), 'of', len(results))
