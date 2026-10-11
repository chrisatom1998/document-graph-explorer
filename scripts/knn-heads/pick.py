"""Best of both cutoff styles per tag (Chris, 1:56 am PT): keep kNN only where it passes better on the judge half and
loses no line against the board's base. Writes picks.json (every pick) and, with SHIP=<path>, the build.py input:
picks that gain a line and fire on at most 1% of negatives in each set with 50+ negatives (the board's false-alarm cap).
Note: when both cutoff styles qualify, the judge half breaks the tie (Chris's "best of both" rule), so a tie-broken
number is slightly optimistic; for the Oct 11 picks both styles passed the same lines (see the evaluation note)."""
import json, os, sys
ONLY = os.environ.get('ONLY')  # e.g. 'or': the app adds a head's tag to the tagger's (a union)
P = json.load(open(os.environ.get('PF', 'final-p.json'))); Bm = json.load(open(os.environ.get('BF', 'final-b.json')))
L = ['50/50', '60/60', '70/70', '50/30', '60/30']
mm = lambda per: sum(min(r['P'], r['R']) for r in per.values()) / len(per) if per else 0
picks, tot = {}, {l: [0, 0] for l in L}
for tag, e in P.items():
    if 'base' not in e or not e['base']['per']: continue
    base = e['base']; best = ('base', base, None)
    for mode, src in (('precision-first', P), ('balanced', Bm)):
        x = src[tag]; ch = ONLY or x.get('chosen', 'base')
        if ch == 'base' or ch not in x: continue
        if ONLY and x[ch]['cal'] <= x['base']['cal'] + 0.03: continue   # CAL must favour it too
        c = x[ch]
        if any(base['ok'][l] and not c['ok'][l] for l in L): continue           # no line may drop
        key = lambda o: (o['ok']['60/30'], sum(o['ok'][l] for l in L), mm(o['per']))
        if key(c) > key(best[1]): best = (f'{mode}:{ch}', c, x)
    for l in L: tot[l][0] += base['ok'][l]; tot[l][1] += best[1]['ok'][l]
    if best[0] != 'base':
        picks[tag] = dict(method=best[0], poolPos=e['poolPos'], output=e['output'], taggerCutoff=e['cutoff'], cutoff=best[1]['cut'], base=base, new=best[1])
json.dump(picks, open(os.environ.get('OUT', 'picks.json'), 'w'), indent=1)
def false_alarms(per):
    rates = []
    for r in per.values():
        tp = r['R'] * r['pos']; fp = tp / r['P'] - tp if r['P'] else 0
        if r['neg'] >= 50: rates.append(fp / r['neg'])
    return max(rates, default=0)
if os.environ.get('SHIP'):
    repo = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
    group = {c['label']: c['group'] for c in json.load(open(os.path.join(repo, 'src/audio/djCatalog.json')))['categories']}
    ship = {t: {'group': group[t], 'cutoff': p['cutoff'], 'method': p['method']} for t, p in picks.items()
            if any(p['new']['ok'][l] and not p['base']['ok'][l] for l in L) and false_alarms(p['new']['per']) <= 0.01}
    json.dump(ship, open(os.environ['SHIP'], 'w'), indent=1); print('ship:', sorted(ship))
for t, p in picks.items():
    f = lambda o: ' '.join(f"{n[:4]}:{r['P']:.2f}/{r['R']:.2f}({r['pos']})" for n, r in o['per'].items())
    print(f"{t:18s} {p['method']:22s} base {f(p['base'])} -> {f(p['new'])}  lines now {[l for l in L if p['new']['ok'][l]]}")
print({l: f'{a} -> {b}' for l, (a, b) in tot.items()})
