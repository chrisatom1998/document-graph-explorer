"""Pick the CPU-sized FSD50K training subsample (writes train-manifest/fsd50k-train.csv).

FSD50K dev, split=train only (never val, never eval). Removed: the private recipe's drop-train-ids
(fsd50k:/freesound: ids), reserved test families (build_set.reserved_rule), and every uploader that appears in the
judge set or the dev-val tuning set. Then up to 150 positives per tag (hashed order, at most 25 per uploader),
rarest tags first, plus 2,000 clean negatives.

Usage: select_train.py --meta FSD50K/meta --drop-ids drop-train-ids.json --devval-manifest devval/manifest.csv"""
import argparse, csv, json, os, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'tag-baseline'))
import build_set as B  # noqa: E402

PER_TAG, PER_UP, NEG = 150, 25, 2000
JUDGE_MANIFEST = os.path.join(HERE, '..', '..', 'docs', 'evaluations', 'tag-baseline-2026-10-31', 'manifest.csv')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--meta', required=True, help='FSD50K ground_truth dir with dev.csv and dev_clips_info_FSD50K.json')
    ap.add_argument('--drop-ids', required=True)
    ap.add_argument('--devval-manifest', required=True)
    ap.add_argument('--out', default=os.path.join(HERE, 'train-manifest', 'fsd50k-train.csv'))
    a = ap.parse_args()
    rows = [r for r in csv.DictReader(open(f'{a.meta}/dev.csv')) if r['split'] == 'train']
    info = json.load(open(f'{a.meta}/dev_clips_info_FSD50K.json'))
    drop = set(json.load(open(a.drop_ids)))
    res = B.reserved_rule()
    ex_up = {r['uploader'] for m in (JUDGE_MANIFEST, a.devval_manifest) for r in csv.DictReader(open(m))}
    pool, skipped = [], Counter()
    for r in rows:
        f = r['fname']
        up = info.get(f, {}).get('uploader', '')
        if f'fsd50k:{f}' in drop or f'freesound:{f}' in drop:
            skipped['drop'] += 1; continue
        if res(f, up):
            skipped['reserved'] += 1; continue
        if up in ex_up:
            skipped['judge/tuning uploader'] += 1; continue
        pool.append({'fname': f, 'up': up, 'labels': B.label_tags(r['labels'].split(','))})
    pool.sort(key=lambda c: B.h('dge-free-train-1101', c['fname']))
    cat = sorted({t for v in B.FSD50K.values() for t in v})
    freq = Counter(t for c in pool for t in c['labels'])
    chosen, have = {}, Counter()
    for tag in sorted(cat, key=lambda t: (freq[t], t)):
        pu = Counter()
        for c in pool:
            if have[tag] >= PER_TAG:
                break
            if tag not in c['labels'] or pu[c['up']] >= PER_UP:
                continue
            pu[c['up']] += 1
            if c['fname'] not in chosen:
                chosen[c['fname']] = c
                for t in c['labels']:
                    have[t] += 1
    neg = [c for c in pool if not c['labels'] and c['fname'] not in chosen][:NEG]
    for c in neg:
        chosen[c['fname']] = c
    with open(a.out, 'w', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['id', 'tags'])
        for c in sorted(chosen.values(), key=lambda c: int(c['fname'])):
            w.writerow([c['fname'], '|'.join(c['labels'])])
    print('pool', len(pool), 'skipped', dict(skipped), 'chosen', len(chosen), 'neg', len(neg))


if __name__ == '__main__':
    main()
