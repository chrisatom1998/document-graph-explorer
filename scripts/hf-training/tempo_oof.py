"""Out-of-fold tempo CNN predictions on the tempo thread's tuning clips, plus top-3 on held-out clips.
Clips are cut from whole-track features by frame offset (21.533 fps), matching build-sets.py / build-mtg.py starts."""
import gzip, hashlib, json, os, sys, numpy as np, torch
R = '/home/user/document-graph-explorer'; RUN = f'{R}/docs/evaluations/hf-key-tempo-2026-10-06/runs/tempo-v1'; FPS = 11025 / 512
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'train_tempo.py')).read().split("ok = lambda")[0]
def load(pt):
    ck = torch.load(pt, map_location='cpu')
    s = src.replace("rows = [r for r in json.load(open(labels))['tempo'] if 30 <= r['bpm'] <= 285]", "rows = []").replace("MU = float(np.mean([x.mean() for x in X.values()])); SD = float(np.mean([x.std() for x in X.values()]))", f"MU = {ck['mu']}; SD = {ck['sd']}")
    sys.argv = ['x', 'final', '/dev/null', '/tmp/claude-0/models/tmp']; ns = {}; exec(s, ns)
    net = ns['Net'](); net.load_state_dict(ck['state']); net.eval(); return net, ns['predict']
folds = [load(f'{RUN}/fold{k}.pt') for k in range(5)]; final = load(f'{RUN}/tempo-cnn.pt')
fold = lambda g: int(hashlib.sha256(g.encode()).hexdigest()[:8], 16) % 5
groups = {os.path.basename(r['f'])[:-4]: r['group'] for r in json.load(open('/tmp/claude-0/feats/labels.json'))['tempo']}
def top3(p): i = np.argsort(p)[::-1][:3]; return [[30 + int(j), round(float(p[j]), 4)] for j in i]
def cut(x, start, secs):
    a = int(round(max(0, start) * FPS)); return x[a: a + int(round(secs * FPS))]
out = {'tune': [], 'heldout': []}
def add(split, cid, feat_key, start, secs, k):
    f = f'/tmp/claude-0/feats/train/{feat_key}.npz'
    if not os.path.exists(f): return
    x = np.load(f)['tempo'].astype(np.float32); d = len(x) / FPS
    if callable(start): start = start(d)
    if secs is None: secs = d
    net, pred = folds[k] if k is not None else final
    bpm, p = pred(net, cut(x, start, secs))
    out[split].append({'id': cid, 'fold': k, 'cnn_bpm': bpm, 'top3': top3(p)})
# GiantSteps tempo tune (161) and GTZAN tune half, ids from tune.json.gz
for r in json.load(gzip.open(f'{R}/docs/evaluations/tempo-2026-10-06/features/tune.json.gz')):
    if r['source'] == 'giantsteps':
        fk = f"gst_{r['key']}"; tag = r['cut']
        st, secs = {'q1-10': (lambda d: d * .25 - 5, 10), 'q3-10': (lambda d: d * .75 - 5, 10), 'mid20': (lambda d: d / 2 - 10, 20)}[tag]
    else:
        fk = f"gtzan_{r['key']}"; st, secs = ((lambda d: d / 2 - 5), 10) if r['cut'] == 'mid10' else (0, None)
    g = groups.get(fk); add('tune', r['id'], fk, st, secs, fold(g) if g else None)
# MTG tune: every MTG training track with a Beatport BPM (same exclusions as build-mtg.py)
for fk, g in groups.items():
    if not fk.startswith('mtg_'): continue
    n = fk[4:]
    for tag, st in (('q1-10', lambda d: d * .25 - 5), ('q3-10', lambda d: d * .75 - 5)):
        add('tune', f'mk-{n}-{tag}', fk, st, 10, fold(g))
# Held-out top-3 with the final model (already-cut clip features)
H = '/tmp/claude-0/feats/held'
for it in json.load(open(f'{R}/docs/evaluations/dj-clips-2026-10-06/giantsteps-manifest.json'))['items'] + json.load(open(f'{R}/docs/evaluations/dj-clips-round2-2026-10-06/mtg-key-manifest.json'))['items']:
    pre = 'r1clip' if it['id'].startswith('gs-') else 'r2clip'; f = f"{H}/{pre}_{it['id']}.npz"
    if os.path.exists(f):
        bpm, p = final[1](final[0], np.load(f)['tempo'].astype(np.float32)); out['heldout'].append({'id': it['id'], 'fold': None, 'cnn_bpm': bpm, 'top3': top3(p)})
for r in json.load(gzip.open(f'{R}/docs/evaluations/tempo-2026-10-06/features/gtzan-test.json.gz')):
    st, secs = ((lambda d: d / 2 - 5), 10) if r['cut'] == 'mid10' else (0, None)
    add('heldout', r['id'], f"gtzan_{r['key']}", st, secs, None)
print({k: len(v) for k, v in out.items()}, sum(r['fold'] is None for r in out['tune']), 'tune rows without fold')
OUTP = '/mnt/project-files/models/tempo-cnn-2026-10-06/tempo-oof-top3.json'
json.dump({'about': 'Tempo CNN tempo-v1. tune: out-of-fold (fold = sha256(group)%5, group = mtg:<artist> / gst:<track> / gtzan:<file>); heldout: final model. Clips cut from whole-track features by frame offset with the same start rules as build-sets.py/build-mtg.py (frame-aligned, so up to ~25 ms off ffmpeg -ss). top3 = averaged softmax [bpm, prob].', **out}, open(OUTP, 'w'))
