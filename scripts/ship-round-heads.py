"""Ships the heads saved by `EXPORT=0.5 train-with-extras.py` into public/sound-model/learned.json.

A head at or above 65% precision AND recall on held-out brands ships as a normal tag; one between
50% and 65% ships with maybe=true and the app shows it as a faded "maybe" tag.
Usage: ship-round-heads.py <round-export.json> <report.json>"""
import json, sys, hashlib, datetime

SRC, REPORT = sys.argv[1:3]
FULL, MAYBE = 0.65, 0.5
ENCODER = 'Xenova/larger_clap_music_and_speech@e9fd5ac1dbf3280936a7fc3ec8a020453ff184db'
catalog = {c['label']: c for c in json.load(open('src/audio/djCatalog.json'))['categories']}
# Broad families map onto the app tag that means the same thing; a family without one does not ship.
FAMILY_TAG = {'drum hit': ('production', 'percussion hit'), 'drum loop': ('production', 'drum loop'),
              'vocal': ('source', 'voice'), 'fx': ('source', 'sound effect')}
heads, report = {}, []
for r in json.load(open(SRC))['results']:
    if 'precision' not in r: continue
    score = min(r['precision'], r['recall'])
    tag = FAMILY_TAG.get(r['name']) if r['kind'] == 'family' else (catalog.get(r['name'], {}).get('group'), r['name'])
    row = {k: r.get(k) for k in ('kind', 'name', 'precision', 'recall', 'threshold', 'trainPositive', 'testPositive', 'uses')}
    if score < MAYBE or 'head' not in r: report.append({**row, 'ships': False, 'why': 'below 50% on held-out brands'}); continue
    if not tag or not tag[0]: report.append({**row, 'ships': False, 'why': 'no matching app tag'}); continue
    head = {'group': tag[0], 'label': tag[1], **r['head'], 'threshold': round(r['threshold'], 4), **({'maybe': True} if score < FULL else {})}
    if tag in heads and heads[tag][0] >= score:
        report.append({**row, 'ships': False, 'why': 'a stronger head for the same tag ships'}); continue
    if tag in heads: next(x for x in report if x.get('tag') == list(tag)).update(ships=False, why='a stronger head for the same tag ships')
    heads[tag] = (score, head); report.append({**row, 'tag': list(tag), 'ships': True, 'maybe': score < FULL})
out = [h for _, h in sorted(heads.values(), key=lambda x: -x[0])]
model = {'version': 1, 'encoder': ENCODER, 'revision': 'trained-heads-2026-10-04-r4', 'examples': [], 'heads': out}
body = json.dumps(model, separators=(',', ':')) + '\n'
open('public/sound-model/learned.json', 'w').write(body)
digest = hashlib.sha256(body.encode()).hexdigest()
mp = 'public/sound-model/manifest.json'; man = json.load(open(mp)); man['sha256']['learned.json'] = digest
open(mp, 'w').write(json.dumps(man, indent=2) + '\n')
json.dump({'kind': 'shipped-heads-report-v2', 'builtAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'bars': {'full': FULL, 'maybe': MAYBE}, 'learnedSha256': digest, 'heads': report}, open(REPORT, 'w'), indent=1)
for x in report: print(f"{x['name']:<16}{x['precision']*100:>5.0f}%{x['recall']*100:>5.0f}%  " + (('MAYBE ' if x.get('maybe') else 'SHIPS ') + '/'.join(x['tag']) if x['ships'] else 'no - ' + x['why']))
print(f"\n{len(out)} heads ({sum(1 for h in out if h.get('maybe'))} maybe) -> learned.json {len(body)//1024} KB, pinned {digest[:12]}")
