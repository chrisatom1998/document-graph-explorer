"""Apply the lower-only threshold rules fixed in docs/evaluations/all-tags-2026-10-06/PREREGISTRATION.md.

Usage: python3 scripts/all-tags/calibrate.py <jamendo-val-manifest.json> <records.json> <out.json>

Records come from scripts/dj-fix/extract.mjs on the run's graph exports (all windows of 30 s songs are whole 10 s
windows, so a record's per-model maximum is the best whole-window score). A rule shows the tag when it is already shown
OR one stored score source reaches t. Sources: the fusion head probability, and each native model's score.
"""
import json, sys

MAP = {
    'drums': ['drums', 'drum kit', 'drum machine'], 'voice': ['voice', 'singing'], 'synthesizer': ['synthesizer'], 'piano': ['piano'],
    'electric piano': ['electric piano'], 'guitar': ['guitar', 'acoustic guitar', 'electric guitar', 'steel guitar'],
    'acoustic guitar': ['acoustic guitar', 'steel guitar'], 'electric guitar': ['electric guitar'], 'bass guitar': ['bass guitar', 'bass', 'double bass'],
    'organ': ['organ'], 'violin / fiddle': ['violin / fiddle', 'violin', 'fiddle'], 'cello': ['cello'], 'strings': ['strings', 'string section'],
    'trumpet': ['trumpet'], 'trombone': ['trombone'], 'horn': ['horn', 'french horn'], 'saxophone': ['saxophone'], 'clarinet': ['clarinet'], 'oboe': ['oboe'],
    'flute': ['flute'], 'harp': ['harp'], 'accordion': ['accordion'], 'harmonica': ['harmonica'], 'atmospheric pad': ['atmospheric pad'],
    'chiptune synth': ['chiptune synth'], 'choir': ['choir'],
}
BAR, MIN_POS, MIN_GAIN, GRID = .70, 20, .10, [round(.05 * i, 2) for i in range(1, 20)]
man, recs, out = sys.argv[1:4]
items = {i['id']: i for i in json.load(open(man))['items']}
rows = {r['id']: r for r in json.load(open(recs)) if r['id'] in items}

def sources(r, tag):
    """Best score per stored source for this tag."""
    names, s = MAP[tag], {}
    for label, f in r['fusion'].items():
        if label.replace('_', ' ') in names: s['fusion head'] = max(s.get('fusion head', 0), f['head'])
    for model, scores in r['native'].items():
        for key, v in scores.items():
            if key.split(':', 1)[1] in names: s[f'{model} native'] = max(s.get(f'{model} native', 0), v)
    return s

def score(tag, half, rule=None):
    tp = fp = pos = 0
    for k, r in rows.items():
        it = items[k]
        if half != 'all' and it['half'] != half: continue
        lab = next((x for x in it['reviews'] if x['label'] == tag), None)
        if not lab: continue
        hit = any(s['label'] in MAP[tag] for s in r['shown'])
        if rule and not hit: hit = sources(r, tag).get(rule[0], 0) >= rule[1]
        if lab['state'] == 'present': pos += 1; tp += hit
        elif hit: fp += 1
    return {'recall': round(tp / pos, 3) if pos else None, 'precisionFloor': round(tp / (tp + fp), 3) if tp + fp else None, 'positives': pos}

report = {}
for tag in MAP:
    base = {h: score(tag, h) for h in ('pick', 'check', 'all')}
    entry = {'main': base, 'rule': None, 'adopted': False, 'why': ''}
    report[tag] = entry
    if base['all']['positives'] < MIN_POS: entry['why'] = 'too few to judge'; continue
    if (base['pick']['recall'] or 0) >= BAR: entry['why'] = 'recall already at 0.70 on pick'; continue
    srcs = sorted({s for r in rows.values() for s in sources(r, tag)})
    best = None
    for src in srcs:
        for t in GRID:                      # lowest t whose pick-half precision floor holds 0.70
            p = score(tag, 'pick', (src, t))
            if (p['precisionFloor'] or 0) >= BAR:
                if not best or p['recall'] > best[2]['recall']: best = (src, t, p)
                break
    if not best: entry['why'] = 'no source and threshold keeps the precision floor at 0.70 on pick'; continue
    chk = score(tag, 'check', best[:2])
    entry['rule'] = {'source': best[0], 'threshold': best[1], 'pick': best[2], 'check': chk, 'all': score(tag, 'all', best[:2])}
    gain = (chk['recall'] or 0) - (base['check']['recall'] or 0)
    entry['adopted'] = gain >= MIN_GAIN and (chk['precisionFloor'] or 0) >= BAR
    entry['why'] = 'check half confirms' if entry['adopted'] else f'check half: recall +{gain:.2f}, precision floor {chk["precisionFloor"]}'
json.dump(report, open(out, 'w'), indent=1)
for tag, e in report.items():
    m = e['main']['all']; r = e['rule']
    print(f"{tag:18} main R {m['recall']} P>= {m['precisionFloor']} ({m['positives']})"
          + (f" | {r['source']} >= {r['threshold']}: check R {r['check']['recall']} P>= {r['check']['precisionFloor']}" if r else '')
          + f" | {'ADOPT' if e['adopted'] else e['why']}")
