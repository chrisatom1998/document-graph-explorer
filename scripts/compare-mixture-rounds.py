"""Side-by-side: each sound's isolated and mixture scores without and with mixture training.

A sound "improves" when its mixture score (the lower of precision and recall) rises and its isolated
score falls by at most DROP. Scores are the lower of precision and recall, as the ship bars use.
Usage: compare-mixture-rounds.py <baseline round.json> <mixture round.json> [out.json]"""
import json, sys

DROP = 0.02
base = {r['name']: r for r in json.load(open(sys.argv[1]))['results'] if r['kind'] == 'label'}
mix = {r['name']: r for r in json.load(open(sys.argv[2]))['results'] if r['kind'] == 'label'}
low = lambda d: min(d['precision'], d['recall'])
rows = []
for name in sorted(base):
    a, b = base[name], mix.get(name, {})
    if 'mixture' not in a or 'mixture' not in b or 'precision' not in a or 'precision' not in b: continue
    row = {'name': name, 'isolated': [low(a), low(b)], 'mixture': [low(a['mixture']), low(b['mixture'])],
           'mixPrecision': [a['mixture']['precision'], b['mixture']['precision']], 'mixRecall': [a['mixture']['recall'], b['mixture']['recall']],
           'buriedRecall': [a['mixture']['buried']['recall'], b['mixture']['buried']['recall']],
           'mixPositive': a['mixture']['positive'], 'testedOn': a['testedOn']}
    row['improves'] = row['mixture'][1] > row['mixture'][0] and row['isolated'][1] >= row['isolated'][0] - DROP
    rows.append(row)
pct = lambda v: f'{v:4.0%}'
print(f"{'sound':<17}{'isolated':>14}{'in mixes':>14}{'mix prec':>14}{'mix recall':>14}{'buried recall':>16}")
for r in sorted(rows, key=lambda r: r['mixture'][0] - r['mixture'][1]):
    print(f"{r['name']:<17}" + ''.join(f"{pct(x[0]):>8}->{pct(x[1])}" for x in (r['isolated'], r['mixture'], r['mixPrecision'], r['mixRecall'], r['buriedRecall']))
          + ('   better' if r['improves'] else ''))
print(f"\n{sum(r['improves'] for r in rows)} of {len(rows)} sounds better in mixes without losing more than {DROP:.0%} isolated")
if len(sys.argv) > 3: json.dump({'kind': 'mixture-comparison-v1', 'drop': DROP, 'rows': rows}, open(sys.argv[3], 'w'), indent=1)
