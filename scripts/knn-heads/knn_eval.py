"""Few-shot nearest-neighbour heads on the app's CLAP features, scored on the fresh test sets (Oct 11 2026).

Usage: python3 -I knn_eval.py <out.json> [--keep filtered_pool.csv]

Banks: per tag up to M example embeddings from the training pool (run 9, commercial round 10, empty-tags; CLAP 512),
plus one shared background bank of B pool clips. kNN score = mean top-k cosine to the tag's bank minus mean top-k cosine
to background clips that do not carry the tag. Any pool clip within cosine 0.995 of a test clip is dropped first.
Split as the code-fixes thread: CAL = freesound-reserved + 'cal' half of each board set (sha256('code-fix-cal|'+group)%2),
JUDGE = other half. Cutoffs and the fusion choice are fit on CAL only; the locked holdout is never read.
Methods: base (board output+cutoff), knn (alone), or (tagger OR knn), stack (logistic on tagger logit + knn score).
Env: MODE=balanced (cutoff maximises mean min(P, R)) else precision-first (CAL precision >= PMIN, then most recall);
BASE=app scores against what the app shows today (taggerPolicy tags + learned.json linear heads) instead of the board's
single output; neighbour scores are off on clips <= 2.25 s (the app gives those only one-shot heads).
LOCAL ONLY: reads test audio embeddings; nothing here leaves the container.
"""
import csv, glob, hashlib, json, os, re, sys
from pathlib import Path
_repo = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_repo / 'scripts'))
from learned_store import load_learned
import numpy as np
WORK = os.environ.get('KNN_WORK', '/tmp/knn')  # container scratch: features, test embeddings, model files
from sklearn.linear_model import LogisticRegression
out = sys.argv[1]; keepf = sys.argv[sys.argv.index('--keep') + 1] if '--keep' in sys.argv else None
M, B, K = int(os.environ.get('M', 200)), int(os.environ.get('B', 3000)), int(os.environ.get('K', 5))
SETS = '/mnt/project-files/datasets/fresh-tests-2026-10-11/sets'; REPO = '/home/user/document-graph-explorer'
T = f"{WORK}/test"; MODEL = f"{WORK}/model"
SC = {'free-tag-set-test': '/mnt/project-files/reports/code-fixes-2026-10-11/scores-89288f0', 'freesound-reserved': '/mnt/project-files/reports/code-fixes-2026-10-11/scores-89288f0'}
for n in ('fsd50k-eval', 'nsynth-test'):
    for d in ('/mnt/project-files/reports/scoreboard/scores/89288f0', '/mnt/project-files/reports/code-fixes-2026-10-11/scores-89288f0'):
        if os.path.exists(f'{d}/{n}.npz'): SC[n] = d; break
BOARD = ['free-tag-set-test', 'fsd50k-eval', 'nsynth-test']; EXTRA_CAL = ['freesound-reserved']; MIN_POS = 5
rng = np.random.default_rng(0)
APPBASE = os.environ.get('BASE') == 'app'
LEARNED = load_learned(_repo / 'public/sound-model/learned.json')  # its linear heads only
LINES = [(.5, .5), (.6, .6), (.7, .7), (.5, .3), (.6, .3)]
classes = json.load(open(f'{MODEL}/onnx/model.json'))['classes']; th = json.load(open(f'{MODEL}/thresholds.json'))
policy = {t['label']: t for t in json.load(open(f'{REPO}/src/audio/taggerPolicy.json'))['tags']}
sys.path.insert(0, f'{REPO}/scripts/audio-model')
from labelmap import SAME  # noqa: E402
def output_for(tag):
    if tag in policy: return policy[tag]['output'], policy[tag]['threshold']
    o = f'cat:{tag}'
    if o not in classes: o = next((k for k, v in SAME.items() if v == tag and k in classes and not k.startswith('jamendo:')), None)
    if o and th.get(o, {}).get('enabled'): return o, th[o]['threshold']
    return o, None
