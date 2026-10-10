"""Score pilot heads and the shipped heads on the locked holdout from CLAP embeddings, per label and duration route.

Usage: python3 -I scripts/licensed-pilot/score_offline.py <holdout.json> <holdout.jsonl> <pilot heads.json> <main learned.json> <out.json>
<holdout.jsonl>: scripts/embed-clap.mjs over the holdout files (the app's own CLAP embedding of the first 10 s).
The app scores long files over every 10 s window and keeps the max, so this is the first-window view of the full-mode
route; it is a screen, not a replacement for run_app.sh. "ceiling" is the best min(P, R) any threshold reaches on the
holdout itself. It is diagnostic only and never used to choose a threshold: if even the ceiling is under the ship bar,
no threshold the training data could pick would clear it.
"""
import json, math, sys

HOLD, EMB, PILOT, MAIN, OUT = sys.argv[1:6]
items = json.load(open(HOLD))['items']
emb = {}
for line in open(EMB):
    r = json.loads(line); n = math.sqrt(sum(x * x for x in r['embedding'])); emb[r['id']] = [x / n for x in r['embedding']]
sets = {'pilot': {h['label']: h for h in json.load(open(PILOT))['heads']},
        'main': {h['label']: h for h in json.load(open(MAIN))['heads']}}
labels = json.load(open(HOLD))['labels']

def prob(h, v):
    return 1 / (1 + math.exp(-(h['bias'] + sum(a * b for a, b in zip(h['weights'], v)))))

def pr(rows, t):
    pos = sum(y for _, y in rows); tp = sum(s >= t and y == 1 for s, y in rows); fp = sum(s >= t and y == 0 for s, y in rows)
    return (tp / (tp + fp) if tp + fp else None), (tp / pos if pos else None), tp, fp

report = {'missing_embeddings': sum(i['id'] not in emb for i in items), 'heads': {}}
for name, heads in sets.items():
    for label in labels:
        h = heads.get(label)
        if not h: continue
        out = report['heads'].setdefault(f'{name}:{label}', {'threshold': h['threshold']})
        for route in ('short', 'long'):
            rows = [(prob(h, emb[i['id']]), i['labels'][label]) for i in items
                    if i['short'] == (route == 'short') and i['id'] in emb and i['labels'][label] is not None]
            P, R, tp, fp = pr(rows, h['threshold'])
            best = max(((min(p or 0, r or 0), t) for t in [x / 100 for x in range(1, 100)] for p, r, _, _ in [pr(rows, t)]))
            out[route] = {'support_pos': sum(y for _, y in rows), 'support_neg': sum(1 - y for _, y in rows),
                          'precision': P and round(P, 3), 'recall': R and round(R, 3), 'tp': tp, 'false_positives': fp,
                          'ceiling_min_pr': round(best[0], 3), 'ceiling_threshold': best[1]}
            print(f"{name:5s} {label:11s} {route:5s} +{out[route]['support_pos']:2d} P {out[route]['precision']} R {out[route]['recall']} fp {fp}  ceiling {best[0]:.2f}")
json.dump(report, open(OUT, 'w'), indent=1)
