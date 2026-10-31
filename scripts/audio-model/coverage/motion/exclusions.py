"""Held-out exclusions shared by the motion-tag pickers (select_clips.py, select_train_extra.py).

load(<excl-dir>, <project-files>, <repo>, <run9 manifest-audited.csv>) returns test_ok(r) and train_ok(r) for mirror rows
(dict with id, user, lic). See select_clips.py for which rules each side applies.
"""
import csv, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from keywords import test_uploader, reserved_any


def load(EXCL, PF, REPO, RUN9):
    fsd_dev = {int(r['fname']) for r in csv.DictReader(open(f'{EXCL}/FSD50K.ground_truth/dev.csv'))}
    fsd_eval = {int(r['fname']) for r in csv.DictReader(open(f'{EXCL}/FSD50K.ground_truth/eval.csv'))}
    rehost = {int(i) for v in json.load(open(f'{EXCL}/rehosts.json')).values() for i in v}
    staged = set(); held_users = set(); train_ids = set()
    run7_held = set()   # prepare-fsnew.py's test-only rows: never tuned on
    for l in open(f'{PF}/datasets/run7-prep/fsnew-staging-ids.tsv'):
        tag, split, ids = l.rstrip('\n').split('\t')
        staged |= {int(x) for x in ids.split(',') if x}
        if split != 'train': run7_held |= {int(x) for x in ids.split(',') if x}
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
                and r['id'] not in fsd_eval and r['id'] not in run7_held and r['id'] not in test8_ids and r['id'] not in reserved_ids and r['id'] not in rehost and r['lic'] != 5)
    return test_ok, train_ok
