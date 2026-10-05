"""Scorecard: every head in public/sound-model/learned.json beside the held-out score it shipped on.

A head is matched to its report rows by label AND threshold. That is not a unique fingerprint (reports keep no
weights), so when several rows match with different scores the WEAKEST one is used and the head is marked
`ambiguous`, listing every source: a promotion must hold under every report that could describe the head.
Verdict under the user's 2026-10-05 bar: full tag needs precision AND recall >= 0.60; a maybe tag needs
the lower of the two >= 0.45 (the band round 14 used); below that the head should not show at all.
Read-only: it never edits learned.json. Heads with no matching row are listed as unverified.
Usage: head-scorecard.py [out.json]"""
import json, glob, sys

FULL, MAYBE = 0.60, 0.45
heads = json.load(open('public/sound-model/learned.json'))['heads']
rows = []   # (label, threshold, precision, recall, testPositive, source)
for f in sorted(glob.glob('docs/evaluations/*/*.json')):
    try: d = json.load(open(f))
    except (ValueError, UnicodeDecodeError): continue
    if not isinstance(d, dict): continue
    for key in ('heads', 'updates', 'results'):
        for r in d.get(key) or []:
            if not isinstance(r, dict): continue
            label = r.get('label') or r.get('name')
            if 'precision' in r and r.get('threshold') is not None and label:
                rows.append((label, round(float(r['threshold']), 3), r['precision'], r['recall'], r.get('testPositive'), f.split('/')[-1]))
            for name, s in (r.get('setups') or {}).items():   # character-head comparisons
                if isinstance(s, dict) and 'precision' in s and label:
                    rows.append((label, round(float(s['threshold']), 3), s['precision'], s['recall'], r.get('testPositive'), f'{f.split("/")[-1]}:{name}'))
out = []
for h in heads:
    match = [r for r in rows if r[0] == h['label'] and abs(r[1] - h['threshold']) < 6e-4]
    shown = 'maybe' if h.get('maybe') else 'full'
    if not match:
        out.append({'label': h['label'], 'group': h['group'], 'shown': shown, 'verdict': 'unverified'}); continue
    label, _, p, r, n, src = min(match, key=lambda m: min(m[2], m[3])); low = min(p, r)
    distinct = {(round(m[2], 4), round(m[3], 4)) for m in match}
    should = 'full' if low >= FULL else 'maybe' if low >= MAYBE else 'hide'
    out.append({'label': h['label'], 'group': h['group'], 'shown': shown, 'precision': p, 'recall': r, 'testPositive': n, 'source': src,
                'should': should, 'verdict': 'ok' if should == shown else f'{shown} -> {should}',
                **({'ambiguous': sorted({m[5] for m in match})} if len(distinct) > 1 else {})})
order = {'full -> hide': 0, 'maybe -> hide': 1, 'full -> maybe': 2, 'maybe -> full': 3, 'unverified': 4, 'ok': 5}
for o in sorted(out, key=lambda o: (order.get(o['verdict'], 9), o['label'])):
    score = f"{o['precision']:4.0%} / {o['recall']:4.0%}  n={o['testPositive']}" if 'precision' in o else '      no matching report row'
    print(f"{o['verdict']:<14} {o['label']:<18} shown {o['shown']:<5}  {score}  {o.get('source', '')}" + ('  (weakest of ' + ', '.join(o['ambiguous']) + ')' if 'ambiguous' in o else ''))
from collections import Counter
print('\n', dict(Counter(o['verdict'] for o in out)))
if len(sys.argv) > 1: json.dump({'kind': 'head-scorecard-v1', 'bars': {'full': FULL, 'maybe': MAYBE}, 'heads': out}, open(sys.argv[1], 'w'), indent=1)
