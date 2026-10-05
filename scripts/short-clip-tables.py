"""Markdown before/after tables from short-clip report.json files.
Usage: python3 scripts/short-clip-tables.py baseline=<dir> after-v1=<dir> v2=<dir>"""
import json, sys
runs = [(a.split('=')[0], json.load(open(a.split('=')[1] + '/report.json'))) for a in sys.argv[1:]]
first = runs[0][1]['displayedIncludingMaybe']
fmt = lambda v: '—' if v is None else f'{v:.2f}'
ci = lambda v: '' if not v else f' ({v[0]:.2f}–{v[1]:.2f})'
print('| Category | Positives / families | ' + ' | '.join(f'{n} P / R' for n, _ in runs) + f' | {runs[-1][0]} TP / FP / FN | Meets 70/70 |')
print('|---|---|' + '---|' * len(runs) + '---|---|')
for cat in first:
    last = runs[-1][1]['displayedIncludingMaybe'][cat]
    if last['positives'] == 0 and last['falseDetections'] == 0 and all(r['displayedIncludingMaybe'][cat]['falseDetections'] == 0 for _, r in runs): continue
    cells = [f"{fmt(r['displayedIncludingMaybe'][cat]['precision'])} / {fmt(r['displayedIncludingMaybe'][cat]['recall'])}" for _, r in runs]
    print(f"| {cat} | {last['positives']} / {last['positiveFamilies']} | " + ' | '.join(cells)
          + f" | {last['truePositives']} / {last['falseDetections']} / {last['misses']} | {'yes' if last['meetsTarget'] else 'no'} |")
print()
print(f'Final-run 95% family-bootstrap intervals ({runs[-1][0]}):')
print()
print('| Category | Precision | Recall |')
print('|---|---|---|')
for cat, v in runs[-1][1]['displayedIncludingMaybe'].items():
    if v['positives']: print(f"| {cat} | {fmt(v['precision'])}{ci(v['precisionCI95'])} | {fmt(v['recall'])}{ci(v['recallCI95'])} |")
print()
for n, r in runs:
    print(f"- {n}: {sum(v['meetsTarget'] for v in r['displayedIncludingMaybe'].values())} categories meet 70/70; "
          f"clips with no scored tag {r['clipsWithNoScoredTag']}/{r['items']}; musical {r['musical']}")
