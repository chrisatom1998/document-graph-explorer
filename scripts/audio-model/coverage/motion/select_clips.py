"""Pick Freesound mirror clips for the motion tags: train-side tuning clips and held-out TEST candidates.
Metadata only; no audio is read here.

Usage: python3 -I select_clips.py <mirror-meta.parquet> <excl-dir> <project-files> <repo> <run9 manifest-audited.csv> <out-dir>
  mirror-meta.parquet: title, description, tags, username, freesound_id, license, file, row of every mirror clip
  excl-dir: FSD50K.ground_truth/{dev,eval}.csv and rehosts.json (run9-exclusions.py output)
Writes <out-dir>/{train,test}-jobs.json (fetch_mirror.py input), {train,test}-picks.csv, {train,test}-neg-eligible.json.

Test side (TEST ONLY): uploaders under the reserved test-uploader hash rules test8 used (synth-clip test or cached
Freesound test), which no training run uses. Dropped: FSD50K dev/eval clips, clips re-hosted by ESC-50 / UrbanSound8K /
Nonspeech7k, every run 7 and run 9 staging id, every train row of no-source-tags and round10-uncovered, test8 ids,
DJ-effect clips and the reserved short-clip / synth-clip family ids and uploaders.
Train side: uploaders under none of the three reserved rules, not held out for any tag (no-source-tags held-out rows,
run 9 held-out rows, round10 val rows, DJ-effect held-out uploaders, reserved families), not FSD50K eval, not test8.
Caps: test H 14 and M 8 per tag, 2 per uploader; train 45 per tag, 3 per uploader. Fixed seed.
"""
import csv, json, os, random, re, sys
from collections import defaultdict
import pyarrow.parquet as pq
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from keywords import RULES, TAGS, NEG_FAMILY, test_uploader, reserved_any, text

META, EXCL, PF, REPO, RUN9, OUT = sys.argv[1:7]
os.makedirs(OUT, exist_ok=True)
rng = random.Random(20261010)
t = pq.read_table(META).to_pydict()
rows = [dict(id=int(i), title=ti or '', tags=list(tg or []), desc=de or '', user=u or '', lic=l, file=f, row=int(r))
        for i, ti, de, tg, u, l, f, r in zip(t['freesound_id'], t['title'], t['description'], t['tags'], t['username'], t['license'], t['file'], t['row'])]
byid = {}
for r in rows: byid.setdefault(r['id'], r)          # first copy wins
rows = list(byid.values())

fsd_dev = {int(r['fname']) for r in csv.DictReader(open(f'{EXCL}/FSD50K.ground_truth/dev.csv'))}
fsd_eval = {int(r['fname']) for r in csv.DictReader(open(f'{EXCL}/FSD50K.ground_truth/eval.csv'))}
rehost = {int(i) for v in json.load(open(f'{EXCL}/rehosts.json')).values() for i in v}
staged = set(); held_users = set(); train_ids = set()
for l in open(f'{PF}/datasets/run7-prep/fsnew-staging-ids.tsv'):
    tag, split, ids = l.rstrip('\n').split('\t')
    staged |= {int(x) for x in ids.split(',') if x}
for r in csv.DictReader(open(RUN9)):   # private cmjatom/dge-private-train run9/v1-audit/manifest-audited.csv
    if r['id'].startswith('freesound:'):
        staged.add(int(r['id'].split(':')[1]))
        if r['split'] != 'train': held_users.add(r['creator'].casefold())
for r in csv.DictReader(open(f'{PF}/datasets/no-source-tags/candidates-all-tags.csv')):
    if r['split'] == 'train': train_ids.add(int(r['freesound_id']))
    else: held_users.add(r['username'].casefold())
for r in csv.DictReader(open(f'{PF}/datasets/round10-uncovered/candidates-2026-10-10.csv')):
    if r['item_id'].startswith('fs:'):
        (train_ids.add(int(r['item_id'][3:])) if r['split'] == 'train' else held_users.add(r['creator'].casefold()))
