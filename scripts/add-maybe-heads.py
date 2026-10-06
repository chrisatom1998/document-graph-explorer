"""Adds heads exported by `EXPORT=0.65 train-with-extras.py` to public/sound-model/learned.json
as faded "maybe" tags, without touching the heads already there. Use this instead of
ship-round-heads.py when other scripts own some of the shipped heads (it rebuilds the file).
A head whose tag already ships is left alone. Only the learned.json line in manifest.json changes.
FULL_BAR=0.60 (optional): heads whose held-out precision AND recall reach it ship as full tags, the rest as maybe.
Usage: add-maybe-heads.py <round-export.json> <report.json>"""
import json, sys, hashlib, datetime, os
SRC, REPORT = sys.argv[1:3]
FULL_BAR = float(os.environ['FULL_BAR']) if os.environ.get('FULL_BAR') else None
SKIP = set(filter(None, os.environ.get('SKIP', '').split(',')))   # labels another session owns
REAL_ONLY = os.environ.get('REAL_ONLY') == '1'   # only heads measured on library brands or real recordings
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
    if r['name'] in SKIP: report.append({**row, 'added': False, 'why': 'owned by another session'}); continue
    if REAL_ONLY and r.get('testedOn') not in ('library brands', 'real recordings'): report.append({**row, 'added': False, 'why': 'tested on made-up clips only'}); continue
    full = FULL_BAR is not None and min(r['precision'], r['recall']) >= FULL_BAR
    added.append({'group': group, 'label': r['name'], **r['head'], 'threshold': round(r['threshold'], 4), **({} if full else {'maybe': True})})
    shipped.add((group, r['name']))   # first export of a label wins (instrument vs label job)
    report.append({**row, 'group': group, 'added': True, 'tier': 'full' if full else 'maybe'})
model['heads'] += added; model['revision'] = model['revision'].split('+')[0] + f'+maybe-{datetime.date.today()}'
body = json.dumps(model, separators=(',', ':')) + '\n'
open(LEARNED, 'w').write(body)
digest = hashlib.sha256(body.encode()).hexdigest()
man = json.load(open(MANIFEST)); man['sha256']['learned.json'] = digest
# Labels with a tested detector; the Sounds panel only falls back to raw CLAP for labels NOT in this list.
json.dump(sorted({h['label'] for f in (LEARNED, 'public/sound-model/short-clip.json') for h in json.load(open(f))['heads']}), open('src/audio/calibratedLabels.json', 'w'), indent=0)
open(MANIFEST, 'w').write(json.dumps(man, indent=2) + '\n')
json.dump({'kind': 'added-maybe-heads-v1', 'builtAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'learnedSha256': digest, 'heads': report}, open(REPORT, 'w'), indent=1)
for x in report: print(f"{x['name']:<18}{(x['precision'] or 0)*100:>5.0f}%{(x['recall'] or 0)*100:>5.0f}%  " + (f"ADDED as {x['tier']}" if x['added'] else 'no - ' + x['why']))
print(f"\n{len(added)} added -> {len(model['heads'])} heads, learned.json {len(body)//1024} KB, pinned {digest[:12]}")
