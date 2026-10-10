"""Score pilot heads and the shipped heads on the locked holdout from CLAP embeddings, per label and duration route.

Usage: python3 -I scripts/licensed-pilot/score_offline.py <holdout.json> <holdout.jsonl> <pilot heads.json> <main learned.json> <out.json>
<holdout.jsonl>: scripts/embed-clap.mjs over the holdout files (the app's own CLAP embedding of the first 10 s).
The app scores long files over every 10 s window and keeps the max, so this is the first-window view of the full-mode
route; it is a screen, not a replacement for run_app.sh. "ceiling" is the best min(P, R) any threshold reaches on the
holdout itself, searched over every observed score. It is diagnostic only and never used to choose a threshold: if
even the ceiling is under the ship bar, no threshold the training data could pick would clear it.
Every locked item is scored. A file embed-clap.mjs skipped (under 0.1 s) is listed and counted as never firing: a
miss when it is a positive, never a false positive. Its ceiling is also given as if every skipped positive were found.
"""
import hashlib, json, math, os, sys

HOLD, EMB, PILOT, MAIN, OUT = sys.argv[1:6]
if hashlib.sha256(open(HOLD, 'rb').read()).hexdigest() != open(os.path.join(os.path.dirname(HOLD), 'holdout.lock')).read().split()[0]:
    sys.exit(f'{HOLD} does not match holdout.lock')
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
    fire = lambda s: s is not None and s >= t
    pos = sum(y for _, y in rows); tp = sum(fire(s) and y == 1 for s, y in rows); fp = sum(fire(s) and y == 0 for s, y in rows)
    return (tp / (tp + fp) if tp + fp else None), (tp / pos if pos else None), tp, fp

def ceiling(rows):
    cuts = sorted({s for s, _ in rows if s is not None}) or [1.0]
    return max((min(p or 0, r or 0), t) for t in cuts for p, r, _, _ in [pr(rows, t)])

missing = [i['id'] for i in items if i['id'] not in emb]
unexpected_missing = [i['id'] for i in items if i['id'] not in emb
                      and not (isinstance(i.get('seconds'), (int, float))
                               and not isinstance(i['seconds'], bool)
                               and math.isfinite(i['seconds']) and 0 < i['seconds'] < 0.1)]
if unexpected_missing:
    sys.exit(f'{len(unexpected_missing)} holdout embeddings missing outside the documented under-0.1 s exception; rerun embedding before scoring')
report = {'missing_embeddings': len(missing), 'missing_ids': missing, 'heads': {}}
for name, heads in sets.items():
    for label in labels:
        h = heads.get(label)
        if not h: continue
        out = report['heads'].setdefault(f'{name}:{label}', {'threshold': h['threshold']})
        for route in ('short', 'long'):
            rows = [(prob(h, emb[i['id']]) if i['id'] in emb else None, i['labels'][label]) for i in items
                    if i['short'] == (route == 'short') and i['labels'][label] is not None]
            P, R, tp, fp = pr(rows, h['threshold'])
            best = ceiling(rows)
            best_found = ceiling([(1.0 if s is None and y == 1 else s, y) for s, y in rows])
            out[route] = {'support_pos': sum(y for _, y in rows), 'support_neg': sum(1 - y for _, y in rows),
                          'precision': P and round(P, 3), 'recall': R and round(R, 3), 'tp': tp, 'false_positives': fp,
                          'ceiling_min_pr': round(best[0], 3), 'ceiling_threshold': round(best[1], 4),
                          'ceiling_if_skipped_positives_found': round(best_found[0], 3),
                          'skipped_positives': sum(s is None and y == 1 for s, y in rows)}
            print(f"{name:5s} {label:11s} {route:5s} +{out[route]['support_pos']:2d} P {out[route]['precision']} R {out[route]['recall']} fp {fp}  ceiling {best[0]:.2f} ({best_found[0]:.2f} if skipped found)")
json.dump(report, open(OUT, 'w'), indent=1)
