"""Pick the Freesound keyword rows for tagger run 9 (no audio is read here; ids and metadata only).

Usage: python3 -I scripts/audio-model/run9-select.py <training-data-all-tags report.md> <candidates-all-tags.csv> \
         <run7 fsnew-staging.tsv> <exclusions.json> <out-dir>
  <exclusions.json>: {"esc50": [ids], "us8k": [ids], "nonspeech7k": [ids]} (Freesound ids of clips those sets re-host;
  made by run9-exclusions.py from their public metadata).
  -> <out-dir>/run9-keyword.csv    tag, freesound_id, username, licence, split, route, title
  -> <out-dir>/run9-ids.txt         the same rows for the staging job: tag, split, route, ids (sorted, base-36 deltas)
  -> <out-dir>/run9-select-summary.json

Routes per tag, from the report's verdict:
  keyword       'Usable now' and 'Thin' tags: the keyword rows themselves (labels read ok or labelled set backs the tag).
                Tags whose keyword labels read 'poor' (sound effect, texture, vocal phrase) are left to their labelled sets.
  ced-confirm   'Usable after audio check' tags: the staging job keeps a listed row (train or held-out) only when CED-base
                agrees, with ced-select.py's confirm rules (data/ced-confirm-rules.json on branch claude/project-thread-9ioynb).
  ced-mapped    'Weak labels' tags with an AudioSet class (turntable): train rows from the CED mapped list; held-out rows here
                need a mapped-class score >= 0.5 in the staging job.
  none          'None' and 'Rule-based now' tags, and weak-label tags without a class: nothing from Freesound.

One split for all tags, by uploader, so no sound and no uploader is on both sides for any tag:
  held-out pool: uploaders under the three reserved-uploader rules (short/synth-clip test, DJ-effect held-out, cached
  Freesound test). These uploaders never train anything, so their sounds can only be test rows.
  train: every other uploader. Rows of uploaders in the short-clip reserved families are dropped outright.
Dropped: run 7's held-out ids and rows already in run 7 training (fsnew-v1 is loaded again in run 9), Freesound ids that
ESC-50, UrbanSound8K or Nonspeech7k re-host, Good-sounds re-uploads (tag good-sounds / goodsounds), reserved ids.
Caps per tag: train 700 rows, 15 per uploader; held-out 150 rows, 4 per uploader, spread over uploaders first. The train
pool of a ced-confirm tag is capped at 1,200 rows (25 per uploader) before the CED check, which keeps at most 400.
The open-vocab round-19 test ids are NOT removed here (they are on Chris's Mac).
"""
import csv, hashlib, json, os, random, re, sys
from collections import Counter, defaultdict

REPORT, CANDS, FSNEW, EXCL, OUT = sys.argv[1:6]
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
TRAIN_CAP, TRAIN_PER_UP, HELD_CAP, HELD_PER_UP = 700, 15, 150, 4
CED_POOL_CAP, CED_POOL_PER_UP = 1200, 25   # keyword train pool handed to the CED check (it keeps <= 400 per tag)
POOR_SKIP = {'sound effect', 'texture', 'vocal phrase'}
CED_HELD_MAPPED = {'turntable'}

h8 = lambda s: int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)
def reserved_rule(u):
    return h8('synth-fresh-up|freesound-user:' + u) % 5 == 0 or h8('dj-effects|' + u) % 4 == 0 or h8('dge-audio-model-freesound-test|' + u) % 10 == 0

def b36(n):
    d = '0123456789abcdefghijklmnopqrstuvwxyz'; s = ''
    while True:
        n, r = divmod(n, 36); s = d[r] + s
        if not n: return s

def report_tags(path):
    rows = {}
    for line in open(path):
        c = [x.strip() for x in line.strip().strip('|').split('|')]
        if len(c) == 10 and c[1] in ('b', 'd', 'e', 'f', 'g') and c[0] != 'Tag':
            rows[c[0]] = {'verdict': c[8].strip('*'), 'quality': c[6], 'sources': c[7]}
    return rows

