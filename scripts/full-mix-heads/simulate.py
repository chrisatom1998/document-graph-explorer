"""What the Sounds panel would show on the OpenMIC benchmarks with the full-mix heads added, from offline features.

Usage: python3 scripts/full-mix-heads/simulate.py <model.json> <features-dir> <name>=<manifest.json>:<shown.json> ...

shown.json is scripts/full-mix/extract.mjs output from a real-app run of the base build (its "shown" tags). The heads are
applied exactly as src/audio/fullMixHeads.ts does (one 10 s window per OpenMIC clip). Variants:
  base:     the base build's tags;
  union:    base tags plus every head label at or above its threshold;
  override: for classes a head covers, the head alone decides; other classes keep the base tags.
Scoring follows scripts/mixed-music/score.mjs: only explicit present/absent labels count, with its label mapping.
"""
import glob, json, os, sys
import numpy as np

MAP = {'drums': ['drums', 'drum kit', 'drum machine'], 'voice': ['voice'], 'synthesizer': ['synthesizer'], 'piano': ['piano', 'electric piano'],
       'guitar': ['guitar', 'acoustic guitar', 'electric guitar', 'steel guitar'], 'bass': ['bass guitar', 'bass', 'double bass'],
       'cymbals': ['cymbals'], 'organ': ['organ'], 'violin': ['violin', 'violin / fiddle'], 'trumpet': ['trumpet'], 'saxophone': ['saxophone']}
FULL_MIX_JAMENDO = {'source:synthesizer': 'synthesizer', 'source:drum kit': 'drums', 'source:drum machine': 'drums'}

def load_features(d):
    rows, mats = [], []
    for mp in sorted(glob.glob(os.path.join(d, '*.jsonl'))):
        r = [json.loads(l) for l in open(mp) if l.strip()]
        rows += r; mats.append(np.fromfile(mp[:-6] + '.f32', dtype='<f4').reshape(len(r), -1))
    return rows, np.concatenate(mats)

def head_probs(model, X):
    import re
    root = os.path.join(os.path.dirname(__file__), '..', '..')
    config = json.load(open(os.path.join(root, 'public', 'music-model', 'config.json')))
    src = open(os.path.join(root, 'src', 'audio', 'instrumentLabels.ts')).read()
    table = src[src.index('const LABELS'):src.index('};', src.index('const LABELS'))]
    mapping = dict(re.findall(r'"([^"]+)":\s*"([^"]+)"', table))
    clap = X[:, :512]; logits = X[:, 512:1039]; jam = X[:, 1039:1079]
    sig = 1 / (1 + np.exp(-logits.astype(np.float64)))
    ast = {}
    for i, name in config['id2label'].items():
        if name in mapping: ast[mapping[name]] = np.maximum(ast.get(mapping[name], 0), sig[:, int(i)])
    jam_classes = json.load(open(os.path.join(root, 'public', 'jamendo-model', 'mtg_jamendo_instrument-discogs-effnet-1.json')))['classes']
    lg = lambda p: np.log(np.clip(p, 1e-6, 1 - 1e-6) / (1 - np.clip(p, 1e-6, 1 - 1e-6)))
    feats = np.hstack([clap / np.maximum(np.linalg.norm(clap, axis=1, keepdims=True), 1e-8),
                       np.stack([lg(ast.get(l, np.zeros(len(X)))) for l in model['inputs']['ast']], 1),
                       np.stack([lg(jam[:, jam_classes.index(l)]) for l in model['inputs']['jamendo']], 1)])
    return {h['label']: (1 / (1 + np.exp(-np.clip(feats @ np.array(h['weights']) + h['bias'], -35, 35))), h['threshold']) for h in model['heads']}

def score(items, shown):
    out = {}
    for cls in MAP:
        tp = fp = fn = 0
        for it in items:
            if it['id'] not in shown: continue
            for r in it['reviews']:
                if r['label'] != cls: continue
                hit = cls in shown[it['id']]
                if r['state'] == 'present': tp += hit; fn += not hit
                else: fp += hit
        out[cls] = (tp / (tp + fp) if tp + fp else None, tp / (tp + fn) if tp + fn else None, tp + fn)
    return out

def main():
    model = json.load(open(sys.argv[1]))
    rows, X = load_features(sys.argv[2])
    probs = head_probs(model, X)
    by_id = {r['id']: k for k, r in enumerate(rows)}
    covered = set(probs) & set(MAP)
    for arg in sys.argv[3:]:
        name, rest = arg.split('=', 1); mpath, spath = rest.split(':')
        items = json.load(open(mpath))['items']
        base_rows = {r['id']: r for r in json.load(open(spath))}
        variants = {v: {} for v in ('base', 'union', 'override', 'shipped')}
        replaces = {h['label'] for h in model['heads'] if h.get('replaces')}
        for it in items:
            r = base_rows.get(it['id'])
            if r is None or it['id'] not in by_id: continue
            labels = {s['label'] for s in r['shown'] if s['dimension'] == 'source'}
            if os.environ.get('ADD_JAMENDO_RULE'):   # emulate PR #113's rule on records that predate it
                labels |= {FULL_MIX_JAMENDO[k] for k, v in r.get('jamendo', {}).items() if k in FULL_MIX_JAMENDO and v >= .4}
            base = {c for c, names in MAP.items() if labels & set(names)}
            k = by_id[it['id']]
            heads = {c for c in covered if probs[c][0][k] >= probs[c][1]}
            variants['base'][it['id']] = base
            variants['union'][it['id']] = base | heads
            variants['override'][it['id']] = (base - covered) | heads
            variants['shipped'][it['id']] = (base - replaces) | heads   # what src/audio/confidentSoundSummary.ts shows
        scored = {v: score(items, s) for v, s in variants.items()}
        print(f'\n{name}: {len(variants["base"])} clips')
        bar = float(os.environ.get('BAR', '0.7'))
        for v, s in scored.items():
            passing = sum(1 for p, r, n in s.values() if p is not None and r is not None and p >= bar and r >= bar and n >= 5)
            print(f'  {v:9s} pass {passing}/11 at {bar}: ' + '  '.join(f'{c[:5]} {p if p is None else round(p,2)}/{r if r is None else round(r,2)}' for c, (p, r, n) in s.items()))

if __name__ == '__main__':
    main()
