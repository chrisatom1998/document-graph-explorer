"""Step 3 (2026-10-31): new training candidates for the tags under F1 0.5 on the tag baseline. No audio is read or written.

Usage:
  python3 -I scripts/audio-model/weak-tags/select_weak.py --baseline docs/evaluations/tag-fix-2026-10-31/before/per-tag.csv \
      --ced <candidates.csv> --fsd50k-meta <dir> --listed <file> [--listed <file> ...] --out <dir>

  --ced: candidates.csv of runs/ced-freesound-38026076860-1 (private dataset cmjatom/dge-eval-runs): per tag, the Freesound
         mirror clips CED-base scored highest (tag, freesound_id, username, license code, seconds, score).
  --fsd50k-meta: FSD50K labels/{dev,eval}.csv and metadata/{dev,eval}_clips_info_FSD50K.json (scripts/tag-baseline/fetch.sh).
  --listed: Freesound ids already listed for training or held out by an earlier round, any tag, any split. Accepts the formats
         those lists use: run9 ids.txt (tag, split, route, base-36 deltas), fsnew staging-ids.tsv (tag, split, ids or id:hash),
         a csv with a freesound_id column (coverage mirror-candidates.csv), or one '<source>:<id>...' per line (ced keep-ids).
  --out: <out>/candidates.csv (private: tag, freesound_id, username, licence, seconds, ced score) and per-tag.csv (counts).

Weak tags: every tag with F1 < 0.5 in --baseline (the shipped app on the 681-clip judge set, before step 2).
Rules, all before any cap (so the judge set and the tuning set can never leak in):
  - FSD50K eval: every eval clip id AND every eval uploader is out. The judge set is drawn from FSD50K eval, and FSD50K keeps
    dev and eval uploaders apart, so no judge uploader can teach the model through another of their sounds.
  - FSD50K dev val-split uploaders are out: the step-2 tuning set (tag-fix-2026-10-31/dev-set) is drawn from them.
  - docs/evaluations/*/reserved-test-families.json ids and uploaders, and heldout.py's three reserved-uploader hash rules.
  - ids in any --listed file (already in training, or held out by an earlier round).
  - CED score >= 0.5 (ced-select.py's MIN_SCORE); at most PER_UPLOADER rows per uploader per tag and PER_TAG per tag,
    best score first.
NOT applied here (their inputs are not on this box; mine-mirror.py's heldout.py config has them): the keyword list's held-out
uploaders, test8, the DJ-effect held-out clips, run 9 audit / round 10 val creators, ESC-50/US8K/Nonspeech7k re-hosts.
So candidates.csv is a pre-filter: run heldout.HeldOut(<config>).why() over it before staging any audio.
"""
import argparse, csv, glob, json, os, re, sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(HERE, '..', 'coverage', 'mining'))
from heldout import reserved_rule  # noqa: E402

MIN_SCORE, PER_UPLOADER, PER_TAG = 0.5, 15, 700   # run9-select.py's train caps
LICENCE = {'0': 'CC0', '1': 'BY4', '2': 'BY3', '3': 'NC3', '4': 'NC4'}   # mine-mirror.py's codes
FSID = re.compile(r'(?:freesound:|fs:)(\d+)')


def b36dec(s):
    p, out = 0, []
    for x in s.split(','):
        if x: p += int(x, 36); out.append(p)
    return out


def listed_ids(path):
    """Freesound ids in one of the list formats above."""
    ids = set()
    with open(path) as f:
        head = f.readline(); f.seek(0)
        if 'freesound_id' in head.split(','):
            return {int(r['freesound_id']) for r in csv.DictReader(f) if r.get('freesound_id', '').isdigit()}
        for line in f:
            parts = line.rstrip('\n').split('\t')
            if len(parts) == 4:      # run9 ids.txt
                ids |= set(b36dec(parts[3]))
            elif len(parts) == 3:    # staging-ids.tsv
                ids |= {int(x.split(':')[0]) for x in parts[2].split(',') if x.split(':')[0].isdigit()}
            else:
                m = FSID.match(line)
                if m: ids.add(int(m.group(1)))
    return ids


def weak_tags(baseline):
    return sorted(r['tag'] for r in csv.DictReader(open(baseline)) if float(r['f1'] or 0) < 0.5)


def fsd50k_blocks(meta):
    """(eval ids, eval uploaders, dev val-split uploaders), uploaders casefolded."""
    ev = {int(r['fname']) for r in csv.DictReader(open(os.path.join(meta, 'eval.csv')))}
    ev_info = json.load(open(os.path.join(meta, 'eval_clips_info_FSD50K.json')))
    dev_info = json.load(open(os.path.join(meta, 'dev_clips_info_FSD50K.json')))
    val = {r['fname'] for r in csv.DictReader(open(os.path.join(meta, 'dev.csv'))) if r['split'] == 'val'}
    return ev, {v['uploader'].casefold() for v in ev_info.values()}, {dev_info[f]['uploader'].casefold() for f in val if f in dev_info}


