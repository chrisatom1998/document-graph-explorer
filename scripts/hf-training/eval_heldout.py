"""Score the frozen key and tempo CNNs once on the held-out sets, next to the app's own numbers.
Usage: eval_heldout.py key|tempo <model.pt> <out.json>"""
import gzip, json, os, sys, numpy as np, torch, torch.nn as nn, torch.nn.functional as Fn, importlib.util
R = '/home/user/document-graph-explorer'; H = '/tmp/claude-0/feats/held'; G = '/tmp/claude-0/dl/gs'
what, model_path, out = sys.argv[1:4]
TON = {'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11}
def mod(path, argv):
    sys.argv = argv; spec = importlib.util.spec_from_file_location('m', path); m = importlib.util.module_from_spec(spec); return spec, m
ck = torch.load(model_path, map_location='cpu')
res = {}
if what == 'key':
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'train_key.py')).read().split("if mode == 'cv':")[0]
    src = src.replace("rows = json.load(open(labels))['key']", "rows = []").replace("MU = np.mean([x.mean() for x in X.values()]); SD = np.mean([x.std() for x in X.values()])", f"MU = {ck['mu']}; SD = {ck['sd']}")
    sys.argv = ['x', 'final', '/dev/null', '/tmp/claude-0/models/tmp']; ns = {}; exec(src, ns)
    net = ns['Net'](); net.load_state_dict(ck['state']); net.eval(); predict, mirex = ns['predict'], ns['mirex']
    def run(name, cases):
        rows = []
        for cid, f, tonic, minor, sl in cases:
            if not os.path.exists(f): continue
            x = np.load(f)['key'].astype(np.float32)
            if sl == 'mid10': x = x[max(0, len(x)//2 - 25): len(x)//2 + 25]
            p = int(predict(net, x).argmax()); e, m = mirex(p, tonic, minor)
            rows.append({'id': cid, 'exact': e, 'mirex': m, 'pred': p, 'truth': tonic + 12 * minor})
        res[name] = {'n': len(rows), 'exact': float(np.mean([r['exact'] for r in rows])), 'mirex': float(np.mean([r['mirex'] for r in rows])), 'rows': rows}
        print(f"{name}: n={len(rows)} exact {res[name]['exact']:.3f} mirex {res[name]['mirex']:.3f}", flush=True)
    gk = []
    for fn in os.listdir(f'{G}/key/annotations/key'):
        n = fn[:-4]; t = open(f'{G}/key/annotations/key/{fn}').read().split()
        if len(t) == 2 and t[0] in TON and t[1] in ('major', 'minor'): gk.append((n, TON[t[0]], int(t[1] == 'minor')))
    run('giantsteps-key whole', [(n, f'{H}/gskey_{n}.npz', t, m, 'whole') for n, t, m in gk])
    run('giantsteps-key mid10', [(n, f'{H}/gskey_{n}.npz', t, m, 'mid10') for n, t, m in gk])
    import csv
    man = {r['ID'].strip(): r for r in csv.DictReader(open(f'{G}/mtg/annotations/annotations.txt'), delimiter='\t')}
    r2 = []
    for it in json.load(open(f'{R}/docs/evaluations/dj-clips-round2-2026-10-06/mtg-key-manifest.json'))['items']:
        a = man.get(it['sampleKey'].split('.')[0], {}); t = a.get('MANUAL KEY', '').split()
        if a.get('C', '').strip() == '2' and len(t) == 2 and t[0] in TON and t[1] in ('major', 'minor'):
            r2.append((it['id'], it['sampleKey'], TON[t[0]], int(t[1] == 'minor')))
    run('round2 clip (mid 10 s)', [(i, f'{H}/r2clip_{i}.npz', t, m, 'whole') for i, n, t, m in r2])
    run('round2 whole preview', [(i, f'{H}/r2whole_{n}.npz', t, m, 'whole') for i, n, t, m in r2])
    tune = {r['track'].split(':')[1] for r in json.loads(gzip.decompress(__import__('subprocess').run(['git', '-C', R, 'show', 'origin/claude/fix-key-detection-cqon56:docs/evaluations/key-2026-10-06/features/tune-gtzan.json.gz'], capture_output=True).stdout))}
    ORDER = ['A','A#','B','C','C#','D','D#','E','F','F#','G','G#']; gz = []
    GT = '/tmp/claude-0/dl/gtzan_key/gtzan_key/genres'
    for g in os.listdir(GT):
        for fn in os.listdir(f'{GT}/{g}'):
            if fn.startswith('.') or not fn.endswith('.lerch.txt'): continue
            name = fn.replace('.lerch.txt', '.wav')
            if name in tune: continue
            v = int(open(f'{GT}/{g}/{fn}').read().split()[0])
            if v >= 0: gz.append((name, f'/tmp/claude-0/feats/train/gtzan_{name}.npz', TON[ORDER[v % 12]], int(v >= 12), 'whole'))
    run('gtzan test half (30 s)', gz)
else:
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'train_tempo.py')).read().split("ok = lambda")[0]
    src = src.replace("rows = [r for r in json.load(open(labels))['tempo'] if 30 <= r['bpm'] <= 285]", "rows = []").replace("MU = float(np.mean([x.mean() for x in X.values()])); SD = float(np.mean([x.std() for x in X.values()]))", f"MU = {ck['mu']}; SD = {ck['sd']}")
    sys.argv = ['x', 'final', '/dev/null', '/tmp/claude-0/models/tmp']; ns = {}; exec(src, ns)
    net = ns['Net'](); net.load_state_dict(ck['state']); net.eval(); predict = ns['predict']
    ok = lambda e, t: bool(e) and abs(e - t) <= 0.04 * t
    def run(name, cases):
        rows = []
        for cid, f, truth, app in cases:
            if not os.path.exists(f) or not truth: continue
            x = np.load(f)['tempo'].astype(np.float32); e, _ = predict(net, x)
            rows.append({'id': cid, 'truth': truth, 'cnn': e, 'app': app, 'cnn_ok': ok(e, truth), 'app_ok': ok(app, truth) if app is not None else None})
        a = [r['app_ok'] for r in rows if r['app_ok'] is not None]
        res[name] = {'n': len(rows), 'cnn': float(np.mean([r['cnn_ok'] for r in rows])), 'app': float(np.mean(a)) if a else None, 'rows': rows}
        print(f"{name}: n={len(rows)} cnn {res[name]['cnn']:.3f} app {res[name]['app']}", flush=True)
    def approws(f):
        if not os.path.exists(f): return {}
        return {r['id']: r.get('estimate') for r in json.load(open(f))['rows']}
    appbpm = approws(f'{R}/docs/evaluations/dj-clips-2026-10-06/results-tempo-fix/giantsteps.json')
    import glob
    r2f = (glob.glob(f'{R}/docs/evaluations/dj-clips-round2-2026-10-06/results/tempo-fix-116/*.json') or [''])[0]
    app2 = approws(r2f); print('round2 app source', r2f, len(app2))
    run('round1 500 clips (10 s)', [(it['id'], f"{H}/r1clip_{it['id']}.npz", it['tempo']['bpm'], appbpm.get(it['id'])) for it in json.load(open(f'{R}/docs/evaluations/dj-clips-2026-10-06/giantsteps-manifest.json'))['items']])
    run('round2 500 clips (10 s)', [(it['id'], f"{H}/r2clip_{it['id']}.npz", it['tempo']['bpm'], app2.get(it['id'])) for it in json.load(open(f'{R}/docs/evaluations/dj-clips-round2-2026-10-06/mtg-key-manifest.json'))['items']])
    gt = json.load(gzip.open(f'{R}/docs/evaluations/tempo-2026-10-06/features/gtzan-test.json.gz'))
    for cut in ('mid10', 'full'):
        cases = []
        for r in gt:
            if r['cut'] != cut: continue
            f = f"/tmp/claude-0/feats/train/gtzan_{r['key']}.npz"
            cases.append((r['id'], f, r['truth'], (r.get('app') or {}).get('bpm')))
        if cut == 'mid10':   # slice the middle 10 s from the whole-clip features
            res_cases = []
            for cid, f, t, a in cases:
                if os.path.exists(f):
                    x = np.load(f)['tempo']; m = x[max(0, len(x)//2 - 107): max(0, len(x)//2 - 107) + 215]
                    p = f'/tmp/claude-0/feats/gz_mid10_{os.path.basename(f)}'; np.savez(p, tempo=m); res_cases.append((cid, p, t, a))
            cases = res_cases
        run(f'gtzan test half ({cut})', cases)
json.dump(res, open(out, 'w'))