cat = json.load(open(f'{REPO}/src/audio/djCatalog.json'))['categories']
ts = open(f'{REPO}/src/audio/djTags.ts').read()
TIMBRE = set(re.findall(r"'([^']+)'", re.search(r"RULE_DESCRIBED_LABELS = \[([^\]]+)\]", open(f'{REPO}/src/audio/timbreDescriptions.ts').read()).group(1)))
MERGED = {n for _, n in re.findall(r"'(\w+):([^']+)'\s*:", ts.split('MERGED_DJ_LABELS')[1].split('};')[0])}
HIDDEN = set()
for names, _ in re.findall(r"\.\.\.\[([^\]]+)\]\.map\(l => `(\w+):", ts.split('DJ_HIDDEN_LABELS: ReadonlySet<string> = new Set([')[1].split(']);\n')[0]): HIDDEN |= set(re.findall(r"'([^']+)'", names))
TAGS = sorted({c['label'] for c in cat} - TIMBRE - MERGED - HIDDEN)
nrm = lambda X: (X / np.maximum(np.linalg.norm(X, axis=1, keepdims=True), 1e-8)).astype(np.float32)

# test sets
DUR = json.load(open(f'{T}/durations.json')) if os.path.exists(f'{T}/durations.json') else {}
h2 = lambda g: int(hashlib.sha256(('code-fix-cal|' + g).encode()).hexdigest()[:8], 16) % 2
data = []
for name in BOARD + EXTRA_CAL:
    if name not in SC: print('no tagger scores', name); continue
    emb = {}
    for f in glob.glob(f'{T}/{name}.s*.jsonl'):
        for line in open(f):
            if line.strip(): r = json.loads(line); emb[r['id']] = r['embedding']
    z = np.load(f'{SC[name]}/{name}.npz'); rows = {r['id']: r for r in csv.DictReader(open(f'{SETS}/{name}.csv'))}
    ids = [i for i in z['ids'] if i in emb]
    if len(ids) < 0.97 * len(rows): print(f'{name}: only {len(ids)}/{len(rows)} embedded, skipped'); continue
    si = {c: k for k, c in enumerate(z['ids'])}
    data.append(dict(name=name, ids=ids, S=z['scores'][[si[i] for i in ids]], E=nrm(np.array([emb[i] for i in ids], np.float32)),
                     rows=[rows[i] for i in ids], half=np.array(['cal' if name in EXTRA_CAL or h2(rows[i]['group']) == 0 else 'judge' for i in ids])))
    data[-1]['short'] = np.array([(DUR.get(i) or 99) <= 2.25 for i in ids]) if os.environ.get('SHORT_RULE', '1') == '1' else np.zeros(len(ids), bool)
    print(f'{name}: {len(ids)} clips, {int(data[-1]["short"].sum())} one-shots (no neighbour head in the app)', flush=True)
# pool
z = np.load(f"{WORK}/pool/pool.npz")
keep = np.ones(len(z['pool_id']), bool)
if keepf:
    ks = {r['pool_id'] for r in csv.DictReader(open(keepf))}; keep = np.array([i in ks for i in z['pool_id']])
PX = nrm(z['clap'].astype(np.float32)); Ptags = [set(str(s).split('|')) for s in z['tags']]
TE = np.concatenate([d['E'] for d in data]); near = np.zeros(len(PX), bool)
for a in range(0, len(PX), 4000): near[a:a + 4000] = (PX[a:a + 4000] @ TE.T).max(1) > 0.995
print(f'pool {len(PX)}, kept by exclude list {keep.sum()}, near-duplicates of test clips dropped {int((near & keep).sum())}')
keep &= ~near
bg = rng.choice(np.where(keep)[0], B, replace=False)
BANKS = {'background': [str(z['pool_id'][i]) for i in bg], 'tags': {}}
def bank(tag):
    pos = np.where(keep & np.array([tag in s for s in Ptags]))[0]
    if len(pos) == 0: return None, 0
    pick = rng.choice(pos, min(M, len(pos)), replace=False); BANKS['tags'][tag] = [str(z['pool_id'][i]) for i in pick]
    return PX[pick], len(pos)