def reserved_families(repo=REPO):
    ids, users = set(), set()
    for f in sorted(glob.glob(os.path.join(repo, 'docs/evaluations/*/reserved-test-families.json'))):
        d = json.load(open(f))
        ids |= {int(x) for x in d.get('freesoundIds', [])}
        users |= {u.removeprefix('freesound-user:').casefold() for k in ('freesoundUploaders', 'fsdUploaders') for u in d.get(k, [])}
    return ids, users


def select(rows, tags, blocks):
    """rows: candidates.csv dicts. blocks: {'reason': (ids, uploaders)} checked in order. Returns kept rows, Counter of
    (tag, reason) drops."""
    drops, pool = Counter(), defaultdict(list)
    for r in rows:
        t = r['tag']
        if t not in tags: continue
        fid, user = int(r['freesound_id']), r['username']
        why = next((k for k, (ids, users) in blocks.items() if fid in ids or user.casefold() in users), None)
        if why is None and reserved_rule(user): why = 'reserved-uploader hash rule'
        if why is None and float(r['score']) < MIN_SCORE: why = f'CED score < {MIN_SCORE}'
        if why: drops[(t, why)] += 1; continue
        pool[t].append(r)
    kept = []
    for t in sorted(pool):
        per_up = Counter(); n = 0
        for r in sorted(pool[t], key=lambda r: (-float(r['score']), int(r['freesound_id']))):
            if per_up[r['username'].casefold()] >= PER_UPLOADER: drops[(t, 'uploader cap')] += 1; continue
            if n >= PER_TAG: drops[(t, 'tag cap')] += 1; continue
            per_up[r['username'].casefold()] += 1; n += 1; kept.append(r)
    return kept, drops


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--baseline', required=True); ap.add_argument('--ced', required=True); ap.add_argument('--fsd50k-meta', required=True)
    ap.add_argument('--listed', action='append', default=[]); ap.add_argument('--out', required=True)
    a = ap.parse_args()
    tags = weak_tags(a.baseline)
    ev_ids, ev_users, val_users = fsd50k_blocks(a.fsd50k_meta)
    rf_ids, rf_users = reserved_families()
    listed = set().union(*(listed_ids(p) for p in a.listed)) if a.listed else set()
    blocks = {'FSD50K eval clip (judge pool)': (ev_ids, set()), 'FSD50K eval uploader (judge pool)': (set(), ev_users),
              'FSD50K dev-val uploader (tuning set)': (set(), val_users), 'reserved test family': (rf_ids, rf_users),
              'already listed by an earlier round': (listed, set())}
    rows = list(csv.DictReader(open(a.ced)))
    kept, drops = select(rows, set(tags), blocks)
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, 'candidates.csv'), 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['tag', 'freesound_id', 'username', 'licence', 'seconds', 'ced'])
        for r in kept: w.writerow([r['tag'], r['freesound_id'], r['username'], LICENCE.get(r['license'], r['license']), r['seconds'], r['score']])
    reasons = list(blocks) + ['reserved-uploader hash rule', f'CED score < {MIN_SCORE}', 'uploader cap', 'tag cap']
    have = Counter(r['tag'] for r in rows); got = Counter(r['tag'] for r in kept)
    ups = defaultdict(set); lic = defaultdict(Counter)
    for r in kept: ups[r['tag']].add(r['username'].casefold()); lic[r['tag']][LICENCE.get(r['license'], r['license'])] += 1
    with open(os.path.join(a.out, 'per-tag.csv'), 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['tag', 'ced_rows', 'kept', 'uploaders', 'licences'] + [f'dropped: {x}' for x in reasons])
        for t in tags:
            w.writerow([t, have[t], got[t], len(ups[t]), ' '.join(f'{k}={v}' for k, v in sorted(lic[t].items()))] + [drops[(t, x)] for x in reasons])
    print(f'weak tags (F1 < 0.5): {", ".join(tags)}')
    print(f'listed ids: {len(listed)}; FSD50K eval ids {len(ev_ids)}, eval uploaders {len(ev_users)}, dev-val uploaders {len(val_users)}; '
          f'reserved families {len(rf_ids)} ids / {len(rf_users)} uploaders')
    for t in tags: print(f'  {t:18s} CED rows {have[t]:5d}  kept {got[t]:4d}  uploaders {len(ups[t]):3d}')
    print(f'kept {len(kept)} rows, {len({r["freesound_id"] for r in kept})} clips -> {a.out}')


if __name__ == '__main__':
    main()
