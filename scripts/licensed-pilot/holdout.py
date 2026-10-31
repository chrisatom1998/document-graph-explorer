"""Freeze the locked holdout for the licensed-audio pilot. Run once, before any training; never edited afterwards.

Usage: python3 -I scripts/licensed-pilot/holdout.py <free-tag-set dir> <out-dir>
Writes <out-dir>/holdout.json (items with id, path, sha256, seconds, short, and per-label state 1 / 0 / null) and
holdout.lock (sha256 of holdout.json). The audio is the private free-tag-set (SampleRadar, Iowa MIS, BBC): test only,
never trained, tuned or calibrated on, never committed. Its creators share nothing with the pilot's training families
(Karoryfer, Kenney, rubberduck, CC0 Freesound uploaders), so it is source-disjoint by construction; dedupe.py also
checks decoded audio both ways.

Positives: the set's own name-derived present tags. Negatives, declared here before any score is seen:
- an explicit absent tag in the set (Iowa notes are absent for bass guitar);
- for every pilot label, a file whose present tags name a different, clearly incompatible sound from the list
  INCOMPATIBLE (a kick drum hit is not a laser, a synth bass loop is not a bass guitar);
- the other pilot labels' positives, except foley hit vs laser (neither is declared against the other).
Everything else is unknown and only counted as "fires on unlabelled" in the report, never as a false positive.
"""
import csv, hashlib, json, os, subprocess, sys

FTS, OUT = sys.argv[1:3]
os.makedirs(OUT, exist_ok=True)
TARGETS = ['bass guitar', 'foley hit', 'laser']
INCOMPATIBLE = {
    'bass guitar': {'synth bass', '808 bass', 'acid bass', 'reese bass', 'wobble bass', 'acoustic guitar', 'electric guitar', 'piano',
                    'electric piano', 'organ', 'kick', 'snare', 'hi-hat', 'closed hi-hat', 'open hi-hat', 'clap', 'cymbal', 'laser', 'foley hit',
                    'flute', 'trumpet', 'saxophone', 'violin', 'vocal phrase', 'pitched vocal'},
    'foley hit': {'bass guitar', 'synth bass', '808 bass', 'acoustic guitar', 'electric guitar', 'piano', 'electric piano', 'organ', 'kick', 'snare',
                  'hi-hat', 'closed hi-hat', 'open hi-hat', 'cymbal', 'crash cymbal', 'flute', 'trumpet', 'saxophone', 'violin', 'cello',
                  'vocal phrase', 'pitched vocal', 'synth pad', 'atmospheric pad', 'drum loop'},
    'laser': {'bass guitar', 'synth bass', '808 bass', 'acoustic guitar', 'electric guitar', 'piano', 'electric piano', 'organ', 'kick', 'snare',
              'hi-hat', 'closed hi-hat', 'open hi-hat', 'cymbal', 'crash cymbal', 'clap', 'flute', 'trumpet', 'saxophone', 'violin', 'cello',
              'vocal phrase', 'pitched vocal', 'drum loop', 'bird ambience', 'water ambience', 'rain ambience'},
}
rows = list(csv.DictReader(open(os.path.join(FTS, 'labels.csv'))))
items = []
for r in rows:
    present, absent = set(filter(None, r['present_tags'].split(';'))), set(filter(None, r['absent_tags'].split(';')))
    lab = {}
    for t in TARGETS:
        if t in present: lab[t] = 1
        elif t in absent or present & INCOMPATIBLE[t]: lab[t] = 0
        elif r['source'] == 'iowa-mis': lab[t] = 0          # one orchestral instrument note: not a bass guitar, hit or laser
        else: lab[t] = None
    if all(v is None for v in lab.values()): continue
    if not any(v == 1 for v in lab.values()) and r['source'] == 'iowa-mis' and lab['bass guitar'] == 0: pass
    path = os.path.join(FTS, r['path'])
    secs = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout.strip() or 0)
    sha = hashlib.sha256(open(path, 'rb').read()).hexdigest()
    items.append({'id': 'h' + sha[:15], 'path': r['path'], 'source': r['source'], 'pack': r['pack'], 'sha256': sha,
                  'seconds': round(secs, 3), 'short': secs <= 2.25, 'labels': lab, 'present_tags': sorted(present)})
doc = {'kind': 'licensed-pilot-holdout-v1', 'frozen': '2026-10-10', 'labels': TARGETS, 'rule': __doc__.split('\n\n', 2)[2].strip(),
       'counts': {t: {'pos': sum(i['labels'][t] == 1 for i in items), 'neg': sum(i['labels'][t] == 0 for i in items),
                      'pos_short': sum(i['labels'][t] == 1 and i['short'] for i in items), 'neg_short': sum(i['labels'][t] == 0 and i['short'] for i in items)}
                  for t in TARGETS},
       'items': items}
blob = json.dumps(doc, indent=1, sort_keys=True).encode()
open(os.path.join(OUT, 'holdout.json'), 'wb').write(blob)
open(os.path.join(OUT, 'holdout.lock'), 'w').write(hashlib.sha256(blob).hexdigest() + '  holdout.json\n')
print(len(items), json.dumps(doc['counts'], indent=1))
