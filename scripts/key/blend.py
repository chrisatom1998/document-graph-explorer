"""Choose PROFILE_WEIGHT and SHORT_SECONDS (src/audio/keyCnn.ts): how much Essentia's stock key profile counts
against the key network, and for recordings shorter than how many seconds.

The network reads songs better and the stock profile reads clean loops better. A weight for every recording costs
songs about 3 points (tried first: weight 1.5 chosen on the tuning halves gave GTZAN 74% -> 70%), and neither the
profile's strength nor the network's certainty separates loops from songs, so the profile only counts for short
files. Weight and cut-off are chosen on one half of the FSL10K drumless loops and one half of the GiantSteps key set
(seeded hash), then the other halves, round 2's 500 and the GTZAN test half are each scored once.
Usage: python3 scripts/key/blend.py <features dir> <loops.json (scripts/key/loop-keys.mjs, plus seconds)> [weight cut]
"""
import gzip, hashlib, json, math, sys

feat_dir, loops_path = sys.argv[1:3]
fixed = (float(sys.argv[3]), float(sys.argv[4])) if len(sys.argv) > 4 else None
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
        out.append({'id': r['track'], 'truth': r['truth'], 'count': r['excerptCount'], 'seconds': r['duration'] if r['plan'] == 'song' else r['seconds'],
                    'p': [e['cnn'] for e in tonal], 'k': [e.get('bgate') for e in tonal]})
    return out

loops = [{'id': r['id'], 'truth': r['truth'], 'count': 1, 'seconds': r['seconds'], 'p': [r['probabilities']] if r.get('probabilities') else [],
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
def exact(cases, rule):
    w, cut = rule
    return sum((k := recording(c['p'], c['k'], c['count'], w if c['seconds'] < cut else 0)) is not None and k == c['truth'] for c in cases) / len(cases)
tuning = [n for n in sets if 'tuning half' in n]
if fixed is None:
    grid = [(w, cut) for cut in (6, 8, 10, 12, 20, 30, 1e9) for w in (1.5, 3, 10)]
    for rule in grid: print(f'weight {rule[0]:<4} under {rule[1]:<5g} s', '  '.join(f'{exact(sets[n], rule):.3f}' for n in tuning))
    # Best mean over the tuning halves among rules that cost no tuning song set anything.
    safe = [r for r in grid if all(exact(sets[n], r) >= exact(sets[n], (0, 0)) for n in tuning if 'FSL' not in n)]
    fixed = max(safe, key=lambda r: sum(exact(sets[n], r) for n in tuning))
    print('chosen: weight', fixed[0], 'under', fixed[1], 's')
for n, cases in sets.items():
    if 'tuning half' in n: continue
    print(f'{n:40s} n={len(cases):4d}  network {exact(cases, (0, 0)):.1%}  with the rule {exact(cases, fixed):.1%}')
