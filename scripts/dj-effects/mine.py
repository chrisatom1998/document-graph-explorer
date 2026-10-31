"""Picks short Freesound clips whose uploader tags name a DJ effect (chop, stutter, tape stop, backspin, ...),
plus clips that name no effect at all as plain negatives, from the public Freesound metadata dump
(huggingface.co/datasets/Chr0my/freesound.org). Label rules live in labels.json (or the file named by LABELS, e.g. labels-tags.json).

Tags are written by uploaders, so labels are noisy and a missing tag is not proof of absence; train.py
therefore never uses a clip tagged with a related effect as a negative (labels.json "overlap").
Splits by UPLOADER: sha256('dj-effects|'+username) % 4 == 0 goes to the held-out test split, which is
never used to fit a head or to choose its threshold. At most PER_UPLOADER clips per uploader per label.
Never selects a sound or uploader reserved by a frozen test set (docs/evaluations/*/reserved-test-families.json).
Usage: mine.py <meta.parquet> <out.json>   env: PER_LABEL (300), PER_UPLOADER (5), NEGATIVES (1600)"""
import json, sys, os, re, glob, hashlib
import pyarrow.parquet as pq

META, OUT = sys.argv[1:3]
PER_LABEL, PER_UPLOADER = int(os.environ.get('PER_LABEL', 300)), int(os.environ.get('PER_UPLOADER', 5))
NEGATIVES = int(os.environ.get('NEGATIVES', 1600))
HERE = os.path.dirname(os.path.abspath(__file__))
spec = json.load(open(f"{HERE}/{os.environ.get('LABELS', 'labels.json')}"))
norm = lambda s: re.sub(r'[\s_\-]+', ' ', str(s).lower()).strip()
squash = lambda s: norm(s).replace(' ', '')
h = lambda s: hashlib.sha256(s.encode()).hexdigest()
heldout = lambda user: int(h(f'dj-effects|{user}')[:8], 16) % 4 == 0

reserved_ids, reserved_users = set(), set()
for f in sorted(glob.glob('docs/evaluations/*/reserved-test-families.json')):
    d = json.load(open(f))
    reserved_ids |= set(map(str, d.get('freesoundIds', [])))
    reserved_users |= {str(u).split(':', 1)[-1] for k in ('freesoundUploaders', 'fsdUploaders') for u in d.get(k, [])}
print(f'reserved: {len(reserved_ids)} sounds, {len(reserved_users)} uploaders')

MUSIC = {norm(t) for t in spec['music']}
rules = []
for L in spec['labels']:
    terms = {norm(t) for t in L['tags']}
    rules.append({'label': L['label'], 'terms': terms | {squash(t) for t in terms},
                  'phrases': {t for t in terms if ' ' in t},
                  'all': [{norm(t) for t in alt} for alt in L.get('all', [])],
                  'context': MUSIC if L.get('context') == 'music' else None,
                  'exclude': {norm(t) for t in L.get('exclude', [])}})
EFFECT_WORDS = set().union(*(r['terms'] for r in rules), *(t for r in rules for t in r['all'][:1])) | {
    'fx', 'sfx', 'effect', 'effects', 'transition', 'dj', 'sound effect', 'soundeffect', 'sweep', 'scratch', 'reverse', 'gate',
    'stutter', 'echo', 'delay', 'filter', 'riser', 'drop', 'rewind', 'glitch', 'chop', 'chopped', 'hit', 'boom'}

def labels_of(tagset, title):
    ttl = f' {norm(title)} '
    out = []
    for r in rules:
        if tagset & r['exclude']: continue
        hit = bool(tagset & r['terms']) or any(f' {p} ' in ttl for p in r['phrases']) or (r['all'] and all(tagset & alt for alt in r['all']))
        if hit and (r['context'] is None or tagset & r['context']): out.append(r['label'])
    return out

t = pq.read_table(META, columns=['id', 'title', 'tags:', 'username']).to_pydict()
cands = {r['label']: [] for r in rules}
plain_music, plain_other = [], []
for sid, title, tags, user in zip(t['id'], t['title'], t['tags:'], t['username']):
    if str(sid) in reserved_ids or user in reserved_users or not user: continue
    tagset = {norm(x) for x in (tags or '').split(',') if x.strip()}
    tagset |= {squash(x) for x in tagset}
    labs = labels_of(tagset, title or '')
    row = (sid, user, title, tags, labs)
    for l in labs: cands[l].append(row)
    if not labs and tagset and not tagset & EFFECT_WORDS:
        (plain_music if tagset & MUSIC else plain_other).append(row)

clips, report = {}, {}
def take(sid, user, title, tags, labs, kind):
    c = clips.setdefault(sid, {'id': f'fse:{sid}', 'freesoundId': sid, 'username': user, 'group': f'uploader:{user}',
                               'split': 'heldout' if heldout(user) else 'train', 'title': title, 'tags': tags, 'labels': labs, 'kind': kind})
    return c
for label, rows in cands.items():
    rows.sort(key=lambda r: h(f'{label}|{r[0]}'))
    per_user, picked = {}, 0
    for sid, user, title, tags, labs in rows:
        if picked >= PER_LABEL: break
        if per_user.get(user, 0) >= PER_UPLOADER: continue
        per_user[user] = per_user.get(user, 0) + 1; picked += 1
        take(sid, user, title, tags, labs, 'effect')
    report[label] = {'matches': len(rows), 'matchUploaders': len({r[1] for r in rows}), 'picked': picked, 'pickedUploaders': len(per_user)}
# Plain negatives: mostly music-production clips (loops, one-shots, vocals) that name no effect, some general sounds; 2 per uploader.
for pool, n, kind in ((plain_music, int(NEGATIVES * 0.75), 'plain-music'), (plain_other, NEGATIVES - int(NEGATIVES * 0.75), 'plain-other')):
    pool.sort(key=lambda r: h(f'negative|{r[0]}'))
    per_user, picked = {}, 0
    for sid, user, title, tags, labs in pool:
        if picked >= n: break
        if sid in clips or per_user.get(user, 0) >= 2: continue
        per_user[user] = per_user.get(user, 0) + 1; picked += 1
        take(sid, user, title, tags, [], kind)
    report[kind] = {'matches': len(pool), 'picked': picked, 'pickedUploaders': len(per_user)}

json.dump({'kind': 'dj-effects-candidates-v1', 'source': 'huggingface.co/datasets/Chr0my/freesound.org metadata (uploader tags); audio = public Freesound previews',
           'perLabel': PER_LABEL, 'perUploader': PER_UPLOADER, 'heldoutRule': "sha256('dj-effects|'+username)[:8] % 4 == 0",
           'labels': [r['label'] for r in rules], 'report': report, 'clips': sorted(clips.values(), key=lambda c: c['freesoundId'])}, open(OUT, 'w'), indent=1)
for l, r in report.items(): print(f"{l:<16}{r['matches']:>7} matches {r['picked']:>4} picked {r['pickedUploaders']:>4} uploaders")
print(f'{len(clips)} clips, {sum(c["split"] == "heldout" for c in clips.values())} held out')
