"""Picks Freesound clips for catalog labels that have little or no training audio, from the
public metadata dump (huggingface.co/datasets/Chr0my/freesound.org, 554,850 sounds).

A clip gets every target label whose terms appear among its uploader tags (or, for multi-word
terms, in its title). Tags are uploader-written, so labels are noisy and a missing tag is NOT
evidence of absence; train-with-extras.py only uses non-matching clips as negatives anyway.
At most PER_UPLOADER clips per uploader per label, chosen by a fixed hash, so one prolific
uploader cannot dominate a label and held-out tests can split by uploader.

Never selects a sound or uploader reserved by a frozen test set (reserved-test-families.json).
Usage: freesound-mine-manifest.py <meta.parquet> <out.json>   env: PER_LABEL (120), PER_UPLOADER (4),
SKIP=label,label  (labels another session already covers)"""
import json, sys, os, re, hashlib
import pyarrow.parquet as pq

META, OUT = sys.argv[1:3]
PER_LABEL, PER_UPLOADER = int(os.environ.get('PER_LABEL', 120)), int(os.environ.get('PER_UPLOADER', 4))
SKIP = set(filter(None, os.environ.get('SKIP', '').split(',')))
# EXTRA_TERMS=file.json {label: [terms]}: extra search words; with ONLY_EXTRA=1 only those labels are mined.
EXTRA = json.load(open(os.environ['EXTRA_TERMS'])) if os.environ.get('EXTRA_TERMS') else {}
# ONLY_LABELS=a,b: mine just these labels. SKIP_IDS=cands.json,...: never re-pick sounds already in those lists.
ONLY_LABELS = set(filter(None, os.environ.get('ONLY_LABELS', '').split(',')))
SKIP_IDS = {str(c['freesoundId']) for f in filter(None, os.environ.get('SKIP_IDS', '').split(',')) for c in json.load(open(f))['clips']}
FP = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints'
catalog = json.load(open('src/audio/djCatalog.json'))['categories']
coverage = {r['label']: r['terms'] for r in json.load(open(f'{FP}/coverage.json'))['rows']}
shipped = {h['label'] for f in ('learned.json', 'short-clip.json') for h in json.load(open(f'public/sound-model/{f}'))['heads']}

reserved_ids, reserved_users = set(), set()
for f in ('docs/evaluations/short-clips-2026-10-04/reserved-test-families.json', 'docs/evaluations/synth-clips-2026-10-05/reserved-test-families.json'):
    d = json.load(open(f))
    reserved_ids |= set(map(str, d.get('freesoundIds', [])))
    reserved_users |= {u.removeprefix('freesound-user:') for k in ('freesoundUploaders', 'fsdUploaders') for u in d.get(k, [])}

norm = lambda s: re.sub(r'[\s_\-]+', ' ', s.lower()).strip()
targets = {}
for c in catalog:
    label = c['label']
    if label in shipped or label in SKIP or (os.environ.get('ONLY_EXTRA') == '1' and label not in EXTRA) or (ONLY_LABELS and label not in ONLY_LABELS): continue
    terms = {norm(t) for t in coverage.get(label, []) + [label] + c.get('aliases', []) + EXTRA.get(label, [])} - {''}
    # 'violin / fiddle' style labels: each side is its own term
    terms |= {norm(p) for t in list(terms) if '/' in t for p in t.split('/')}
    targets[label] = {t.strip() for t in terms if t.strip() and '/' not in t}

t = pq.read_table(META).to_pydict()
cands = {l: [] for l in targets}
for sid, title, tags, user in zip(t['id'], t['title'], t['tags:'], t['username']):
    if str(sid) in reserved_ids or user in reserved_users or str(sid) in SKIP_IDS: continue
    tagset = {norm(x) for x in (tags or '').split(',') if x.strip()}
    ttl = ' ' + norm(title or '') + ' '
    for label, terms in targets.items():
        if any(term in tagset or (' ' in term and f' {term} ' in ttl) for term in terms):
            cands[label].append((sid, user, title, tags))

clips, report = {}, {}
for label, rows in cands.items():
    rows.sort(key=lambda r: hashlib.sha256(f'{label}|{r[0]}'.encode()).hexdigest())
    per_user, picked = {}, 0
    for sid, user, title, tags in rows:
        if picked >= PER_LABEL: break
        if per_user.get(user, 0) >= PER_UPLOADER: continue
        per_user[user] = per_user.get(user, 0) + 1; picked += 1
        clip = clips.setdefault(sid, {'id': f'fsm:{sid}', 'freesoundId': sid, 'username': user, 'group': f'uploader:{user}',
                                      'title': title, 'labels': []})
        clip['labels'].append(label)
    report[label] = {'matches': len(rows), 'picked': picked, 'uploaders': len(per_user)}
# A picked clip also carries every other target label its tags name, so it is never a false negative for them.
by_id = {r[0]: r for rows in cands.values() for r in rows}
for label, rows in cands.items():
    ids = {r[0] for r in rows}
    for sid, clip in clips.items():
        if sid in ids and label not in clip['labels']: clip['labels'].append(label)
json.dump({'kind': 'freesound-mined-v1', 'source': 'huggingface.co/datasets/Chr0my/freesound.org metadata; audio = public Freesound previews',
           'perLabel': PER_LABEL, 'perUploader': PER_UPLOADER, 'labels': report, 'clips': list(clips.values())}, open(OUT, 'w'), indent=1)
for l, r in sorted(report.items(), key=lambda x: x[1]['picked']): print(f"{l:<24}{r['matches']:>7} matches {r['picked']:>4} picked {r['uploaders']:>4} uploaders")
print(f'{len(targets)} target labels, {len(clips)} clips')
