"""Put a pilot CLAP head into public/sound-model/short-clip.json, so it runs only on clips of at most 2.25 s.

Usage: python3 -I scripts/licensed-pilot/apply_short_clip_head.py <heads.json> <label> <revision tag>

A pilot head scores the unit CLAP embedding u: logit = b + w.u. short-clip.json scores the same embedding (its
clapRepeat block is the app's normal CLAP fingerprint of a short clip) after standardising it with the file's mean and
std: logit = b' + w'.((u - mean) / std). So w' = w * std and b' = b + w.mean give exactly the same score and threshold.
The label's existing short-clip head is replaced (the evaluation records the holdout evidence); learned.json is not
touched, so longer clips keep today's analysis. Re-pins short-clip.json in manifest.json, appends the revision tag and
rewrites src/audio/calibratedLabels.json as apply_heads.py does.
INSTRUMENT_ANALYSIS_REVISION in src/audio/musicTypes.ts is bumped by hand in the same commit.
"""
import hashlib, json, math, sys

HEADS, LABEL, TAG = sys.argv[1:4]
SHORT, MANIFEST = 'public/sound-model/short-clip.json', 'public/sound-model/manifest.json'
head = next(h for h in json.load(open(HEADS))['heads'] if h['label'] == LABEL)
model = json.load(open(SHORT))
assert model['blocks'] == ['clapRepeat'], 'conversion assumes the clapRepeat block alone'
assert len(head['weights']) == len(model['mean']) == 512 and 0.5 <= head['threshold'] <= 1, 'malformed head'
w, mean, std = head['weights'], model['mean'], model['std']
converted = {'group': head['group'], 'label': LABEL, 'weights': [a * s for a, s in zip(w, std)],
             'bias': head['bias'] + sum(a * m for a, m in zip(w, mean)), 'threshold': head['threshold']}
old = [h for h in model['heads'] if h['label'] == LABEL]
model['heads'] = [h if h['label'] != LABEL else converted for h in model['heads']] if old else model['heads'] + [converted]
model['revision'] += '+' + TAG
values = converted['weights'] + [converted['bias'], converted['threshold']] + head['weights'] + [head['bias']]
assert all(math.isfinite(v) for v in values), 'non-finite head value'
body = json.dumps(model, separators=(',', ':'), allow_nan=False)
open(SHORT, 'w').write(body)
manifest = json.load(open(MANIFEST))
manifest['sha256']['short-clip.json'] = hashlib.sha256(body.encode()).hexdigest()
open(MANIFEST, 'w').write(json.dumps(manifest, indent=2) + '\n')
# Same detector list as apply_heads.py: every label with a learned or short-clip head.
labels = sorted({x['label'] for f in ('public/sound-model/learned.json', SHORT) for x in json.load(open(f))['heads']})
open('src/audio/calibratedLabels.json', 'w').write(json.dumps(labels, indent=0) + '\n')
print(f"{LABEL}: {'replaced' if old else 'added'} short-clip head, threshold {head['threshold']}")
