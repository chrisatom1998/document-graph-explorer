"""Extra train-side tuning positives from the existing train rows of no-source-tags/candidates-all-tags.csv and
round10-uncovered (split == train only), for tags whose own train H pool is thin. A row is kept when it passes this
tag's H or M word rule (keywords.py) and the same train-side held-out rules as select_clips.py (exclusions.train_ok),
up to 40 per tag and 3 per uploader. Usage:
python3 -I select_train_extra.py <mirror-meta.parquet> <excl-dir> <project-files> <repo> <run9 manifest-audited.csv> <sel-dir>
  -> <sel-dir>/train-extra-picks.csv, train-extra-jobs.json"""
import csv, json, os, random, sys
from collections import defaultdict
import pyarrow.parquet as pq
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from keywords import RULES
import exclusions
META, EXCL, PF, REPO, RUN9, SEL = sys.argv[1:7]
_, train_ok = exclusions.load(EXCL, PF, REPO, RUN9)
t = pq.read_table(META, columns=['freesound_id', 'title', 'tags', 'username', 'file', 'row', 'license']).to_pydict()
meta = {}
for i, ti, tg, u, f, r, l in zip(t['freesound_id'], t['title'], t['tags'], t['username'], t['file'], t['row'], t['license']):
    meta.setdefault(int(i), dict(id=int(i), title=ti or '', tags=list(tg or []), user=u or '', file=f, row=int(r), lic=l))   # first copy wins
have = {int(r['freesound_id']) for r in csv.DictReader(open(f'{SEL}/train-picks.csv'))}
cand = defaultdict(set)
for r in csv.DictReader(open(f'{PF}/datasets/no-source-tags/candidates-all-tags.csv')):
    if r['split'] == 'train' and r['tag'] in RULES: cand[r['tag']].add(int(r['freesound_id']))
for r in csv.DictReader(open(f'{PF}/datasets/round10-uncovered/candidates-2026-10-10.csv')):
    if r['split'] == 'train' and r['tag'] in RULES and r['item_id'].startswith('fs:'): cand[r['tag']].add(int(r['item_id'][3:]))
rng = random.Random(7); out = []
for tag in ('falling', 'sustained', 'syncopated', 'rolling', 'rhythmic'):
    rows = [meta[i] for i in sorted(cand[tag]) if i in meta and i not in have and train_ok(meta[i])]
    ok = [r for r in rows if RULES[tag]['H'](r) or RULES[tag]['M'](r)]
    rng.shuffle(ok); n = defaultdict(int); k = 0
    for r in ok:
        if n[r['user']] < 3 and k < 40: out.append(dict(r, tag=tag)); n[r['user']] += 1; k += 1
    print(tag, len(cand[tag]), len(rows), len(ok), k)
with open(f'{SEL}/train-extra-picks.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['tag', 'conf', 'freesound_id', 'username', 'licence', 'title', 'tags', 'file', 'row'])
    for r in out: w.writerow([r['tag'], 'train-list', r['id'], r['user'], r['lic'], r['title'], ','.join(r['tags'])[:300], r['file'], r['row']])
json.dump([{'id': r['id'], 'file': r['file'], 'row': r['row']} for r in {r['id']: r for r in out}.values()], open(f'{SEL}/train-extra-jobs.json', 'w'))
