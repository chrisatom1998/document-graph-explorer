"""Score a tempo CNN once on the 330 listener-labelled FSL10K loops (+30 no-defined-tempo), next to the app on main.
Usage: eval_loops_tempo.py <model.pt> <out.json>"""
import json, sys, numpy as np, torch
PT, OUT = sys.argv[1:3]
src = open('/tmp/claude-0/hfjob/train_tempo.py').read().split("ok = lambda")[0]
ck = torch.load(PT, map_location='cpu')
src = src.replace("rows = [r for r in json.load(open(labels))['tempo'] if 30 <= r['bpm'] <= 285]", "rows = []").replace("MU = float(np.mean([x.mean() for x in X.values()])); SD = float(np.mean([x.std() for x in X.values()]))", f"MU = {ck['mu']}; SD = {ck['sd']}")
sys.argv = ['x', 'final', '/dev/null', '/tmp/claude-0/models/tmp']; ns = {}; exec(src, ns)
net = ns['Net'](); net.load_state_dict(ck['state']); net.eval(); predict = ns['predict']
d = json.load(open('/mnt/project-files/datasets/fsl10k-loops-tempo-330.json'))
ok = lambda e, t: bool(e) and abs(e - t) <= 0.04 * t
oct_ = lambda e, t: bool(e) and any(ok(e * f, t) for f in (1, 2, .5))
def conf(p, b):
    top = np.argsort(p)[::-1][:3]; return float(sum(p[k] for k in top if abs(30 + k - b) <= 0.04 * b))
def rule(app, b, c):   # mirrors combineLoopTempo in src/audio/tempoCnn.ts (threshold 0.5 from the song tuning)
    usable = 40 <= b <= 250 and c > 0.5
    if app is None: return b if usable else None
    return b if usable and abs(b / app - 1) > 0.04 else app
rows = []
for it in d['items'] + [dict(x, group='no-tempo', listener_bpm=None) for x in d['no_defined_tempo']]:
    x = np.load(f"/tmp/claude-0/feats/fsl/fsl_{it['sound_id']}.npz")['tempo'].astype(np.float32)
    r = {'sound_id': it['sound_id'], 'group': it['group'], 'truth': it['listener_bpm'], 'app': it.get('app_tempo_main')}
    for mode in ('pad', 'tile'):
        b, p = predict(net, x, tile=(mode == 'tile')); r[mode] = b; r[mode + '_conf'] = conf(p, b)
    r['shipped'] = rule(r['app'], r['tile'], r['tile_conf'])
    rows.append(r)
nt = [r for r in rows if r['group'] == 'no-tempo']; rows = [r for r in rows if r['group'] != 'no-tempo']
print(f"no-defined-tempo loops n={len(nt)}: app gives a tempo on {sum(r['app'] is not None for r in nt)}, app+CNN rule on {sum(r['shipped'] is not None for r in nt)}")
def show(sel, name):
    n = len(sel)
    line = f"{name} n={n}: app {sum(ok(r['app'], r['truth']) for r in sel)} ({np.mean([ok(r['app'], r['truth']) for r in sel]):.3f}) oct {np.mean([oct_(r['app'], r['truth']) for r in sel]):.3f}"
    line += f" | APP+CNN RULE {sum(ok(r['shipped'], r['truth']) for r in sel)} ({np.mean([ok(r['shipped'], r['truth']) for r in sel]):.3f}) wrong {sum(r['shipped'] is not None and not ok(r['shipped'], r['truth']) for r in sel)} none {sum(r['shipped'] is None for r in sel)} (app wrong {sum(r['app'] is not None and not ok(r['app'], r['truth']) for r in sel)} none {sum(r['app'] is None for r in sel)})"
    for m in ('pad', 'tile'): line += f" | cnn-{m} {sum(ok(r[m], r['truth']) for r in sel)} ({np.mean([ok(r[m], r['truth']) for r in sel]):.3f}) oct {np.mean([oct_(r[m], r['truth']) for r in sel]):.3f}"
    print(line, flush=True)
show(rows, 'all 330')
for g in sorted({r['group'] for r in rows}): show([r for r in rows if r['group'] == g], g)
json.dump(rows + nt, open(OUT, 'w'))
