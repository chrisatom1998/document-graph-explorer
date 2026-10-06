"""Append selected candidate heads to the shipped short-clip model without touching its existing heads.

Each candidate head is re-expressed in the shipped model's standardisation: for x standardised as (x - m_c) / s_c
in the candidate and (x - m_s) / s_s in the shipped model, w' = w * s_s / s_c and b' = b + sum(w * (m_s - m_c) / s_c),
so every logit is unchanged up to rounding. Updates public/sound-model/manifest.json and src/audio/calibratedLabels.json.
Usage: python merge_new_heads.py <candidate.json> group:label [group:label ...]
  e.g. python merge_new_heads.py short-clip-candidate.json character:distorted character:reverberant production:beatbox source:horn"""
import hashlib, json, os, sys
import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
SHIPPED = f'{ROOT}/public/sound-model/short-clip.json'
cand_path, wanted = sys.argv[1], {tuple(a.split(':', 1)) for a in sys.argv[2:]}
s, c = json.load(open(SHIPPED)), json.load(open(cand_path))
assert s['blocks'] == c['blocks'] and wanted
ms, ss, mc, sc = (np.array(v) for v in (s['mean'], s['std'], c['mean'], c['std']))
have = {(h['group'], h['label']) for h in s['heads']}
assert not wanted & have, f'already shipped: {wanted & have}'
add = []
for h in c['heads']:
    if (h['group'], h['label']) not in wanted: continue
    w = np.array(h['weights'])
    add.append(dict(h, weights=[round(float(v), 6) for v in w * ss / sc], bias=round(h['bias'] + float(np.sum(w * (ms - mc) / sc)), 6)))
assert {(h['group'], h['label']) for h in add} == wanted, 'a requested head is not in the candidate'
s['revision'] += '+public-new-coverage-2026-10-05'
s['heads'] += add
open(SHIPPED, 'w').write(json.dumps(s, separators=(',', ':')))
mp = f'{ROOT}/public/sound-model/manifest.json'
text = open(mp).read(); old = json.loads(text)['sha256']['short-clip.json']
open(mp, 'w').write(text.replace(old, hashlib.sha256(open(SHIPPED, 'rb').read()).hexdigest()))
labels = sorted({h['label'] for f in (f'{ROOT}/public/sound-model/learned.json', SHIPPED) for h in json.load(open(f))['heads']})
json.dump(labels, open(f'{ROOT}/src/audio/calibratedLabels.json', 'w'), indent=0); open(f'{ROOT}/src/audio/calibratedLabels.json', 'a').write('\n')
print(f'added {len(add)} heads; model now has {len(s["heads"])}')
