"""Ships the DJ-effect heads from train.py into the app, following the project's display policy:
  * held-out precision AND recall >= 0.70 (the project target) -> normal head;
  * below that -> "maybe" head (still shown, faded), unless it is clearly not useful:
    held-out precision < 0.45 or recall < 0.30 -> left out;
A label that already ships a normal head in learned.json is left alone. A label with a maybe head gets the new head
only if it beats the current one on the SAME held-out clips (higher min(P, R), then higher F1).
New labels (labels.json "new") get a catalog entry on their own axis (dj-effect), so they do not change which
existing label wins the dj-transition axis; add-prompts.mjs then gives them CLAP text vectors (on Actions).
Re-pins learned.json in manifest.json, bumps the learned.json revision and the catalog version, and rewrites
calibratedLabels.json.  Usage: ship.py <dir with report.json + heads.json>"""
import json, sys, hashlib, os
D = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
spec = {L['label']: L for L in json.load(open(f'{HERE}/labels.json'))['labels']}
report = json.load(open(f'{D}/report.json'))['labels']
trained = {h['label']: h for h in json.load(open(f'{D}/heads.json'))['heads']}
LEARNED, MANIFEST, CATALOG = 'public/sound-model/learned.json', 'public/sound-model/manifest.json', 'src/audio/djCatalog.json'
model = json.load(open(LEARNED)); catalog = json.load(open(CATALOG))
cats = {(c['group'], c['label']) for c in catalog['categories']}
key = lambda P, R: (min(P, R), 2 * P * R / (P + R) if P + R else 0.0)
out, added_cats = [], []
for label, e in report.items():
    row = {'label': label, **{k: e.get(k) for k in ('precision', 'recall', 'testPositive', 'testNegative', 'trainPositive', 'threshold')}}
    h = trained.get(label)
    if not h or 'precision' not in e: out.append({**row, 'shipped': False, 'why': e.get('verdict')}); continue
    P, R = e['precision'], e['recall']
    row['meets70'] = bool(min(P, R) >= 0.70)
    if P < 0.45 or R < 0.30: out.append({**row, 'shipped': False, 'why': 'held-out precision < 0.45 or recall < 0.30'}); continue
    full = min(P, R) >= 0.70
    current = [x for x in model['heads'] if x['label'] == label]
    if any(not x.get('maybe') for x in current): out.append({**row, 'shipped': False, 'why': 'a normal head already ships'}); continue
    if current:
        cur = next((c for c in e.get('current', []) if c['file'] == 'learned.json'), None)
        if not cur: out.append({**row, 'shipped': False, 'why': 'current maybe head was not scored on the same clips'}); continue
        if key(P, R) <= key(cur['precision'], cur['recall']):
            out.append({**row, 'shipped': False, 'why': f"current maybe head is as good on the same held-out clips (P {cur['precision']:.2f} R {cur['recall']:.2f})"}); continue
        model['heads'] = [x for x in model['heads'] if x['label'] != label]
        row['replaced'] = {'precision': cur['precision'], 'recall': cur['recall']}
    if (h['group'], label) not in cats:
        new = spec[label].get('new')
        if not new: out.append({**row, 'shipped': False, 'why': 'not in the catalog'}); continue
        taken = {a for c in catalog['categories'] if c['group'] == h['group'] for a in [c['label'], *c['aliases']]}
        catalog['categories'].append({'group': h['group'], 'family': 'transition', 'label': label, 'source': 'sound effect',
                                      'description': new['description'], 'aliases': [a for a in new['aliases'] if a not in taken],
                                      'recognition': 'experimental', 'axis': 'dj-effect'})
        cats.add((h['group'], label)); added_cats.append(label)
    model['heads'].append({**h, **({} if full else {'maybe': True})})
    out.append({**row, 'shipped': True, 'tier': 'full' if full else 'maybe'})
if not any(r['shipped'] for r in out): sys.exit('nothing to ship')
model['revision'] += '+dj-effects-2026-10-06'
body = json.dumps(model, separators=(',', ':')) + '\n'
open(LEARNED, 'w').write(body)
man = json.load(open(MANIFEST)); man['sha256']['learned.json'] = hashlib.sha256(body.encode()).hexdigest()
if added_cats:
    catalog['version'] += 1; man['catalogVersion'] = catalog['version']
    open(CATALOG, 'w').write(json.dumps(catalog, indent=2, ensure_ascii=False) + '\n')
open(MANIFEST, 'w').write(json.dumps(man, indent=2) + '\n')
labels = sorted({x['label'] for f in (LEARNED, 'public/sound-model/short-clip.json') for x in json.load(open(f))['heads']})
open('src/audio/calibratedLabels.json', 'w').write(json.dumps(labels, indent=0) + '\n')
json.dump({'kind': 'dj-effect-heads-shipped-v1', 'learnedRevision': model['revision'], 'learnedSha256': man['sha256']['learned.json'],
           'newCatalogLabels': added_cats, 'heads': out}, open(f'{D}/shipped.json', 'w'), indent=1)
for r in out: print(f"{r['label']:<16}" + (f"{r['precision']:.2f}/{r['recall']:.2f} " if r.get('precision') is not None else '          ') + (f"SHIPPED {r['tier']}" + (' (replaces maybe head)' if r.get('replaced') else '') if r['shipped'] else f"no - {r['why']}"))
print(f"new catalog labels: {added_cats or 'none'}; learned.json now {len(model['heads'])} heads")
