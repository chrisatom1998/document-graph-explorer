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
from keywords import RULES, TAGS, NEG_FAMILY
import exclusions

META, EXCL, PF, REPO, RUN9, OUT = sys.argv[1:7]
os.makedirs(OUT, exist_ok=True)
rng = random.Random(20261010)
t = pq.read_table(META).to_pydict()
rows = [dict(id=int(i), title=ti or '', tags=list(tg or []), desc=de or '', user=u or '', lic=l, file=f, row=int(r))
        for i, ti, de, tg, u, l, f, r in zip(t['freesound_id'], t['title'], t['description'], t['tags'], t['username'], t['license'], t['file'], t['row'])]
byid = {}
for r in rows: byid.setdefault(r['id'], r)          # first copy wins
rows = list(byid.values())

test_ok, train_ok = exclusions.load(EXCL, PF, REPO, RUN9)
fam = re.compile(NEG_FAMILY)
def neg_ok(r): return not fam.search((r['title'] + ' ' + ' '.join(r['tags']) + ' ' + r['desc'][:300]).lower())

def pick(cands, cap, per_up, n=None):
    """n: per-uploader counts shared across calls (a tag's H and M picks share one cap)."""
    rng.shuffle(cands); n = defaultdict(int) if n is None else n; out = []
    for r in cands:
        if n[r['user']] < per_up and len(out) < cap: out.append(r); n[r['user']] += 1
    return out

test_pool = [r for r in rows if test_ok(r)]
train_pool = [r for r in rows if train_ok(r)]
print('pools: test', len(test_pool), 'train', len(train_pool))
test_picks, train_picks, used = [], [], set()
for tag in TAGS:
    H = [r for r in test_pool if RULES[tag]['H'](r)]
    M = [r for r in test_pool if not RULES[tag]['H'](r) and RULES[tag]['M'](r)]
    per_up = defaultdict(int)   # 2 test clips per uploader per tag across H and M
    hp = pick([r for r in H if r['id'] not in used], 14, 2, per_up); used |= {r['id'] for r in hp}
    mp = pick([r for r in M if r['id'] not in used], 8, 2, per_up); used |= {r['id'] for r in mp}
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
