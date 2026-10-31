"""Merge the coverage sets' own sure absences into the label-fix JSON that train.py --absent-fix reads.

Usage: python3 scripts/audio-model/coverage/merge-absent.py <label-fix-absent-fix.json> <out.json> <manifest.csv>...

Manifests are the private cmjatom/dge-private-train coverage/effect-pairs/v1/<tag>/manifest.csv (column absent_tags: the dry
copy is surely not that effect) and coverage/synth-presets/v1/surge-xt/manifest.csv (column absent: safe negatives such as
"a low bass note is not a pad"). Their weak_absent_tags stay weak, which is what prepare-run9.py already does with every tag
a row does not name. Only train rows with keep=1 are read; a tag the row itself names is never made absent.
"""
import csv, json, sys
from collections import Counter

fix_path, out_path, manifests = sys.argv[1], sys.argv[2], sys.argv[3:]
fix = json.load(open(fix_path))
absent, per_tag = {}, Counter()
for m in manifests:
    for r in csv.DictReader(open(m)):
        if r.get('split') != 'train' or r.get('keep', '1') != '1': continue
        own = set(filter(None, r.get('tags', '').split('|')))
        tags = set(filter(None, (r.get('absent_tags') or r.get('absent') or '').split('|'))) - own
        if tags:
            absent.setdefault(r['id'], set()).update(tags); per_tag.update(tags)
fix['absent'] = {k: sorted(v) for k, v in sorted(absent.items())}
json.dump(fix, open(out_path, 'w'))
print(f'{len(absent)} items with sure absences; ' + ', '.join(f'{t} {n}' for t, n in per_tag.most_common()))
