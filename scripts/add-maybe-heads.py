"""Adds heads exported by `EXPORT=0.65 train-with-extras.py` to public/sound-model/learned.json
as faded "maybe" tags, without touching the heads already there. Use this instead of
ship-round-heads.py when other scripts own some of the shipped heads (it rebuilds the file).
A head whose tag already ships is left alone. Only the learned.json line in manifest.json changes.
Usage: add-maybe-heads.py <round-export.json> <report.json>"""
import json, sys, hashlib, datetime
SRC, REPORT = sys.argv[1:3]
LEARNED, MANIFEST = 'public/sound-model/learned.json', 'public/sound-model/manifest.json'
catalog = {c['label']: c for c in json.load(open('src/audio/djCatalog.json'))['categories']}
model = json.load(open(LEARNED)); shipped = {(h['group'], h['label']) for h in model['heads']}
added, report = [], []
for r in json.load(open(SRC))['results']:
    group = catalog.get(r['name'], {}).get('group')
    row = {k: r.get(k) for k in ('kind', 'name', 'testedOn', 'precision', 'recall', 'threshold', 'trainPositive', 'testPositive', 'uses')}
    if 'head' not in r: report.append({**row, 'added': False, 'why': 'no exported weights'}); continue
    if group not in ('source', 'production', 'character'): report.append({**row, 'added': False, 'why': 'not an app tag'}); continue
    if (group, r['name']) in shipped: report.append({**row, 'added': False, 'why': 'already ships'}); continue
    added.append({'group': group, 'label': r['name'], **r['head'], 'threshold': round(r['threshold'], 4), 'maybe': True})
    report.append({**row, 'group': group, 'added': True})
model['heads'] += added; model['revision'] = model['revision'].split('+')[0] + f'+maybe-{datetime.date.today()}'
body = json.dumps(model, separators=(',', ':')) + '\n'
open(LEARNED, 'w').write(body)
digest = hashlib.sha256(body.encode()).hexdigest()
man = json.load(open(MANIFEST)); man['sha256']['learned.json'] = digest
open(MANIFEST, 'w').write(json.dumps(man, indent=2) + '\n')
json.dump({'kind': 'added-maybe-heads-v1', 'builtAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'learnedSha256': digest, 'heads': report}, open(REPORT, 'w'), indent=1)
for x in report: print(f"{x['name']:<18}{(x['precision'] or 0)*100:>5.0f}%{(x['recall'] or 0)*100:>5.0f}%  " + ('ADDED as maybe' if x['added'] else 'no - ' + x['why']))
print(f"\n{len(added)} added -> {len(model['heads'])} heads, learned.json {len(body)//1024} KB, pinned {digest[:12]}")