def main():
    os.makedirs(OUT, exist_ok=True)
    tags = report_tags(REPORT)
    route = {}
    for t, r in tags.items():
        v = r['verdict']
        if v in ('Usable now', 'Thin'): route[t] = 'none' if t in POOR_SKIP else 'keyword'
        elif v == 'Usable after audio check': route[t] = 'ced-confirm'
        elif v == 'Weak labels' and t in CED_HELD_MAPPED: route[t] = 'ced-mapped'
        else: route[t] = 'none'
    ex = json.load(open(EXCL))
    rehosted = {int(i) for k in ('esc50', 'us8k', 'nonspeech7k') for i in ex.get(k, [])}
    bad_ids, bad_users = set(), set()
    for f in ('docs/evaluations/short-clips-2026-10-04/reserved-test-families.json', 'docs/evaluations/synth-clips-2026-10-05/reserved-test-families.json'):
        d = json.load(open(os.path.join(REPO, f)))
        bad_ids |= {int(x) for x in d.get('freesoundIds', [])}
        bad_users |= {u.removeprefix('freesound-user:').casefold() for k in ('freesoundUploaders', 'fsdUploaders') for u in d.get(k, [])}
    dj_held_users = set()
    for f in ('docs/evaluations/dj-effects-2026-10-06/clips.json', 'docs/evaluations/dj-effects-2026-10-09/clips.json'):
        for c in json.load(open(os.path.join(REPO, f)))['clips']:
            if c.get('split') != 'train': dj_held_users.add(c['username'].casefold()); bad_ids.add(int(c['freesoundId']))
    r7_held, r7_train = set(), set()
    for line in open(FSNEW):
        _, sp, ids = line.rstrip('\n').split('\t')
        for x in ids.split(','): (r7_held if sp == 'heldout' else r7_train).add(int(x.split(':')[0]))

    why = Counter(); by_tag = defaultdict(lambda: {'train': [], 'heldout': []}); seen = set()
    for r in csv.DictReader(open(CANDS)):
        t, i, u = r['tag'], int(r['freesound_id']), r['username']
        rt = route.get(t, 'none')
        if rt == 'none': why['route none'] += 1; continue
        if (t, i) in seen: why['duplicate row'] += 1; continue
        seen.add((t, i))
        if r['licence'] not in ('CC0', 'BY4', 'BY3', 'NC3', 'NC4'): why['licence'] += 1; continue
        if re.search(r'good-?sounds', r['tags'] or '', re.I): why['Good-sounds re-upload'] += 1; continue
        if i in rehosted: why['re-hosted by ESC-50 / US8K / Nonspeech7k'] += 1; continue
        if i in r7_held: why['run 7 held-out id'] += 1; continue
        if i in r7_train or r['in_run7_train'] == '1': why['already in run 7 training (fsnew-v1)'] += 1; continue
        if i in bad_ids or u.casefold() in bad_users: why['reserved test id or family uploader'] += 1; continue
        if u.casefold() in dj_held_users: why['DJ-effect held-out uploader'] += 1; continue
        sp = 'heldout' if reserved_rule(u) else 'train'
        if sp == 'train' and rt == 'ced-mapped': why['train row left to the CED mapped list'] += 1; continue
        by_tag[t][sp].append(r)

    rng = random.Random(20261010); out = []; summary = {}
    for t in sorted(route):
        rt = route[t]; got = {}
        tcap, tper = (CED_POOL_CAP, CED_POOL_PER_UP) if rt == 'ced-confirm' else (TRAIN_CAP, TRAIN_PER_UP)
        for sp, cap, per in (('train', tcap, tper), ('heldout', HELD_CAP, HELD_PER_UP)):
            rows = by_tag[t][sp]; per_up = defaultdict(list)
            for r in sorted(rows, key=lambda r: int(r['freesound_id'])): per_up[r['username']].append(r)
            for v in per_up.values(): rng.shuffle(v)
            ups = sorted(per_up); rng.shuffle(ups); chosen, k = [], 0
            while len(chosen) < cap and k < per:          # round robin over uploaders: diversity before depth
                for u in ups:
                    if k < len(per_up[u]) and len(chosen) < cap: chosen.append(per_up[u][k])
                k += 1
            got[sp] = chosen
            out += [(t, int(r['freesound_id']), r['username'], r['licence'], sp, rt, r['title']) for r in chosen]
        summary[t] = {'verdict': tags[t]['verdict'], 'route': rt, 'train': len(got['train']), 'heldout': len(got['heldout']),
                      'trainUploaders': len({r['username'] for r in got['train']}), 'heldoutUploaders': len({r['username'] for r in got['heldout']}),
                      'trainPool': len(by_tag[t]['train']), 'heldoutPool': len(by_tag[t]['heldout'])}
    # Same sound, two tags: it must sit on one side (the uploader rule guarantees it; checked here).
    sides = defaultdict(set)
    for row in out: sides[row[1]].add(row[4])
    assert not [i for i, s in sides.items() if len(s) > 1], 'a sound is on both sides'
    with open(os.path.join(OUT, 'run9-keyword.csv'), 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['tag', 'freesound_id', 'username', 'licence', 'split', 'route', 'title']); w.writerows(out)
    groups = defaultdict(list)
    for t, i, u, lic, sp, rt, _ in out: groups[(t, sp, rt)].append(i)
    with open(os.path.join(OUT, 'run9-ids.txt'), 'w') as f:   # tag, split, route, sorted ids as base-36 deltas
        for (t, sp, rt), ids in sorted(groups.items()):
            ids, p, enc = sorted(set(ids)), 0, []
            for i in ids: enc.append(b36(i - p)); p = i
            f.write(f'{t}\t{sp}\t{rt}\t{",".join(enc)}\n')
    json.dump({'removed': dict(why), 'caps': {'train': TRAIN_CAP, 'trainPerUploader': TRAIN_PER_UP, 'heldout': HELD_CAP, 'heldoutPerUploader': HELD_PER_UP},
               'uniqueSounds': len(sides), 'uniqueUploaders': len({r[2] for r in out}), 'tags': summary},
              open(os.path.join(OUT, 'run9-select-summary.json'), 'w'), indent=1)
    print(f'{len(out)} rows, {len(sides)} sounds; removed: ' + ', '.join(f'{k} {v}' for k, v in why.most_common()))

if __name__ == '__main__':
    main()
