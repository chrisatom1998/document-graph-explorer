"""Per-tag gap report for the sound catalog.

Reads the files the app actually ships (catalog, tagger policy, learned heads,
short-clip heads) plus committed evaluation rows. Optional --eval and
--thresholds point at the pinned tagger's public eval.json and thresholds.json
(cmjatom/dge-all-tags-tagger-nc). Weak under-tag views (holdout-r3/weak,
eval-freesound/weak) are not the binding score: an untagged track is not a
proven absence there.

Usage:
  python3 scripts/hf-sound-tags/gap_report.py --out /tmp/gap.json
  python3 scripts/hf-sound-tags/gap_report.py --eval eval.json --thresholds thresholds.json --out gap.json
"""
from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from learned_store import load_learned  # noqa: E402
sys.path.insert(0, HERE)
import bars  # noqa: E402

# confidentSoundSummary.ts HIDDEN_UNTIL_TESTED. The display drops these even when a detector fires.
HIDDEN = frozenset({'distorted', 'reverse effect'})


def load(path: str):
    with open(path) as f:
        return json.load(f)


def merges_from_source() -> dict[str, tuple[str, str]]:
    text = open(os.path.join(ROOT, 'src/audio/djTags.ts')).read()
    block = text.split('MERGED_DJ_LABELS')[1].split('export const mergedDjLabel')[0]
    out = {}
    for match in re.finditer(r"'([^']+)': \{ group: '(\w+)', label: '([^']+)' \}", block):
        out[match.group(1)] = (match.group(2), match.group(3))
    return out


