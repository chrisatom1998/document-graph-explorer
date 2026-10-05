"""Choose full-mix Jamendo display thresholds on half the OpenMIC test selection and check them on the other half.

Usage: python3 scripts/calibrate-full-mix-jamendo.py <records.json> <mixed-music manifest.json>

records.json comes from scripts/full-mix/extract.mjs (main build). Clips are split by a fixed hash of the FMA artist,
so no artist is in both halves. Only explicit present/absent labels count (as in scripts/mixed-music/score.mjs).
Rule for a label: show it when the highest Jamendo window score for its classes reaches the threshold. The threshold
picked is the lowest one, from the 0.40 track display floor up, whose calibration precision for the rule on its own is
at least TARGET_PRECISION. OpenMIC is easy for main (its fusion heads were fitted on OpenMIC's train partition), so the
rule is judged on its own; the panel as it would then look (main's tags plus the rule) is reported too.
The other half is reported as is; nothing is tuned on it.
"""
import hashlib, json, sys

SEED = 'dge-edm-genre-tags-2026-10-05'
TARGET_PRECISION = 0.70  # margin over the 60/60 pass bar
RULES = {'synthesizer': ['source:synthesizer'], 'drums': ['source:drum kit', 'source:drum machine']}
SHOWN = {'synthesizer': ['synthesizer'], 'drums': ['drums', 'drum kit', 'drum machine']}
THRESHOLDS = [round(0.40 + 0.05 * i, 2) for i in range(12)]

records = {r['id']: r for r in json.load(open(sys.argv[1]))}
items = [i for i in json.load(open(sys.argv[2]))['items'] if i['id'] in records]
half = lambda item: 'calibration' if int(hashlib.sha256(f"{SEED}|{item['groups']['artist']}".encode()).hexdigest(), 16) % 2 == 0 else 'held-out'

def score(rows, label, threshold, with_main=True):
    tp = fp = fn = 0
    for item, present in rows:
        r = records[item['id']]
        main = with_main and any(s['dimension'] == 'source' and s['label'] in SHOWN[label] for s in r['shown'])
        rule = threshold is not None and max([r['jamendo'].get(k, 0) for k in RULES[label]]) >= threshold
        hit = main or rule
        if present: tp += hit; fn += not hit
        else: fp += hit
    p = tp / (tp + fp) if tp + fp else None
    return {'precision': None if p is None else round(p, 3), 'recall': round(tp / (tp + fn), 3) if tp + fn else None, 'tp': tp, 'fp': fp, 'fn': fn}

report = {'items': len(items), 'target': TARGET_PRECISION, 'labels': {}}
for label in RULES:
    rows = {h: [(i, r['state'] == 'present') for i in items for r in i['reviews'] if r['label'] == label and half(i) == h] for h in ('calibration', 'held-out')}
    sweep = {t: score(rows['calibration'], label, t, with_main=False) for t in THRESHOLDS}
    chosen = next((t for t in THRESHOLDS if (sweep[t]['precision'] or 0) >= TARGET_PRECISION), None)
    report['labels'][label] = {
        'positives/negatives': {h: [sum(p for _, p in v), sum(not p for _, p in v)] for h, v in rows.items()},
        'main': {h: score(v, label, None) for h, v in rows.items()},
        'calibrationSweepRuleAlone': {str(t): s for t, s in sweep.items()},
        'chosen': chosen,
        'ruleAlone': {h: score(v, label, chosen, with_main=False) for h, v in rows.items()} if chosen is not None else None,
        'mainPlusRule': {h: score(v, label, chosen) for h, v in rows.items()} if chosen is not None else None,
    }
print(json.dumps(report, indent=1))