topk = lambda S, k: np.sort(S, 1)[:, -min(k, S.shape[1]):].mean(1)
def knn_score(E, P, tag):
    bgt = PX[[i for i in bg if tag not in Ptags[i]]]
    return topk(E @ P.T, K) - topk(E @ bgt.T, K)

def status(tag, d):
    y = np.full(len(d['ids']), -1)
    for k, r in enumerate(d['rows']):
        if tag in r['present'].split(';'): y[k] = 1
        elif tag in r['absent'].split(';') or r['weak'] == '1': y[k] = 0
    return y
def prf(pred, y):
    tp = int((pred & (y == 1)).sum()); fp = int((pred & (y == 0)).sum()); fn = int((~pred & (y == 1)).sum())
    return dict(P=round(tp / (tp + fp), 3) if tp + fp else 0., R=round(tp / (tp + fn), 3) if tp + fn else 0., pos=int((y == 1).sum()), neg=int((y == 0).sum()))
def evaluate(tag, preds, half):
    per = {}
    for d, p in zip(data, preds):
        if half == 'judge' and d['name'] in EXTRA_CAL: continue
        y = status(tag, d); m = (d['half'] == half) & (y >= 0)
        if (y[m] == 1).sum() < (MIN_POS if half == 'judge' else 3): continue
        per[d['name']] = prf(p[m], y[m])
    ok = {b: bool(per) and any(r['neg'] for r in per.values()) and all(r['P'] >= b[0] and r['R'] >= b[1] for r in per.values()) for b in LINES}
    ok = {f'{int(b[0]*100)}/{int(b[1]*100)}': v for b, v in ok.items()}
    return per, ok
PMIN = float(os.environ.get('PMIN', 0.65))
BAL = os.environ.get('MODE') == 'balanced'
calm = lambda per: (np.mean([min(r['P'], r['R']) for r in per.values()]) if per else -9) if BAL else\
     (np.mean([r['R'] for r in per.values()]) if all(r['P'] >= PMIN for r in per.values()) else -1 + np.mean([min(r['P'], r['R']) for r in per.values()])) if per else -9
def fit_cut(vals, tag):
    allv = np.concatenate([v[d['half'] == 'cal'] for v, d in zip(vals, data)])
    best, bt = -1, None
    for t in np.unique(np.quantile(allv, np.linspace(0.5, 1, 301))):
        m = calm(evaluate(tag, [v >= t for v in vals], 'cal')[0])
        if m > best: best, bt = m, float(t)
    return bt, best
