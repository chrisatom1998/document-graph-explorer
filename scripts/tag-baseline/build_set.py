"""Build the step-1 tag baseline set: a small, labelled slice of FSD50K eval (real Freesound uploads).

Usage:
  python3 scripts/tag-baseline/build_set.py <meta-dir> <out-dir> [--per-tag 20] [--per-uploader 3] [--negatives 150]

<meta-dir> holds labels/eval.csv and metadata/eval_clips_info_FSD50K.json from datasets/Fhrozen/FSD50k at REVISION
(fetch.sh downloads them). Writes:
  <out-dir>/items.json     the set in scripts/eval-tag.ts --set form (ids, uploader as group, present/absent labels)
  <out-dir>/manifest.csv   one row per clip: id, uploader, licence, duration, FSD50K classes, catalog tags present

Labels come from the repo's own FSD50K -> catalog map (scripts/audio-model/labelmap.py, the map the tagger and the
scoreboard use). FSD50K eval lists every class heard in a clip, so a catalog tag is present when any mapped class is
and absent otherwise.

Data rules: FSD50K eval is a judge set. It is never trained on, and this script never touches audio: it only writes
ids, labels and metadata. Clips and uploaders reserved by the short-clip and synth-clip test sets are skipped with the
same rule as scripts/audio-model/prepare-fsd50k.py.

Selection (deterministic, no model output is looked at): for each tag, rarest first, take clips in hashed order until
the tag has --per-tag positives, at most --per-uploader clips per uploader per tag. Then add --negatives clips that carry
none of the mapped classes, so every tag has clean absences.
"""
import argparse, csv, hashlib, json, os, sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'audio-model'))
from labelmap import FSD50K  # noqa: E402

REPO = 'Fhrozen/FSD50k'
REVISION = 'ccf1acaff12f3f4a4c10052dddafbb6d22152c9b'
SEED = 'dge-tag-baseline-2026-10-31'
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()


def reserved_rule():
    a = json.load(open(os.path.join(ROOT, 'docs/evaluations/short-clips-2026-10-04/reserved-test-families.json')))
    b = json.load(open(os.path.join(ROOT, 'docs/evaluations/synth-clips-2026-10-05/reserved-test-families.json')))
    bad_ids, bad_up = set(a['freesoundIds']), set(a['freesoundUploaders']) | {u.split(':', 1)[1] for u in b['fsdUploaders']}
    return lambda fname, up: fname in bad_ids or up in bad_up or int(h('synth-fresh-up', f'freesound-user:{up}')[:8], 16) % 5 == 0


def catalog_tags(classes):
    return sorted({t for c in classes for t in FSD50K.get(c, [])})


def build(rows, info, per_tag, per_uploader, negatives, reserved):
    cat = sorted({t for v in FSD50K.values() for t in v})
    pool = []
    for r in rows:
        up = info.get(r['fname'], {}).get('uploader', '')
        if reserved(r['fname'], up):
            continue
        classes = r['labels'].split(',')
        pool.append({'fname': r['fname'], 'uploader': up, 'classes': classes, 'tags': catalog_tags(classes)})
    pool.sort(key=lambda c: h(SEED, c['fname']))
    freq = Counter(t for c in pool for t in c['tags'])
    chosen, have = {}, Counter()
    for tag in sorted(cat, key=lambda t: (freq[t], t)):
        per_up = Counter()
        for c in pool:
            if have[tag] >= per_tag:
                break
            if tag not in c['tags'] or per_up[c['uploader']] >= per_uploader:
                continue
            if c['fname'] not in chosen:
                chosen[c['fname']] = c
                for t in c['tags']:
                    have[t] += 1
            per_up[c['uploader']] += 1
    empty = [c for c in pool if not c['tags'] and c['fname'] not in chosen][:negatives]
    for c in empty:
        chosen[c['fname']] = c
    clips = sorted(chosen.values(), key=lambda c: int(c['fname']))
    items = [{'id': f"fsd50k-eval:{c['fname']}", 'artist': f"freesound-user:{c['uploader']}",
              'labels': {f'cat:{t}': ('present' if t in c['tags'] else 'absent') for t in cat}} for c in clips]
    return cat, clips, items, freq


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('meta'); ap.add_argument('out')
    ap.add_argument('--per-tag', type=int, default=20); ap.add_argument('--per-uploader', type=int, default=3)
    ap.add_argument('--negatives', type=int, default=150)
    a = ap.parse_args()
    rows = list(csv.DictReader(open(os.path.join(a.meta, 'eval.csv'))))
    info = json.load(open(os.path.join(a.meta, 'eval_clips_info_FSD50K.json')))
    cat, clips, items, freq = build(rows, info, a.per_tag, a.per_uploader, a.negatives, reserved_rule())
    os.makedirs(a.out, exist_ok=True)
    meta = {'source': f'https://huggingface.co/datasets/{REPO}', 'revision': REVISION, 'split': 'eval (judge set: never train or tune on it)',
            'labelmap': 'scripts/audio-model/labelmap.py FSD50K', 'seed': SEED, 'perTag': a.per_tag, 'perUploader': a.per_uploader,
            'negatives': a.negatives, 'tags': cat}
    json.dump({**meta, 'items': items}, open(os.path.join(a.out, 'items.json'), 'w'), indent=0)
    with open(os.path.join(a.out, 'manifest.csv'), 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['id', 'uploader', 'licence', 'fsd50k_classes', 'tags_present'])
        for c in clips:
            w.writerow([f"fsd50k-eval:{c['fname']}", c['uploader'], info.get(c['fname'], {}).get('license', ''), ';'.join(c['classes']), ';'.join(c['tags'])])
    pos = Counter(t for c in clips for t in c['tags'])
    print(f'{len(clips)} clips, {len({c["uploader"] for c in clips})} uploaders, {len(cat)} tags; positives per tag:')
    for t in sorted(cat, key=lambda t: pos[t]):
        print(f'  {t:24s} {pos[t]:4d}  (pool {freq[t]})')


if __name__ == '__main__':
    main()