t8 = json.load(open(f'{PF}/datasets/test8-untested-tags/training-exclusions.json'))
test8_ids = {int(i) for i in t8['freesound_ids']}
reserved_ids, reserved_users = set(), set()
for f in ('docs/evaluations/short-clips-2026-10-04/reserved-test-families.json', 'docs/evaluations/synth-clips-2026-10-05/reserved-test-families.json'):
    d = json.load(open(os.path.join(REPO, f)))
    reserved_ids |= {int(x) for x in d.get('freesoundIds', [])}
    reserved_users |= {u.removeprefix('freesound-user:').casefold() for k in ('freesoundUploaders', 'fsdUploaders') for u in d.get(k, [])}
dj_ids, dj_users = set(), set()
for f in ('docs/evaluations/dj-effects-2026-10-06/clips.json', 'docs/evaluations/dj-effects-2026-10-09/clips.json'):
    for c in json.load(open(os.path.join(REPO, f)))['clips']:
        dj_ids.add(int(c['freesoundId']))
        if c.get('split') != 'train': dj_users.add(c['username'].casefold())

def test_ok(r):
    return (test_uploader(r['user']) and r['id'] not in fsd_dev | fsd_eval and r['id'] not in rehost and r['id'] not in staged
            and r['id'] not in train_ids and r['id'] not in test8_ids and r['id'] not in reserved_ids and r['id'] not in dj_ids
            and r['user'].casefold() not in reserved_users and r['lic'] != 5)
def train_ok(r):
    u = r['user'].casefold()
    return (not reserved_any(r['user']) and u not in held_users and u not in dj_users and u not in reserved_users
            and r['id'] not in fsd_eval and r['id'] not in test8_ids and r['id'] not in reserved_ids and r['id'] not in rehost and r['lic'] != 5)
fam = re.compile(NEG_FAMILY)
def neg_ok(r): return not fam.search((r['title'] + ' ' + ' '.join(r['tags']) + ' ' + r['desc'][:300]).lower())

def pick(cands, cap, per_up):
    rng.shuffle(cands); n = defaultdict(int); out = []
    for r in sorted(cands, key=lambda r: n[r['user']]):
        if n[r['user']] < per_up and len(out) < cap: out.append(r); n[r['user']] += 1
    return out

test_pool = [r for r in rows if test_ok(r)]
train_pool = [r for r in rows if train_ok(r)]
print('pools: test', len(test_pool), 'train', len(train_pool))
test_picks, train_picks, used = [], [], set()
for tag in TAGS:
    H = [r for r in test_pool if RULES[tag]['H'](r)]
    M = [r for r in test_pool if not RULES[tag]['H'](r) and RULES[tag]['M'](r)]
    hp = pick([r for r in H if r['id'] not in used], 14, 2); used |= {r['id'] for r in hp}
    mp = pick([r for r in M if r['id'] not in used], 8, 2); used |= {r['id'] for r in mp}
    test_picks += [dict(r, tag=tag, conf='H') for r in hp] + [dict(r, tag=tag, conf='M') for r in mp]
    TH = [r for r in train_pool if RULES[tag]['H'](r)]
    tp = pick(TH, 45, 3)
    train_picks += [dict(r, tag=tag, conf='H') for r in tp]
    print(f'{tag}: test H {len(H)} ({len({r["user"] for r in H})} up) -> {len(hp)}, M {len(M)} -> {len(mp)}; train H {len(TH)} -> {len(tp)}')
for side, picks, pool in (('test', test_picks, test_pool), ('train', train_picks, train_pool)):
    with open(f'{OUT}/{side}-picks.csv', 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['tag', 'conf', 'freesound_id', 'username', 'licence', 'title', 'tags', 'file', 'row'])
        for r in picks: w.writerow([r['tag'], r['conf'], r['id'], r['user'], r['lic'], r['title'], ','.join(r['tags'])[:300], r['file'], r['row']])
    seen = set(); jobs = []
    for r in picks:
        if r['id'] not in seen: seen.add(r['id']); jobs.append({'id': r['id'], 'file': r['file'], 'row': r['row']})
    json.dump(jobs, open(f'{OUT}/{side}-jobs.json', 'w'))
    ne = [r for r in pool if neg_ok(r) and r['id'] not in seen]
    json.dump({'ids': [r['id'] for r in ne], 'user': {str(r['id']): r['user'] for r in ne}}, open(f'{OUT}/{side}-neg-eligible.json', 'w'))
    print(side, 'jobs', len(jobs), 'files', len({j['file'] for j in jobs}), 'neg eligible', len(ne))
