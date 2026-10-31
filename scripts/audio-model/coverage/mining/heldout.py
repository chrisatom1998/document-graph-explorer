"""Freesound held-out rules for the coverage lists (ids, uploaders, same-tag uploaders). No audio is read.

Reuses the rules earlier rounds applied, in one place:
- run9-select.py / ced-select.py: the three reserved-uploader hash rules, the short-clip and synth-clip reserved families
  (ids + uploaders), the DJ-effect held-out clips and uploaders, run 7's held-out ids, the keyword list's held-out ids and
  uploaders, ESC-50 / UrbanSound8K / Nonspeech7k re-hosts (run9-exclusions.py output).
- round12/check-fsd50k-eval.py: FSD50K eval clips (the scoreboard judges on them).
- datasets/empty-tags README: test8 training-exclusions.json ids and uploaders, run 9 audit held-out rows, round 10 val
  rows, and "an uploader held out for the same tag" (fsnew-staging.tsv's held-out rows carry md5(username)[:6]; round 10
  val rows carry the creator).
Not available in this container (so not applied; say so wherever a list is used): the licensed-pilot exclusion manifest
(its Freesound sets are built from the same reserved families and DJ held-out lists above) and the open-vocab round-19 test
ids (not found on Chris's Mac either).

Paths come from a JSON config (see DEFAULTS) so private inputs are never committed. Every list built here stays private.
"""
import csv, hashlib, json, os, re
from collections import defaultdict

h8 = lambda s: int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)
md6 = lambda u: hashlib.md5(u.encode()).hexdigest()[:6]
FSID = re.compile(r'(?:freesound:|fs:|/sounds/)(\d+)')


def reserved_rule(u):
    """The three reserved-uploader hash rules (run9-select.py, ced-select.py): these uploaders never train anything."""
    return (h8('synth-fresh-up|freesound-user:' + u) % 5 == 0 or h8('dj-effects|' + u) % 4 == 0
            or h8('dge-audio-model-freesound-test|' + u) % 10 == 0)


def fs_id(s):
    """A Freesound id from 'freesound:<n>', 'fs:<n>' or a '/sounds/<n>/' URL; never from digits inside a username."""
    m = FSID.search(s or '')
    return int(m.group(1)) if m else None


class HeldOut:
    def __init__(self, cfg, strict=False):
        P = json.load(open(cfg)) if isinstance(cfg, str) else cfg
        self.kw_users = set()
        self.ids, self.users = defaultdict(set), defaultdict(set)    # reason -> ids / casefolded uploaders (all tags)
        self.tag_users, self.tag_hash = defaultdict(set), defaultdict(set)   # tag -> casefolded uploaders / md5 hashes
        repo = P['repo']
        for f in ('docs/evaluations/short-clips-2026-10-04/reserved-test-families.json', 'docs/evaluations/synth-clips-2026-10-05/reserved-test-families.json'):
            d = json.load(open(os.path.join(repo, f)))
            self.ids['reserved test family'] |= {int(x) for x in d.get('freesoundIds', [])}
            self.users['reserved test family'] |= {u.removeprefix('freesound-user:').casefold() for k in ('freesoundUploaders', 'fsdUploaders') for u in d.get(k, [])}
        for f in P['dj_clips']:
            for c in json.load(open(f))['clips']:
                if c.get('split') != 'train':
                    self.users['DJ-effect held-out'].add(c['username'].casefold()); self.ids['DJ-effect held-out'].add(int(c['freesoundId']))
        for r in csv.DictReader(open(P['keyword_candidates'])):   # datasets/no-source-tags/candidates-all-tags.csv
            if r['split'] == 'heldout':
                # the keyword list splits uploaders per tag (its README: never train on a tag's heldout rows), so its held-out
                # clips are out for every tag and its held-out uploaders for that tag (ced-select.py drops them for all tags;
                # strict=True does the same)
                self.ids['keyword-list held-out'].add(int(r['freesound_id'])); self.tag_users[r['tag']].add(r['username'].casefold())
                self.kw_users.add(r['username'].casefold())
        for line in open(P['fsnew_staging']):   # datasets/run7-prep/fsnew-staging.tsv: tag, split, id:md5(username)[:6],...
            tag, sp, ids = line.rstrip('\n').split('\t')
            if sp != 'heldout': continue
            for x in ids.split(','):
                i, hh = x.split(':'); self.ids['run 7 held-out'].add(int(i)); self.tag_hash[tag].add(hh)
        for r in csv.DictReader(open(P['run9_audit'])):   # run9/v1-audit/manifest-audited.csv
            if r['split'] != 'train':
                i = fs_id(r['id']) or fs_id(r.get('url'))
                if i is not None: self.ids['run 9 held-out'].add(i)
                if r.get('source') == 'freesound': self.users['run 9 held-out'].add(r['creator'].casefold())
        t8 = json.load(open(P['test8_exclusions']))
        self.ids['test8'] |= {int(x) for x in t8['freesound_ids']}
        self.users['test8'] |= {u.casefold() for u in t8['freesound_uploaders']}
        for r in csv.DictReader(open(P['round10_uncovered'])):
            if r['split'] != 'train' and 'freesound' in r['source']:
                i = fs_id(r['item_id']) or fs_id(r['url'])
                if i is not None: self.ids['round 10 val'].add(i)
                self.tag_users[r['tag']].add(r['creator'].casefold())
        self.ids['FSD50K eval'] |= {int(r['fname']) for r in csv.DictReader(open(P['fsd50k_eval']))}
        ex = json.load(open(P['rehosted']))
        self.ids['re-hosted by ESC-50 / US8K / Nonspeech7k'] |= {int(i) for k in ('esc50', 'us8k', 'nonspeech7k') for i in ex.get(k, [])}
        self._id = {}
        for why, s in self.ids.items():
            for i in s: self._id.setdefault(i, why)
        if strict: self.users['keyword-list held-out (any tag)'] = set(self.kw_users)
        self._user = {}
        for why, s in self.users.items():
            for u in s: self._user.setdefault(u, why)

    def why(self, fid, user, tag=None):
        """None when the clip may train (for this tag), else the reason it may not."""
        if int(fid) in self._id: return self._id[int(fid)]
        u = user or ''
        if reserved_rule(u): return 'reserved-uploader hash rule'
        if u.casefold() in self._user: return self._user[u.casefold()]
        if tag is not None and (u.casefold() in self.tag_users.get(tag, ()) or md6(u) in self.tag_hash.get(tag, ())):
            return 'uploader held out for this tag'
        return None

    def summary(self):
        return {'ids': {k: len(v) for k, v in self.ids.items()}, 'uploaders': {k: len(v) for k, v in self.users.items()},
                'same-tag uploader rules': {'tags': len(set(self.tag_users) | set(self.tag_hash))}}
