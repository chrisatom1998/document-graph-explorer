"""Fit full-mix Jamendo display thresholds on the SoundCloud train split; report held-out SoundCloud and the DJ clip set.

Usage: python3 scripts/soundcloud/fit.py <soundcloud-records.json> <soundcloud-manifest.json> \
           <dj-openmic-records.json> <dj-openmic-manifest.json> [out.json]

Records come from scripts/full-mix/extract.mjs on the app build the rules would be added to. "shown" is what that build
displayed; a rule adds a label when the highest Jamendo full-window score among its classes reaches the threshold (the
same test confidentSoundSummary applies for FULL_MIX_JAMENDO, recordings >= 10 s only).
For each label, the threshold chosen is the lowest one, from the 0.40 long-recording display floor up, at which the
panel with the rule (shown OR rule) reaches TARGET_PRECISION on the train split, with at least MIN_GAIN extra true
positives and MIN_NEGATIVES labelled negatives there. Nothing is tuned on the held-out split or the DJ clips; they are
reported as is. SoundCloud negatives come from text (see labels.py), so precision there is a lower bound when a track
plays an instrument its text does not list.
"""
import json, sys

TARGET_PRECISION = 0.80   # margin over the 70/70 pass bar Chris set on 2026-10-06
MIN_GAIN, MIN_NEGATIVES = 3, 8
THRESHOLDS = [round(0.40 + 0.05 * i, 2) for i in range(12)]
MAP = {  # scripts/mixed-music/score.mjs
    'drums': ['drums', 'drum kit', 'drum machine'], 'voice': ['voice'], 'synthesizer': ['synthesizer'], 'piano': ['piano', 'electric piano'],
    'guitar': ['guitar', 'acoustic guitar', 'electric guitar', 'steel guitar'], 'bass': ['bass guitar', 'bass', 'double bass'],
    'cymbals': ['cymbals'], 'organ': ['organ'], 'violin': ['violin', 'violin / fiddle'], 'trumpet': ['trumpet'], 'saxophone': ['saxophone'],
}
# Jamendo evidence that names each class (jamendo.ts aliases). Synthesizer and drums already have rules (PR #113).
CANDIDATES = {
    'guitar': ['source:guitar', 'source:electric guitar', 'source:acoustic guitar'],
    'bass': ['source:bass guitar', 'source:double bass'],
    'piano': ['source:piano', 'source:electric piano'],
    'violin': ['source:violin / fiddle'], 'saxophone': ['source:saxophone'], 'trumpet': ['source:trumpet'], 'organ': ['source:organ'],
    'voice': ['source:voice'],
}

def load(records_path, manifest_path, fold=None):
    records = {r['id']: r for r in json.load(open(records_path))}
    rows = []
    for item in json.load(open(manifest_path))['items']:
        if item['id'] not in records or (fold and item.get('fold') != fold):
            continue
        for rev in item['reviews']:
            if rev['label'] in MAP and rev['state'] in ('present', 'absent'):
                rows.append((records[item['id']], rev['label'], rev['state'] == 'present'))
    return rows

def shown(record, label):
    return any(s['dimension'] == 'source' and s['label'] in MAP[label] for s in record['shown'])

def rule_hit(record, label, rules):
    if label not in rules or (record.get('duration') or 0) < 10:
        return False
    classes, threshold = rules[label]
    scores = record.get('jamendoFullWindows', record['jamendo'])
    return max([scores.get(k, 0) for k in classes]) >= threshold

def score(rows, label, rules):
    tp = fp = fn = 0
    for record, l, present in rows:
        if l != label:
            continue
        hit = shown(record, label) or rule_hit(record, label, rules)
        if present: tp += hit; fn += not hit
        else: fp += hit
    p = tp / (tp + fp) if tp + fp else None
    r = tp / (tp + fn) if tp + fn else None
    return {'precision': None if p is None else round(p, 3), 'recall': None if r is None else round(r, 3), 'tp': tp, 'fp': fp, 'fn': fn,
            'pass': p is not None and r is not None and p >= .7 and r >= .7}

def main():
    sc_records, sc_manifest, dj_records, dj_manifest = sys.argv[1:5]
    sets = {'train': load(sc_records, sc_manifest, 'train'), 'held-out': load(sc_records, sc_manifest, 'held-out'),
            'dj-openmic': load(dj_records, dj_manifest)}
    rules, report = {}, {'target': TARGET_PRECISION, 'labels': {}}
    for label, classes in CANDIDATES.items():
        train = [r for r in sets['train'] if r[1] == label]
        negatives = sum(not p for *_, p in train)
        base = score(sets['train'], label, {})
        sweep = {t: score(sets['train'], label, {label: (classes, t)}) for t in THRESHOLDS}
        chosen = None
        if negatives >= MIN_NEGATIVES:
            chosen = next((t for t in THRESHOLDS if (sweep[t]['precision'] or 0) >= TARGET_PRECISION and sweep[t]['tp'] - base['tp'] >= MIN_GAIN), None)
        if chosen is not None:
            rules[label] = (classes, chosen)
        report['labels'][label] = {'trainPositives': sum(p for *_, p in train), 'trainNegatives': negatives, 'classes': classes, 'chosen': chosen,
                                   'trainSweep': {str(t): s for t, s in sweep.items()}}
    for name, rows in sets.items():
        report[name] = {label: {'before': score(rows, label, {}), 'after': score(rows, label, rules)} for label in MAP}
    report['rules'] = {label: {'classes': c, 'threshold': t} for label, (c, t) in rules.items()}
    if len(sys.argv) > 5:
        json.dump(report, open(sys.argv[5], 'w'), indent=1)
    print('rules:', json.dumps(report['rules']))
    for name in sets:
        print(f'\n{name}: label  before P/R  ->  after P/R')
        for label in MAP:
            b, a = report[name][label]['before'], report[name][label]['after']
            flag = '' if b == a else ('  REGRESSED' if b['pass'] and not a['pass'] else '  changed')
            print(f"  {label:12} {b['precision']}/{b['recall']} ({b['tp']}tp {b['fp']}fp {b['fn']}fn) -> {a['precision']}/{a['recall']} ({a['tp']}tp {a['fp']}fp {a['fn']}fn){flag}")

if __name__ == '__main__':
    main()
