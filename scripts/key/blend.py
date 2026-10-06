"""Choose PROFILE_WEIGHT (src/audio/keyCnn.ts): how much Essentia's stock key profile counts against the key network.

The network reads songs better and the stock profile reads clean loops better. The weight is chosen on one half of
the FSL10K drumless loops and one half of the GiantSteps key set (both split by a seeded hash), then the other
halves, round 2's 500 and the GTZAN test half are each scored once.
Usage: python3 scripts/key/blend.py <features dir> <fsl10k loop-keys.json> [weight]   (weight given: score only)
"""
import gzip, hashlib, json, math, sys

feat_dir, loops_path = sys.argv[1:3]
fixed = float(sys.argv[3]) if len(sys.argv) > 3 else None
half = lambda tag, i: int(hashlib.sha256(f'{tag}|{i}'.encode()).hexdigest()[:8], 16) % 2

def recording(probabilities, profile_keys, count, w):
    """recordingKeyFromProbabilities in src/audio/keyCnn.ts."""
    if not probabilities or len(probabilities) < math.ceil(count / 2): return None
    mean = [sum(p[i] for p in probabilities) / len(probabilities) for i in range(24)]
    score = [math.log(max(v, 1e-9)) for v in mean]
    for k in profile_keys:
        if k: score[k['tonic'] + 12 * (k['mode'] == 'minor')] += w * min(1, k['strength']) / len(probabilities)
    b = score.index(max(score))
    return {'tonic': b % 12, 'mode': 'major' if b < 12 else 'minor'}

def song_cases(set_name, plan_suffix=None):
    out = []
    for r in json.load(gzip.open(f'{feat_dir}/{set_name}.json.gz')):
        if r.get('error') or (plan_suffix and not r['id'].endswith(plan_suffix)): continue
        tonal = [e for e in r['excerpts'] if not (e.get('pitch') and e['pitch']['confidence'] >= .9) and e['seconds'] >= 3 and e['diverse']]
        out.append({'id': r['track'], 'truth': r['truth'], 'count': r['excerptCount'],
                    'p': [e['cnn'] for e in tonal], 'k': [e.get('bgate') for e in tonal]})
    return out

loops = [{'id': r['id'], 'truth': r['truth'], 'count': 1, 'p': [r['probabilities']] if r.get('probabilities') else [],
          'k': [r.get('bgateRaw')] if r.get('probabilities') else []} for r in json.load(open(loops_path))]
gs10, gssong = song_cases('gs-key', '-mid10'), song_cases('gs-key', '-song')
sets = {
    'FSL10K loops, tuning half': [c for c in loops if half('fsl-split', c['id']) == 0],
    'GiantSteps key 10 s, tuning half': [c for c in gs10 if half('gs-blend', c['id']) == 0],
    'GiantSteps key preview, tuning half': [c for c in gssong if half('gs-blend', c['id']) == 0],
    'FSL10K loops, judging half': [c for c in loops if half('fsl-split', c['id']) == 1],
    'GiantSteps key 10 s, judging half': [c for c in gs10 if half('gs-blend', c['id']) == 1],
    'GiantSteps key preview, judging half': [c for c in gssong if half('gs-blend', c['id']) == 1],
    "Round 2's 500 (confident key)": song_cases('mtg-500'),
    'GTZAN test half': song_cases('test-gtzan'),
}
exact = lambda cases, w: sum((k := recording(c['p'], c['k'], c['count'], w)) is not None and k == c['truth'] for c in cases) / len(cases)
tuning = [n for n in sets if 'tuning half' in n]
if fixed is None:
    grid = [0, .5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8]
    for w in grid: print(f'w={w:<4}', '  '.join(f'{exact(sets[n], w):.3f}' for n in tuning))
    # Mean exact over the three tuning sets, so loops and songs count equally.
    fixed = max(grid, key=lambda w: sum(exact(sets[n], w) for n in tuning))
    print('chosen weight', fixed)
for n, cases in sets.items():
    if 'tuning half' in n: continue
    print(f'{n:40s} n={len(cases):4d}  network {exact(cases, 0):.1%}  blend {exact(cases, fixed):.1%}  profile first {exact(cases, 1e3):.1%}')
