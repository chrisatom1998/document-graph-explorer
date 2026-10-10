"""Ships the DJ-effect heads from train.py into the app, following the project's display policy:
  * held-out precision AND recall >= FULL (0.50, Chris's bar of 2026-10-10; it was 0.70) -> normal head;
  * below that -> "maybe" head (still shown, faded), unless it is clearly not useful:
    held-out precision < 0.45 or recall < 0.30 -> left out;
A label that already ships a head in learned.json gets the new one only if it beats the current head on the SAME
held-out clips (higher min(P, R), then higher F1); a normal head is only ever replaced by one that reaches FULL.
Heads already shipped as "maybe" are re-tiered from their recorded held-out scores with head-scorecard.py and
promote-heads.py (same FULL bar), not by retraining.
New labels (labels.json "new") get a catalog entry on their own axis (dj-effect), so they do not change which
existing label wins the dj-transition axis; add-prompts.mjs then gives them CLAP text vectors (on Actions).
Re-pins learned.json in manifest.json, bumps the learned.json revision and the catalog version, and rewrites
calibratedLabels.json. When the report also scores every held-out clip ("extended", train.py PRIMARY_ROUND), a head that
replaces a current one must beat it there too. REVISION_TAG (default dj-effects-2026-10-06) names the revision suffix.  Usage: ship.py <dir with report.json + heads.json>"""
import json, sys, hashlib, os
D = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
spec = {L['label']: L for L in json.load(open(f"{HERE}/{os.environ.get('LABELS', 'labels.json')}"))['labels']}
report = json.load(open(f'{D}/report.json'))['labels']
trained = {h['label']: h for h in json.load(open(f'{D}/heads.json'))['heads']}
LEARNED, MANIFEST, CATALOG = 'public/sound-model/learned.json', 'public/sound-model/manifest.json', 'src/audio/djCatalog.json'
model = json.load(open(LEARNED)); catalog = json.load(open(CATALOG))
cats = {(c['group'], c['label']) for c in catalog['categories']}
FULL, MAYBE_P, MAYBE_R = 0.50, 0.45, 0.30   # FULL equals SOUND_TAG_BAR in src/audio/confidentSoundSummary.ts
key = lambda P, R: (min(P, R), 2 * P * R / (P + R) if P + R else 0.0)
out, added_cats = [], []
for label, e in report.items():
    row = {'label': label, **{k: e.get(k) for k in ('precision', 'recall', 'testPositive', 'testNegative', 'trainPositive', 'threshold')}}
    h = trained.get(label)
    if not h or 'precision' not in e: out.append({**row, 'shipped': False, 'why': e.get('verdict')}); continue
    P, R = e['precision'], e['recall']
    row['meets70'] = bool(min(P, R) >= 0.70); row['meetsBar'] = bool(min(P, R) >= FULL)
    if P < MAYBE_P or R < MAYBE_R: out.append({**row, 'shipped': False, 'why': f'held-out precision < {MAYBE_P} or recall < {MAYBE_R}'}); continue
    full = min(P, R) >= FULL
    current = [x for x in model['heads'] if x['label'] == label]
    if any(not x.get('maybe') for x in current) and not full:
        out.append({**row, 'shipped': False, 'why': f'a normal head already ships and the new one is below {FULL:.0%}/{FULL:.0%}'}); continue
    if current:
        cur = next((c for c in e.get('current', []) if c['file'] == 'learned.json'), None)
        if not cur: out.append({**row, 'shipped': False, 'why': 'current head was not scored on the same clips'}); continue
        if key(P, R) <= key(cur['precision'], cur['recall']):
            out.append({**row, 'shipped': False, 'why': f"current head is as good on the same held-out clips (P {cur['precision']:.2f} R {cur['recall']:.2f})"}); continue
        ext = e.get('extended', {})
        if 'new' in ext and 'current' in ext and key(ext['new']['precision'], ext['new']['recall']) <= key(ext['current']['precision'], ext['current']['recall']):
            out.append({**row, 'shipped': False, 'why': f"current head is as good on all held-out clips (P {ext['current']['precision']:.2f} R {ext['current']['recall']:.2f})"}); continue
        model['heads'] = [x for x in model['heads'] if x['label'] != label]
        row['replaced'] = {'tier': 'maybe' if cur['maybe'] else 'full', 'precision': cur['precision'], 'recall': cur['recall']}
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
model['revision'] += '+' + os.environ.get('REVISION_TAG', 'dj-effects-2026-10-06')
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
for r in out: print(f"{r['label']:<16}" + (f"{r['precision']:.2f}/{r['recall']:.2f} " if r.get('precision') is not None else '          ') + (f"SHIPPED {r['tier']}" + (f" (replaces {r['replaced']['tier']} head: P {r['replaced']['precision']:.2f} R {r['replaced']['recall']:.2f})" if r.get('replaced') else '') if r['shipped'] else f"no - {r['why']}"))
print(f"new catalog labels: {added_cats or 'none'}; learned.json now {len(model['heads'])} heads")