lg = lambda s: np.log(np.clip(s, 1e-4, 1 - 1e-4) / (1 - np.clip(s, 1e-4, 1 - 1e-4)))
res = {}
for tag in TAGS:
    o, t0 = output_for(tag); j = classes.index(o) if o in classes else None
    if APPBASE:
        # What the app shows today: the tagger only for tags in taggerPolicy.json, plus the CLAP linear heads in
        # learned.json (on clips over 2.25 s unless the head is also one-shot tested). Short-clip heads are not modelled.
        tp = policy.get(tag); hs = [h for h in LEARNED['heads'] if h['label'] == tag]
        base = []
        for d in data:
            b = d['S'][:, classes.index(tp['output'])] >= tp['threshold'] if tp else np.zeros(len(d['ids']), bool)
            for h in hs:
                hit = 1 / (1 + np.exp(-(d['E'] @ np.array(h['weights'], np.float32) + h['bias']))) >= h['threshold']
                b = b | (hit & (~d['short'] | bool(h.get('oneShot'))))
            base.append(b)
    else:
        base = [d['S'][:, j] >= t0 if j is not None and t0 is not None else np.zeros(len(d['ids']), bool) for d in data]
    bper, bok = evaluate(tag, base, 'judge')
    P, npos = bank(tag)
    e = dict(output=o, cutoff=t0, poolPos=npos, base=dict(per=bper, ok=bok, cal=round(calm(evaluate(tag, base, 'cal')[0]), 3)))
    if P is None or not bper: res[tag] = e; continue
    ks = [np.where(d['short'], -9.0, knn_score(d['E'], P, tag)) for d in data]
    c, m = fit_cut(ks, tag)
    if c is None: res[tag] = e; continue
    kp = [k >= c for k in ks]; per, ok = evaluate(tag, kp, 'judge'); e['knn'] = dict(cut=c, cal=round(m, 3), per=per, ok=ok)
    # OR fusion: re-fit the kNN cutoff with the tagger's own decision kept
    best, bc = -1, None
    allv = np.concatenate([k[d['half'] == 'cal'] for k, d in zip(ks, data)])
    for t in np.unique(np.quantile(allv, np.linspace(0.5, 1, 301))):
        mm = calm(evaluate(tag, [b | (k >= t) for b, k in zip(base, ks)], 'cal')[0])
        if mm > best: best, bc = mm, float(t)
    per, ok = evaluate(tag, [b | (k >= bc) for b, k in zip(base, ks)], 'judge'); e['or'] = dict(cut=bc, cal=round(best, 3), per=per, ok=ok)
    if j is not None and not APPBASE:
        Xc = np.concatenate([np.c_[lg(d['S'][:, j]), k][(d['half'] == 'cal') & (status(tag, d) >= 0)] for d, k in zip(data, ks)])
        yc = np.concatenate([status(tag, d)[(d['half'] == 'cal') & (status(tag, d) >= 0)] for d in data])
        if 0 < yc.sum() < len(yc):
            clf = LogisticRegression(C=1.0, class_weight='balanced').fit(Xc, yc)
            pv = [clf.predict_proba(np.c_[lg(d['S'][:, j]), k])[:, 1] for d, k in zip(data, ks)]
            c2, m2 = fit_cut(pv, tag)
            per, ok = evaluate(tag, [p >= c2 for p in pv], 'judge'); e['stack'] = dict(cut=c2, cal=round(m2, 3), per=per, ok=ok, coef=[round(float(x), 3) for x in clf.coef_[0]], bias=round(float(clf.intercept_[0]), 3))
    # choose on CAL only: must beat base CAL by 0.03
    ch, bcal = 'base', e['base']['cal'] + 0.03
    for k in ('knn', 'or', 'stack'):
        if k in e and e[k]['cal'] > bcal: ch, bcal = k, e[k]['cal']
    e['chosen'] = ch; res[tag] = e
json.dump(res, open(out, 'w'), indent=1, default=lambda o: str(o))
json.dump(BANKS, open(out[:-5] + '-banks.json', 'w'))
line = lambda per: ' '.join(f"{n[:4]}:{r['P']:.2f}/{r['R']:.2f}({r['pos']})" for n, r in per.items())
tier = lambda ok: 3 if ok['70/70'] else 2 if ok['60/60'] else 1 if ok['50/50'] else 0
gain = []
for tag, e in res.items():
    if 'base' not in e or not e['base']['per']: continue
    ch = e.get('chosen', 'base'); bt = tier(e['base']['ok']); ct = tier(e[ch]['ok'])
    flag = 'GAIN' if ct > bt else 'LOSS' if ct < bt else ''
    if ch != 'base' or not e['base']['ok']['50/50']:
        print(f"{tag:20s} pool={e['poolPos']:5d} base {line(e['base']['per'])} | {ch}: {line(e[ch]['per'])} {flag}")
    if flag: gain.append((tag, bt, ct))
print('tier changes (base -> chosen):', gain)
for b in [f"{int(x*100)}/{int(y*100)}" for x, y in LINES]:
    print(f'{b}: base {sum(e["base"]["ok"][b] for e in res.values() if "base" in e and e["base"]["per"])} -> chosen {sum(e[e.get("chosen","base")]["ok"][b] for e in res.values() if "base" in e and e["base"]["per"])}')
