"""Pick CED-checked Freesound training clips for weak tags from a ced-freesound run.

Usage: ced-select.py <run dir> <exclusion-manifest.json> <candidates-all-tags.csv> <fsnew-staging.tsv> <out csv>
  <run dir>: runs/<run key>/ of <HF user>/dge-eval-runs (part-*/*.npz and candidates.csv).
  The other inputs are private project files (never committed): the licensed-pilot exclusion manifest, the
  keyword candidate list from "Find training sets" and run 7's Freesound staging list.

Two sources of rows, both CC0 / CC BY only:
  mapped:   candidates.csv rows (tags in data/ced-tag-map.json, AudioSet class match) with score >= MIN_SCORE.
  keyword:  train rows of candidates-all-tags.csv for the tags in data/ced-confirm-rules.json, kept when CED agrees
            (best confirm-class score >= confirm_min) or, for reject_only tags, when no speech/animal/vehicle class
            reaches reject_max.
Every held-out or reserved uploader and id is dropped (manifest heldout + reserved lists and its three Freesound
uploader hash rules, keyword-list heldout uploaders, run 7 heldout ids); ids already in training are dropped;
at most PER_UPLOADER rows per uploader and PER_TAG rows per tag.
Env: MIN_SCORE (0.5), PER_UPLOADER (15), PER_TAG (400).
"""
import csv
import glob
import hashlib
import json
import os
import sys
from collections import Counter, defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MIN_SCORE = float(os.environ.get('MIN_SCORE', '0.5'))
PER_UPLOADER = int(os.environ.get('PER_UPLOADER', '15'))
PER_TAG = int(os.environ.get('PER_TAG', '400'))
LIC = {0: 'CC0', 1: 'BY4', 2: 'BY3', 3: 'NC3', 4: 'NC4'}
OPEN = {'CC0', 'BY4', 'BY3'}

run, excl_f, kw_f, fsnew_f, out_f = sys.argv[1:6]
ex = json.load(open(excl_f))['sets']
bad_users = {u.casefold() for k in ('heldoutFreesoundUploaders', 'reservedFreesoundUploaders') for u in ex[k]}
bad_ids = {int(i) for k in ('heldoutFreesoundIds', 'reservedFreesoundIds') for i in ex[k]}
used_ids = {int(i) for i in ex['freesoundIds']}
kw = list(csv.DictReader(open(kw_f)))
for r in kw:
    if r['split'] == 'heldout':
        bad_users.add(r['username'].casefold())
        bad_ids.add(int(r['freesound_id']))
for line in open(fsnew_f):
    _, sp, ids = line.rstrip('\n').split('\t')
    for x in ids.split(','):
        (bad_ids if sp == 'heldout' else used_ids).add(int(x.split(':')[0]))


def hit(salt, u, mod):
    return int(hashlib.sha256((salt + u).encode()).hexdigest()[:8], 16) % mod == 0


def held_out(i, u):
    return (i in bad_ids or u.casefold() in bad_users or hit('synth-fresh-up|freesound-user:', u, 5)
            or hit('dj-effects|', u, 4) or hit('dge-audio-model-freesound-test|', u, 10))


rows = []  # (tag, id, username, licence, seconds, score, source)
for r in csv.DictReader(open(os.path.join(run, 'candidates.csv'))):
    if float(r['score']) >= MIN_SCORE:
        rows.append((r['tag'], int(r['freesound_id']), r['username'], LIC[int(r['license'])], float(r['seconds']),
                     float(r['score']), 'mapped'))

rules = json.load(open(os.path.join(HERE, 'data', 'ced-confirm-rules.json')))
want = defaultdict(set)
for r in kw:
    if r['split'] == 'train' and (r['tag'] in rules['confirm'] or r['tag'] in rules['reject_only']):
        want[int(r['freesound_id'])].add(r['tag'])
lic_kw = {int(r['freesound_id']): r['licence'] for r in kw}
for f in sorted(glob.glob(os.path.join(run, 'part-*', '*.npz'))):
    z = np.load(f, allow_pickle=False)
    ids = z['freesound_id'].astype(np.int64)
    hits = np.where(np.isin(ids, list(want)))[0]
    if not len(hits):
        continue
    P = z['probs'][hits].astype(np.float32)
    for k, j in enumerate(hits):
        i = int(ids[j])
        for tag in want[i]:
            if tag in rules['confirm']:
                s = float(P[k, rules['confirm'][tag]].max())
                ok = s >= rules['confirm_min']
            else:
                s = 1.0 - float(P[k, rules['reject_classes']].max())
                ok = s > 1.0 - rules['reject_max']
            if ok:
                rows.append((tag, i, str(z['username'][j]), lic_kw.get(i, LIC.get(int(z['license'][j]), '?')),
                             float(z['seconds'][j]), round(s, 3), 'keyword+ced'))

rows.sort(key=lambda r: (r[0], -r[5]))
kept, why, per_user, seen, per_tag = [], Counter(), defaultdict(Counter), set(), Counter()
for tag, i, u, lic, sec, s, src in rows:
    reason = None
    if (tag, i) in seen: reason = 'duplicate'
    elif lic not in OPEN: reason = 'licence not CC0/BY'
    elif held_out(i, u): reason = 'held-out or reserved'
    elif i in used_ids: reason = 'already in training'
    elif per_user[tag][u] >= PER_UPLOADER: reason = 'uploader cap'
    elif per_tag[tag] >= PER_TAG: reason = 'tag cap'
    seen.add((tag, i))
    if reason:
        why[(tag, reason)] += 1
        continue
    per_user[tag][u] += 1
    per_tag[tag] += 1
    kept.append((tag, i, u, lic, sec, s, src))

with open(out_f, 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['tag', 'freesound_id', 'username', 'licence', 'seconds', 'ced_score', 'source'])
    w.writerows(kept)
tags = sorted({r[0] for r in rows} | set(rules['confirm']) | set(rules['reject_only']))
summary = {t: {'kept': sum(1 for k in kept if k[0] == t), 'uploaders': len({k[2] for k in kept if k[0] == t}),
               **{w_: n for (tt, w_), n in why.items() if tt == t}} for t in tags}
json.dump({'min_score': MIN_SCORE, 'per_uploader': PER_UPLOADER, 'per_tag': PER_TAG, 'tags': summary},
          open(os.path.splitext(out_f)[0] + '-summary.json', 'w'), indent=1)
for t, v in summary.items():
    print(f'{t:20s} {v}')
print('total kept', len(kept))