def head_rows() -> list[tuple]:
    rows = []
    for path in sorted(glob.glob(os.path.join(ROOT, 'docs/evaluations/*/*.json'))):
        try:
            data = load(path)
        except (ValueError, UnicodeDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        for key in ('heads', 'updates', 'results'):
            for row in data.get(key) or []:
                if not isinstance(row, dict):
                    continue
                label = row.get('label') or row.get('name')
                if label and row.get('precision') is not None and row.get('recall') is not None and row.get('threshold') is not None:
                    rows.append((label, float(row['threshold']), float(row['precision']), float(row['recall']),
                                 row.get('trainPositive'), row.get('testPositive'), os.path.relpath(path, ROOT)))
    return rows


def exact_head(rows, label: str, threshold: float):
    match = [r for r in rows if r[0] == label and abs(r[1] - float(threshold)) < 6e-4]
    if not match:
        return None
    return min(match, key=lambda r: min(r[2], r[3]))


def _set_rows(table: dict, counted: list | None) -> list[dict]:
    names = set(counted) if counted else None
    rows = []
    for name, vals in table.items():
        if not isinstance(vals, dict) or 'p' not in vals:
            continue
        if names is not None and name not in names:
            continue
        if (vals.get('positives') or 0) < 5:
            continue
        rows.append({'name': name, 'precision': vals.get('p'), 'recall': vals.get('r'),
                     'positives': vals.get('positives'), 'negatives': vals.get('negatives')})
    return rows


def clean_sets(report: dict, label: str, threshold: float) -> list[dict] | None:
    """Fresh-set scores from the clean retrain, only at the cutoff that shipped, and only on sets the report counted."""
    for head in report.get('heads') or []:
        if head.get('label') == label and abs(float(head.get('threshold', -1)) - float(threshold)) < 6e-4:
            return _set_rows(head.get('sets') or {}, head.get('countedSets'))
    for row in report.get('results') or []:
        old_t = row.get('oldThreshold')
        if row.get('tag') == label and old_t is not None and abs(float(old_t) - float(threshold)) < 6e-4:
            old = row.get('old') or {}
            # results store p/r under the same shape as heads, plus a precision alias some rows lack.
            table = {name: ({**vals, 'p': vals.get('p', vals.get('precision')), 'r': vals.get('r', vals.get('recall'))} if isinstance(vals, dict) else vals)
                     for name, vals in old.items()}
            return _set_rows(table, row.get('countedSets'))
    return None


def quote_for(quotes: dict, label: str, cutoff: float | None) -> dict | None:
    row = (quotes.get('quotes') or {}).get(label)
    if not row or cutoff is None:
        return None
    if abs(float(row['cutoff']) - float(cutoff)) > 0.02:
        return None
    sets = []
    for s in row['sets']:
        sets.append({'name': s['name'], 'precision': s['precision'], 'recall': s['recall'],
                     'positives': s.get('positives'), 'negatives': s.get('negatives')})
    return {'pr': row['pr'], 'sets': sets}


def strong_eval(evalj: dict | None, output: str) -> list[dict]:
    if not evalj:
        return []
    found = []
    for set_name, block in evalj.items():
        if not isinstance(block, dict):
            continue
        for view, table in block.items():
            if view == 'weak' or not isinstance(table, dict):
                continue
            cell = table.get(output)
            if not isinstance(cell, dict) or not cell.get('enabled', True):
                continue
            p, r = cell.get('precision'), cell.get('recall')
            pos, neg = cell.get('positives') or 0, cell.get('negatives') or 0
            if p is None or r is None or pos < 5 or neg < 5:
                continue
            found.append({'name': f'{set_name}/{view}', 'precision': p, 'recall': r, 'positives': pos, 'negatives': neg})
    return found


def fsd_index(csv_dir: str | None, mapping: dict) -> dict[str, dict]:
    if not csv_dir:
        return {}
    inverse: dict[str, set[str]] = {}
    for cls, labels in mapping.items():
        for label in labels:
            inverse.setdefault(label, set()).add(cls)

    def count(path: str, split: str | None) -> dict[str, int]:
        totals = {label: 0 for label in inverse}
        with open(path) as handle:
            for row in csv.DictReader(handle):
                if split and row['split'] != split:
                    continue
                present = set(row['labels'].split(','))
                for label, classes in inverse.items():
                    if present & classes:
                        totals[label] += 1
        return totals

    dev = os.path.join(csv_dir, 'dev.csv')
    ev = os.path.join(csv_dir, 'eval.csv')
    if not (os.path.exists(dev) and os.path.exists(ev)):
        return {}
    train, val, test = count(dev, 'train'), count(dev, 'val'), count(ev, None)
    return {label: {'fsdTrain': train[label], 'fsdVal': val[label], 'fsdEval': test[label]} for label in inverse}


def decide(label: str, group: str, pols, learned_by, short_by, prompt_labels, folded) -> tuple[str, str, dict | None]:
    if label in bars.RULE_WORDS:
        return 'dsp', 'timbreDescriptions.ts', None
    if pols:
        pol = pols[0]
        flag = '' if pol['tested'] else ' tested:false'
        return 'tagger', f"{pol['output']} cutoff {pol['threshold']}{flag}", pol
    head = learned_by.get(label) or next((learned_by[n] for n in folded if n in learned_by), None)
    if head:
        kind = 'clap-head-maybe' if head.get('maybe') else 'clap-head'
        return kind, f"{head['label']} cutoff {head['threshold']}", head
    one = short_by.get(label) or next((short_by[n] for n in folded if n in short_by), None)
    if one:
        return 'one-shot', f"{one['label']} cutoff {one.get('threshold')}", one
    if label in prompt_labels or any(n in prompt_labels for n in folded):
        return 'raw-prompt', 'prompts.json', None
    return 'none', '', None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--eval', help='pinned tagger eval.json')
    parser.add_argument('--thresholds', help='pinned tagger thresholds.json')
    parser.add_argument('--fsd-csv-dir', help='directory with FSD50K dev.csv and eval.csv (public label files)')
    parser.add_argument('--out', help='write the report JSON here')
    args = parser.parse_args()

    catalog = load(os.path.join(ROOT, 'src/audio/djCatalog.json'))['categories']
    policy = load(os.path.join(ROOT, 'src/audio/taggerPolicy.json'))
    learned = load_learned(os.path.join(ROOT, 'public/sound-model/learned.json'))['heads']
    short = load(os.path.join(ROOT, 'public/sound-model/short-clip.json'))['heads']
    prompts = load(os.path.join(ROOT, 'public/sound-model/prompts.json'))
    quotes = load(os.path.join(HERE, 'fresh_quotes.json'))
    clean = load(os.path.join(ROOT, 'docs/evaluations/clean-retrain-2026-10-11/report.json'))
    sys.path.insert(0, os.path.join(ROOT, 'scripts/audio-model'))
    import labelmap  # noqa: E402
    evalj = load(args.eval) if args.eval else None
    thresholds = load(args.thresholds) if args.thresholds else {}
    fsd = fsd_index(args.fsd_csv_dir, labelmap.FSD50K)
    merged = merges_from_source()
    rows = head_rows()
    learned_by = {h['label']: h for h in learned}
    short_by = {h['label']: h for h in short}
    prompt_labels = {p['label'] for p in prompts}
    by_decide: dict[str, list] = {}
    for tag in policy['tags']:
        names = set(tag.get('decides') or []) | {tag['label']}
        for extra in tag.get('alsoDecides') or []:
            names.add(extra['label'])
        for name in names:
            by_decide.setdefault(name, []).append(tag)

    tags = []
    for cat in catalog:
        key = f"{cat['group']}:{cat['label']}"
        if key in merged:
            continue
        label, group = cat['label'], cat['group']
        folded = [src.split(':', 1)[1] for src, dest in merged.items() if dest == (group, label)]
        decider, detail, obj = decide(label, group, by_decide.get(label, []), learned_by, short_by, prompt_labels, folded)
        score = None
        set_rows: list[dict] = []
        source = ''
        train = test = None
        note = ''
        if decider == 'tagger' and obj:
            quoted = quote_for(quotes, label, obj['threshold'])
            model_t = (thresholds.get(obj['output']) or {}).get('threshold')
            if quoted:
                set_rows = quoted['sets']
                chosen = bars.binding(set_rows)
                score = chosen
                source = f"PR #{quoted['pr']} {chosen['name']}"
                test = chosen.get('positives')
            elif model_t is not None and abs(float(model_t) - float(obj['threshold'])) <= 0.02:
                set_rows = strong_eval(evalj, obj['output'])
                chosen = bars.binding(set_rows)
                if chosen:
                    score = chosen
                    source = f"tagger eval {chosen['name']} at cutoff {model_t}"
                    test = chosen.get('positives')
            elif model_t is not None:
                note = f"policy cutoff {obj['threshold']} differs from scored cutoff {model_t}; eval.json is not the current operating point"
            elif args.eval:
                note = 'no calibration threshold for this output in thresholds.json'
            if label in fsd:
                counts = fsd[label]
                train = counts['fsdTrain']
                note = (note + '; ' if note else '') + f"FSD50K public train/val/eval rows {counts['fsdTrain']}/{counts['fsdVal']}/{counts['fsdEval']} (a floor, not the private mix)"
        elif decider in ('clap-head', 'clap-head-maybe', 'one-shot') and obj and obj.get('threshold') is not None:
            fresh = clean_sets(clean, obj['label'], obj['threshold'])
            if fresh:
                set_rows = fresh
                chosen = bars.binding(set_rows)
                if chosen:
                    score = chosen
                    source = f"clean-retrain {chosen['name']}"
                    test = chosen.get('positives')
            if score is None:
                hit = exact_head(rows, obj['label'], obj['threshold'])
                if hit:
                    score = {'name': hit[6], 'precision': hit[2], 'recall': hit[3], 'positives': hit[5]}
                    source = hit[6]
                    train, test = hit[4], hit[5]
            if label in fsd and train is None:
                train = fsd[label]['fsdTrain']
                note = f"train count is FSD50K public train rows only ({fsd[label]['fsdTrain']}/{fsd[label]['fsdVal']}/{fsd[label]['fsdEval']})"
        p = None if not score else score.get('precision')
        r = None if not score else score.get('recall')
        if label in bars.RULE_WORDS:
            tier = 'dsp'
        elif label in bars.STAY_MAYBE:
            tier = 'character-maybe'
        elif decider == 'tagger':
            # A tested tagger output is a full tag under the 60/30 ship line. A recorded
            # score can still miss the 50/50 head bar; that is reported on its own.
            if obj and obj.get('tested'):
                tier = 'tagger-60/30-misses-50' if p is not None and not bars.meets_full(p, r) else 'full'
            elif p is not None and not bars.meets_maybe(p, r):
                tier = 'below-maybe'
            else:
                tier = 'maybe'
        elif decider in ('clap-head', 'clap-head-maybe', 'one-shot'):
            tier = bars.head_tier(p, r, label)
        elif p is not None and r is not None:
            tier = bars.head_tier(p, r, label)
        else:
            tier = 'unmeasured'
        if label in HIDDEN:
            shown = 'hidden'
        elif decider == 'dsp':
            shown = 'dsp'
        elif decider == 'tagger':
            shown = 'full' if obj and obj.get('tested') else 'maybe'
        elif decider == 'clap-head' or decider == 'one-shot':
            shown = 'full'
        elif decider == 'clap-head-maybe':
            shown = 'maybe'
        elif decider == 'raw-prompt':
            shown = 'possible'
        else:
            shown = 'none'
        tags.append({
            'shown': shown,
            'label': label, 'group': group, 'decider': decider, 'detail': detail,
            'precision': None if p is None else round(float(p), 3),
            'recall': None if r is None else round(float(r), 3),
            'bindingSet': None if not score else score.get('name'),
            'sets': [{'name': s.get('name'), 'precision': s.get('precision'), 'recall': s.get('recall'),
                      'positives': s.get('positives'), 'negatives': s.get('negatives')} for s in set_rows],
            'train': train, 'test': test, 'tier': tier, 'source': source, 'note': note,
            'meets50': bars.meets_full(p, r), 'meets45': bars.meets_maybe(p, r),
            'meets6030': bars.meets_tagger_ship(p, r), 'meets6060': bars.meets_60(p, r),
            'taggerTested': None if not (decider == 'tagger' and obj) else bool(obj.get('tested')),
        })

    summary = {
        'catalog': len(catalog),
        'mergedAway': len(merged),
        'pickable': len(tags),
        'bars': {
            'headFull': [bars.FULL_PRECISION, bars.FULL_RECALL],
            'maybeFloor': bars.MAYBE_FLOOR,
            'taggerShip': [bars.TAGGER_PRECISION, bars.TAGGER_RECALL],
            'reportedButNotTheShipGate': [bars.REPORT_60, bars.REPORT_60],
        },
    }
    report = {'kind': 'hf-sound-tag-gap-v1', 'summary': summary, 'tags': tags}
    text = json.dumps(report, indent=1)
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)) or '.', exist_ok=True)
        with open(args.out, 'w') as handle:
            handle.write(text)
            handle.write('\n')
    below_full = [t for t in tags if t['tier'] in ('maybe', 'below-maybe', 'unmeasured', 'full-under-60/30', 'character-maybe')]
    below_maybe = [t for t in tags if t['tier'] == 'below-maybe' or (t['tier'] == 'unmeasured' and t['decider'] in ('raw-prompt', 'none', 'one-shot'))]
    print(f"pickable {len(tags)} of {len(catalog)} catalog labels ({len(merged)} merged away)")
    from collections import Counter
    print('tiers', dict(Counter(t['tier'] for t in tags)))
    print(f"below full-tag bar (repo): {sum(1 for t in tags if t['tier'] != 'full' and t['tier'] != 'dsp')}")
    print(f"at or under the maybe floor, or no measurement and no head: {len(below_maybe)}")
    if not args.out:
        print(text)
    return below_full


if __name__ == '__main__':
    main()
