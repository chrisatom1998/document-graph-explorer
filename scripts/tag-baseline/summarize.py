"""Turn an eval-tag.ts report into the step-1 baseline table (per-tag precision, recall, F1, plus micro and macro).

Usage: python3 scripts/tag-baseline/summarize.py <report.json> <items.json> <out-dir> [--timing timing.txt]
Writes <out-dir>/per-tag.csv, <out-dir>/summary.json and <out-dir>/RESULTS.md. Only aggregate counts per tag are
written (no per-clip decisions), so the judge set stays a judge set.

"Shown" is the app's own display decision (normal or faded "maybe"), as eval-tag.ts measures it. A tag the app never
showed has no precision; it counts as 0 in the macro averages (zero_division=0) and its F1 is 0.
"""
import argparse, csv, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from learned_store import load_learned

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
# docs/evaluations/clean-retrain-2026-10-11: heads "kept old, unverified" were refit on FSD50K eval on the Mac, so their
# scores on this set can be inflated. Listed so nobody reads them as clean numbers.
FSD50K_EVAL_LEAK = {'accordion', 'acoustic guitar', 'cowbell', 'crash cymbal', 'drums', 'electric guitar', 'gong', 'kick',
                    'mallet instrument', 'organ', 'piano', 'rain ambience', 'siren', 'strings', 'vocal gasp', 'vocal laugh',
                    'water ambience', 'whisper', 'whoosh'}


def deciders():
    policy = json.load(open(os.path.join(ROOT, 'src/audio/taggerPolicy.json')))
    learned = load_learned(os.path.join(ROOT, 'public/sound-model/learned.json'))
    short = json.load(open(os.path.join(ROOT, 'public/sound-model/short-clip.json')))
    out = {}
    add = lambda label, s: out.setdefault(label, []).append(s)
    for t in policy['tags']:
        for label in t.get('decides', []) + [a['label'] for a in t.get('alsoDecides', [])]:
            add(label, f"tagger {t['output']}@{t['threshold']}{'' if t.get('tested') else ' (untested)'}")
    for hd in learned['heads']:
        add(hd['label'], f"clap-head@{hd['threshold']}{' maybe' if hd.get('maybe') else ''}")
    for hd in short['heads']:
        add(hd['label'], f"one-shot@{hd['threshold']}")
    return out


def f1(p, r):
    return 0.0 if not p or not r else 2 * p * r / (p + r)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('report'); ap.add_argument('items'); ap.add_argument('out'); ap.add_argument('--timing')
    a = ap.parse_args()
    rep, items = json.load(open(a.report)), json.load(open(a.items))
    dec = deciders()
    rows = []
    for key, parts in rep['current'].items():
        m = parts['all']; label = key.split(':', 1)[1]
        tp, fp, fn = m['tp'], m['fp'], m['fn']
        p = tp / (tp + fp) if tp + fp else None
        r = tp / m['positives'] if m['positives'] else None
        rows.append({'tag': label, 'display_key': key, 'support': m['positives'], 'negatives': m['negatives'], 'tp': tp, 'fp': fp, 'fn': fn,
                     'tp_maybe': m['tpMaybe'], 'fp_maybe': m['fpMaybe'],
                     'precision': None if p is None else round(p, 3), 'recall': None if r is None else round(r, 3), 'f1': round(f1(p, r), 3),
                     'false_alarm_rate': m['falseAlarmRate'], 'passes_60_30': m['passes6030'],
                     'pass_50_50': bool(p and r and p >= .5 and r >= .5), 'pass_60_60': bool(p and r and p >= .6 and r >= .6),
                     'pass_70_70': bool(p and r and p >= .7 and r >= .7),
                     'deciders': '; '.join(dec.get(label, ['raw CLAP prompt only'])),
                     'caveat': '; '.join(x for x in [('support < 10' if m['positives'] < 10 else ''),
                                                     ('old head trained on FSD50K eval: may be inflated' if label in FSD50K_EVAL_LEAK else '')] if x)})
    rows.sort(key=lambda x: (x['f1'], x['tag']))
    TP, FP, FN = (sum(x[k] for x in rows) for k in ('tp', 'fp', 'fn'))
    micro_p, micro_r = TP / (TP + FP), TP / (TP + FN)
    n = len(rows)
    macro_p = sum(x['precision'] or 0 for x in rows) / n
    macro_r = sum(x['recall'] or 0 for x in rows) / n
    macro_f1 = sum(x['f1'] for x in rows) / n
    summary = {'set': 'FSD50K eval slice (docs/evaluations/tag-baseline-2026-10-31/manifest.csv)', 'clips': rep['clips'], 'complete': rep['complete'],
               'unscoredClips': rep['unscoredClips'], 'tagsScored': n, 'models': rep['models'], 'taggerRevision': rep['taggerRevision'],
               'learnedRevision': rep['learnedRevision'], 'shortClipRevision': rep['shortClipRevision'], 'scope': rep['scope'],
               'jamendoLowerBound': rep.get('jamendoLowerBound', []), 'durations': rep.get('durations'),
               'micro': {'precision': round(micro_p, 3), 'recall': round(micro_r, 3), 'f1': round(f1(micro_p, micro_r), 3), 'tp': TP, 'fp': FP, 'fn': FN},
               'macro': {'precision': round(macro_p, 3), 'recall': round(macro_r, 3), 'f1': round(macro_f1, 3), 'note': 'mean over tags; a tag never shown counts precision 0'},
               'counts': {b: sum(x[f'pass_{b}'] for x in rows) for b in ('50_50', '60_60', '70_70')} | {'60_30': sum(bool(x['passes_60_30']) for x in rows)},
               'timing': open(a.timing).read().strip() if a.timing and os.path.exists(a.timing) else None}
    os.makedirs(a.out, exist_ok=True)
    cols = list(rows[0].keys())
    with open(os.path.join(a.out, 'per-tag.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, cols); w.writeheader(); w.writerows(rows)
    json.dump(summary, open(os.path.join(a.out, 'summary.json'), 'w'), indent=1)
    fmt = lambda v: '—' if v is None else f'{v:.2f}'
    md = ['| tag | precision | recall | F1 | support | tp | fp | fn | shown as maybe (tp/fp) | 50/50 | 60/60 | 70/70 | decided by | caveat |',
          '|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|---|']
    for x in rows:
        md.append(f"| {x['tag']} | {fmt(x['precision'])} | {fmt(x['recall'])} | {x['f1']:.2f} | {x['support']} | {x['tp']} | {x['fp']} | {x['fn']} | {x['tp_maybe']}/{x['fp_maybe']} | "
                  f"{'yes' if x['pass_50_50'] else 'no'} | {'yes' if x['pass_60_60'] else 'no'} | {'yes' if x['pass_70_70'] else 'no'} | {x['deciders']} | {x['caveat']} |")
    open(os.path.join(a.out, 'per-tag.md'), 'w').write('\n'.join(md) + '\n')
    print(json.dumps({k: summary[k] for k in ('clips', 'complete', 'tagsScored', 'micro', 'macro', 'counts', 'timing')}, indent=1))
    print('worst 10 by F1:')
    for x in rows[:10]:
        print(f"  {x['tag']:20s} P {fmt(x['precision'])} R {fmt(x['recall'])} F1 {x['f1']:.2f} support {x['support']}  [{x['deciders']}]")


if __name__ == '__main__':
    main()
