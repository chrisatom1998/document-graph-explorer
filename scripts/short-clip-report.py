"""Per-category precision/recall of what DGE displayed, with family-bootstrap 95% intervals.

Usage: python3 scripts/short-clip-report.py <run-dir> [split=test] > report.json
<run-dir> holds r-predictions-all.json, r-predictions-full.json, r-displayed.json (from short-clip-displayed.ts) and run.json.
Only explicit present/absent labels count; unknown labels are skipped, never treated as absent.
A present label with nothing displayed is a miss, whether the detector abstained or scored low.
"""
import json, sys, random, os
from collections import defaultdict

run, split = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else 'test')
ROOT = os.path.join(os.path.dirname(__file__), '..')
B = os.environ.get('BENCH', f'{ROOT}/docs/evaluations/short-clips-2026-10-04')
manifest = json.load(open(f'{B}/manifest.json'))
meta = json.load(open(f'{B}/item-meta.json'))
items = [i for i in manifest['items'] if i['split'] == split]
rows = {r['itemId']: r for r in json.load(open(f'{run}/r-displayed.json'))}
TARGET = .70

def score(pred_file):
    pred = {(p['itemId'], p['dimension'], p['label']) for p in json.load(open(pred_file))}
    per = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))   # cat -> family -> [tp, fp, fn]
    counts = defaultdict(lambda: dict(tp=0, fp=0, fn=0, tn=0, pos=0, neg=0, posFamilies=set(), negFamilies=set(), missedNotAnalysed=0))
    for it in items:
        fam = it['groups']['artist']; analysed = it['id'] in rows
        for r in it['reviews']:
            if r['state'] not in ('present', 'absent'): continue
            cat = f"{r['dimension']}:{r['label']}"; c = counts[cat]; hit = (it['id'], r['dimension'], r['label']) in pred
            if r['state'] == 'present':
                c['pos'] += 1; c['posFamilies'].add(fam)
                if hit: c['tp'] += 1; per[cat][fam][0] += 1
                else:
                    c['fn'] += 1; per[cat][fam][2] += 1
                    if not analysed: c['missedNotAnalysed'] += 1
            else:
                c['neg'] += 1; c['negFamilies'].add(fam)
                if hit: c['fp'] += 1; per[cat][fam][1] += 1
                else: c['tn'] += 1
    out = {}
    for cat, c in sorted(counts.items()):
        P = c['tp'] / (c['tp'] + c['fp']) if c['tp'] + c['fp'] else None
        R = c['tp'] / c['pos'] if c['pos'] else None
        fams = list(per[cat].values()); rng = random.Random(7); ps, rs = [], []
        for _ in range(2000):
            s = [fams[rng.randrange(len(fams))] for _ in fams] if fams else []
            tp = sum(f[0] for f in s); fp = sum(f[1] for f in s); fn = sum(f[2] for f in s)
            if tp + fp: ps.append(tp / (tp + fp))
            if tp + fn: rs.append(tp / (tp + fn))
        ci = lambda v: [round(sorted(v)[int(len(v) * .025)], 3), round(sorted(v)[min(len(v) - 1, int(len(v) * .975))], 3)] if len(v) >= 1000 else None
        out[cat] = dict(precision=None if P is None else round(P, 3), recall=None if R is None else round(R, 3),
                        precisionCI95=ci(ps), recallCI95=ci(rs), truePositives=c['tp'], falseDetections=c['fp'], misses=c['fn'],
                        positives=c['pos'], negatives=c['neg'], positiveFamilies=len(c['posFamilies']), negativeFamilies=len(c['negFamilies']),
                        detections=c['tp'] + c['fp'], abstainedOnPositives=c['fn'], missesNotAnalysed=c['missedNotAnalysed'],
                        meetsTarget=bool(P is not None and R is not None and P >= TARGET and R >= TARGET))
    return out

def musical():
    """Tempo/key must abstain on single events; pitch is scored on NSynth notes only."""
    res = dict(keyShown=0, tempoShown=0, singleEvents=0, pitchNotes=0, pitchShown=0, pitchCorrect=0, pitchWrong=0)
    for it in items:
        r = rows.get(it['id']); m = meta.get(it['id'], {})
        if not r: continue
        if m.get('dataset') in ('nsynth', 'avp'):
            res['singleEvents'] += 1; res['keyShown'] += bool(r['key']); res['tempoShown'] += bool(r['tempo'])
        if m.get('dataset') == 'nsynth':
            res['pitchNotes'] += 1
            if r['detectedPitch']:
                res['pitchShown'] += 1
                if r['detectedPitch']['pitchClass'] == m['pitchClass']: res['pitchCorrect'] += 1
                else: res['pitchWrong'] += 1
    res['pitchPrecision'] = round(res['pitchCorrect'] / res['pitchShown'], 3) if res['pitchShown'] else None
    res['pitchRecall'] = round(res['pitchCorrect'] / res['pitchNotes'], 3) if res['pitchNotes'] else None
    return res

def slices(pred_file):
    """Recall on quiet clips and by duration, pooled over present labels."""
    pred = {(p['itemId'], p['dimension'], p['label']) for p in json.load(open(pred_file))}
    s = defaultdict(lambda: [0, 0])
    for it in items:
        m = meta.get(it['id'], {}); d = m.get('durationSeconds', 0)
        keys = ['quiet' if m.get('quiet') else 'normal level', '<=1.0 s' if d <= 1.0 else '1.0-2.25 s', m.get('dataset', '?')]
        for r in it['reviews']:
            if r['state'] != 'present' or r['dimension'] == 'musical': continue
            for k in keys: s[k][1] += 1; s[k][0] += (it['id'], r['dimension'], r['label']) in pred
    return {k: dict(found=v[0], positives=v[1], recall=round(v[0] / v[1], 3)) for k, v in sorted(s.items())}

runinfo = json.load(open(f'{run}/run.json')) if os.path.exists(f'{run}/run.json') else {}
print(json.dumps({'split': split, 'items': len(items), 'analysed': sum(i['id'] in rows for i in items),
                  'families': len({i['groups']['artist'] for i in items}), 'target': TARGET,
                  'displayedIncludingMaybe': score(f'{run}/r-predictions-all.json'),
                  'displayedWithoutMaybe': score(f'{run}/r-predictions-full.json'),
                  'musical': musical(), 'slicesIncludingMaybe': slices(f'{run}/r-predictions-all.json'),
                  'clipsWithNoScoredTag': sum(1 for r in rows.values() if not r['displayed']),
                  'run': runinfo}, indent=1))
